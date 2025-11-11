import { config } from "../config.js";
import { AuthStore } from "../store/auth.js";
import { ensureKeys, getJwks, sha256b64url, signAccessToken, signRefreshToken, signIdToken } from "../crypto/keys.js";
import { createError } from "../lib/errors.js";
import * as audit from "./audit.js";
import { verifyDPoP } from "../lib/dpop.js";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { MemoryStore } from "../store/memory.js";
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
export async function registerOidcRoutes(app) {
    app.get("/.well-known/openid-configuration", async () => ({
        issuer: config.jwtIssuer,
        authorization_endpoint: `${config.baseUrl}/oauth/authorize`,
        token_endpoint: `${config.baseUrl}/oauth/token`,
        backchannel_authentication_endpoint: `${config.baseUrl}/backchannel/authentication`,
        jwks_uri: `${config.baseUrl}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token", "ciba", "urn:openid:params:grant-type:ciba"],
        code_challenge_methods_supported: ["S256", "plain"],
        token_endpoint_auth_methods_supported: ["none"],
        backchannel_token_delivery_modes_supported: ["push"],
        backchannel_user_code_parameter_supported: false,
        authorization_details_types_supported: ["payment"],
    }));
    app.get("/.well-known/jwks.json", async () => {
        await ensureKeys();
        return getJwks();
    });
    // Minimal authorize: accepts JSON or query; issues code; optional redirect
    app.route({
        method: ["GET", "POST"],
        url: "/oauth/authorize",
        handler: async (req, reply) => {
            const q = { ...(req.query || {}), ...(req.body || {}) };
            const { response_type, client_id = "public-client", redirect_uri, scope, code_challenge, code_challenge_method = "S256", state, user_id, username, acr = "urn:webauthn:uv", } = q;
            if (response_type !== "code")
                throw createError("INVALID_REQUEST", 400, "unsupported_response_type");
            if (!user_id && !username)
                throw createError("INVALID_REQUEST", 400, "login_required");
            // PKCE strict: require S256
            if (!code_challenge || code_challenge_method !== "S256") {
                throw createError("INVALID_REQUEST", 400, "pkce_s256_required");
            }
            const sub = user_id || username;
            const now = Date.now();
            const rec = AuthStore.createCode({
                client_id,
                redirect_uri,
                scope: scope || "openid",
                code_challenge,
                code_challenge_method,
                sub,
                username,
                tenant: config.tenant,
                acr,
                expiresAt: now + AUTH_CODE_TTL_MS,
            });
            audit.log("AUTH_SUCCESS", { phase: "authorize", sub, client_id, scope: rec.scope, acr: rec.acr, code: rec.code }, req);
            if (redirect_uri && !q.accept_json) {
                const url = new URL(redirect_uri);
                url.searchParams.set("code", rec.code);
                if (state)
                    url.searchParams.set("state", state);
                return reply.redirect(url.toString());
            }
            return { code: rec.code, state };
        },
    });
    app.post("/oauth/token", async (req, reply) => {
        const { grant_type } = req.body || {};
        if (grant_type === "authorization_code") {
            const { code, redirect_uri, code_verifier } = req.body;
            const rec = AuthStore.consumeCode(code);
            if (!rec)
                throw createError("INVALID_GRANT", 400, "invalid_grant");
            if (rec.redirect_uri && redirect_uri && rec.redirect_uri !== redirect_uri) {
                throw createError("INVALID_REQUEST", 400, "redirect_uri_mismatch");
            }
            // PKCE strict S256
            if (!rec.code_challenge || rec.code_challenge_method !== "S256") {
                throw createError("INVALID_GRANT", 400, "pkce_s256_required");
            }
            const actual = sha256b64url(code_verifier);
            if (actual !== rec.code_challenge)
                throw createError("INVALID_GRANT", 400, "pkce_failed");
            // Optional DPoP binding at token issuance
            let cnf = undefined;
            if (req.body?.dpop_proof) {
                const tokenEndpoint = `${config.baseUrl}/oauth/token`;
                try {
                    const res = await verifyDPoP(req.body.dpop_proof, "POST", tokenEndpoint);
                    cnf = { jkt: res.jkt };
                }
                catch (e) {
                    throw createError("INVALID_DPOP", 400, e?.message || "dpop_failed");
                }
            }
            const access_token = await signAccessToken({ sub: rec.sub, tenant: rec.tenant, scope: rec.scope || "openid", acr: rec.acr, ...(cnf ? { cnf } : {}) });
            const refresh_token = await signRefreshToken({ sub: rec.sub, tenant: rec.tenant, scope: rec.scope || "openid", acr: rec.acr });
            const includeId = (rec.scope || "").includes("openid");
            const id_token = includeId ? await signIdToken({ sub: rec.sub, acr: rec.acr }, rec.client_id) : undefined;
            AuthStore.saveRefresh({ token: refresh_token, sub: rec.sub, tenant: rec.tenant, acr: rec.acr, scope: rec.scope, expiresAt: Date.now() + 14 * 24 * 3600 * 1000 });
            audit.log("AUTH_SUCCESS", { phase: "token_code", sub: rec.sub, client_id: rec.client_id, scope: rec.scope, acr: rec.acr }, req);
            return reply.send({ access_token, token_type: "Bearer", expires_in: 1800, refresh_token, scope: rec.scope, acr: rec.acr, ...(id_token ? { id_token } : {}) });
        }
        if (grant_type === "refresh_token") {
            const { refresh_token } = req.body;
            const r = AuthStore.getRefresh(refresh_token);
            if (!r)
                throw createError("INVALID_GRANT", 400, "invalid_grant");
            const access_token = await signAccessToken({ sub: r.sub, tenant: r.tenant, scope: r.scope || "openid", acr: r.acr });
            audit.log("TOKEN_REFRESHED", { sub: r.sub, scope: r.scope, acr: r.acr }, req);
            return reply.send({ access_token, token_type: "Bearer", expires_in: 1800 });
        }
        if (grant_type === "ciba" || grant_type === "urn:openid:params:grant-type:ciba") {
            const { auth_req_id } = req.body;
            const s = AuthStore.getCiba(auth_req_id);
            if (!s)
                throw createError("INVALID_REQUEST", 400, "invalid_request");
            if (s.status === "pending") {
                const now = Date.now();
                const intervalMs = (s.intervalSec ?? 3) * 1000;
                if (s.nextPollAt && now < s.nextPollAt) {
                    audit.log("CIBA_SLOW_DOWN", { auth_req_id, status: s.status, intervalSec: s.intervalSec ?? 3, nextPollAt: s.nextPollAt }, req);
                    s.nextPollAt = s.nextPollAt + intervalMs; // backoff
                    throw createError("slow_down", 400, "polling too fast");
                }
                AuthStore.touchCibaPoll(auth_req_id);
                audit.log("CIBA_STARTED", { auth_req_id, status: s.status }, req);
                throw createError("authorization_pending", 400, "approval is pending", { interval: s.intervalSec ?? 3 });
            }
            if (s.status === "denied") {
                audit.log("CIBA_DENIED", { auth_req_id }, req);
                throw createError("access_denied", 400, "access denied");
            }
            if (s.status === "expired") {
                audit.log("CIBA_EXPIRED", { auth_req_id }, req);
                throw createError("expired_token", 400, "expired");
            }
            const acr = s.level === "L3" ? "urn:step-up:L3" : "urn:step-up:L2";
            const access_token = await signAccessToken({ sub: s.user_id, tenant: config.tenant, scope: s.scope || "openid", acr });
            const refresh_token = await signRefreshToken({ sub: s.user_id, tenant: config.tenant, scope: s.scope || "openid", acr });
            const includeId2 = (s.scope || "").includes("openid");
            const id_token2 = includeId2 ? await signIdToken({ sub: s.user_id, acr }, s.client_id) : undefined;
            audit.log("AUTH_SUCCESS", { phase: "token_ciba", sub: s.user_id, scope: s.scope, acr }, req);
            return reply.send({ access_token, token_type: "Bearer", expires_in: 1800, refresh_token, scope: s.scope, acr, ...(id_token2 ? { id_token: id_token2 } : {}) });
        }
        if (grant_type === "webauthn") {
            const { user_id, response } = req.body || {};
            if (!user_id || !response)
                throw createError("INVALID_REQUEST", 400, "missing_webauthn_params");
            const user = MemoryStore.getUser(user_id);
            const chall = MemoryStore.getChallenge(user_id);
            if (!user || !chall || chall.kind !== "authentication")
                throw createError("INVALID_REQUEST", 400, "challenge_missing_or_user_not_found");
            const dbCred = user.credentials.find((c) => c.credentialID === response.id);
            if (!dbCred)
                throw createError("INVALID_REQUEST", 400, "credential_not_registered");
            const verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge: chall.challenge,
                expectedOrigin: config.origin,
                expectedRPID: config.rpId,
                authenticator: {
                    credentialID: Buffer.from(dbCred.credentialID, "base64url"),
                    credentialPublicKey: Buffer.from(dbCred.credentialPublicKey, "base64url"),
                    counter: dbCred.counter,
                    transports: dbCred.transports,
                },
                requireUserVerification: true,
            });
            if (!verification.verified || !verification.authenticationInfo)
                throw createError("INVALID_REQUEST", 400, "webauthn_verify_failed");
            dbCred.counter = verification.authenticationInfo.newCounter;
            MemoryStore.upsertUser(user);
            const access_token = await signAccessToken({ sub: user.id, tenant: config.tenant, scope: "openid", acr: "urn:step-up:L3" });
            const refresh_token = await signRefreshToken({ sub: user.id, tenant: config.tenant, scope: "openid", acr: "urn:step-up:L3" });
            const id_token3 = await signIdToken({ sub: user.id, acr: "urn:step-up:L3" }, req.body?.client_id || "public-client");
            audit.log("AUTH_SUCCESS", { phase: "token_webauthn_l3", sub: user.id, acr: "urn:step-up:L3" }, req);
            return reply.send({ access_token, token_type: "Bearer", expires_in: 1800, refresh_token, scope: "openid", acr: "urn:step-up:L3", id_token: id_token3 });
        }
        throw createError("INVALID_REQUEST", 400, "unsupported_grant_type");
    });
}
