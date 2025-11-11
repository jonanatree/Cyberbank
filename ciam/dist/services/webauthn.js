import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse, } from "@simplewebauthn/server";
import { config } from "../config.js";
import { MemoryStore } from "../store/memory.js";
import { signAccessToken } from "../crypto/keys.js";
import { createError } from "../lib/errors.js";
import * as audit from "./audit.js";
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const USER_ID_KEYS = ["userId", "user_id", "userID", "userid"];
const USERNAME_KEYS = ["username", "user_name"];
const DISPLAY_NAME_KEYS = ["displayName", "display_name"];
const CHALLENGE_ID_KEYS = ["chal_id", "challenge_id", "chalId", "challengeId"];
const CHALLENGE_VALUE_KEYS = ["challenge", "challenge_value"];
function pickField(obj, keys) {
    if (!obj)
        return undefined;
    for (const key of keys) {
        const value = obj[key];
        if (value !== undefined && value !== null && String(value).length > 0) {
            return String(value);
        }
    }
    return undefined;
}
function toBuf(b64url) {
    return Buffer.from(b64url, "base64url");
}
function toB64url(buf) {
    return Buffer.from(buf).toString("base64url");
}
async function buildRegistrationOptionsPayload(args) {
    const { userId, username, displayName, allowAutofill } = args;
    if (!userId) {
        throw createError("INVALID_REQUEST", 400, "missing_user_fields");
    }
    let user = MemoryStore.getUser(userId);
    if (!user) {
        const finalUsername = username ?? (allowAutofill ? userId : undefined);
        const finalDisplayName = displayName ?? finalUsername;
        if (!finalUsername || !finalDisplayName) {
            throw createError("INVALID_REQUEST", 400, "missing_user_fields");
        }
        user = {
            id: userId,
            username: finalUsername,
            displayName: finalDisplayName,
            credentials: [],
        };
    }
    else {
        if (username && user.username !== username)
            user.username = username;
        if (displayName && user.displayName !== displayName)
            user.displayName = displayName;
    }
    MemoryStore.upsertUser(user);
    const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpId,
        userID: user.id,
        userName: user.username,
        userDisplayName: user.displayName,
        attestationType: "none",
        excludeCredentials: user.credentials.map((c) => ({
            id: toBuf(c.credentialID),
            type: "public-key",
            transports: c.transports,
        })),
        authenticatorSelection: {
            authenticatorAttachment: config.webauthnRoamingOnly ? "cross-platform" : undefined,
            residentKey: "preferred",
            userVerification: "required",
        },
    });
    const challengeRec = MemoryStore.setChallenge({
        userId: user.id,
        challenge: options.challenge,
        kind: "registration",
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    const enriched = { ...options };
    enriched.chal_id = challengeRec.chalId;
    return enriched;
}
async function buildAuthenticationOptionsPayload(user) {
    const roamingHint = config.webauthnRoamingOnly ? ["usb", "ble", "nfc"] : undefined;
    const allowCreds = user.credentials.map((c) => ({
        id: toBuf(c.credentialID),
        type: "public-key",
        transports: c.transports ?? (roamingHint ? [...roamingHint] : undefined),
    }));
    const options = await generateAuthenticationOptions({
        rpID: config.rpId,
        userVerification: "required",
        allowCredentials: allowCreds,
    });
    const challengeRec = MemoryStore.setChallenge({
        userId: user.id,
        challenge: options.challenge,
        kind: "authentication",
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    const enriched = { ...options };
    enriched.chal_id = challengeRec.chalId;
    return enriched;
}
function resolveChallenge(kind, userId, body) {
    const chalId = pickField(body, CHALLENGE_ID_KEYS);
    const challengeVal = pickField(body, CHALLENGE_VALUE_KEYS);
    let chall;
    if (chalId)
        chall = MemoryStore.getChallengeById(chalId);
    if (!chall)
        chall = MemoryStore.getChallenge(userId);
    if (!chall && challengeVal)
        chall = MemoryStore.findChallengeByValue(challengeVal);
    if (!chall || chall.kind !== kind || chall.userId !== userId) {
        throw createError("INVALID_REQUEST", 400, "challenge_missing_or_user_not_found");
    }
    return chall;
}
export async function registerWebAuthnRoutes(app) {
    // Health check
    app.get("/healthz", async () => ({ status: "ok" }));
    // List users (dev)
    app.get("/dev/users", async () => MemoryStore.listUsers());
    // Registration options
    app.post("/webauthn/registration/options", async (req, reply) => {
        const userId = pickField(req.body, USER_ID_KEYS) ?? "";
        const username = pickField(req.body, USERNAME_KEYS);
        const displayName = pickField(req.body, DISPLAY_NAME_KEYS);
        const options = await buildRegistrationOptionsPayload({ userId, username, displayName });
        return options;
    });
    app.get("/webauthn/registration/options", async (req, reply) => {
        const q = req.query || {};
        const userId = q.user_id ?? q.userId ?? "";
        const username = q.username ?? undefined;
        const displayName = q.display_name ?? q.displayName ?? undefined;
        const options = await buildRegistrationOptionsPayload({
            userId,
            username,
            displayName,
            allowAutofill: true,
        });
        return options;
    });
    // Registration verify
    app.post("/webauthn/registration/verify", async (req, reply) => {
        const userId = pickField(req.body, USER_ID_KEYS);
        if (!userId) {
            throw createError("INVALID_REQUEST", 400, "missing_user_id");
        }
        const bodyResp = req.body.response ?? req.body.assertion;
        if (!bodyResp) {
            throw createError("INVALID_REQUEST", 400, "missing_assertion");
        }
        const user = MemoryStore.getUser(userId);
        if (!user)
            throw createError("INVALID_REQUEST", 400, "user_not_found");
        const chall = resolveChallenge("registration", user.id, req.body);
        try {
            const verification = await verifyRegistrationResponse({
                response: bodyResp,
                expectedChallenge: chall.challenge,
                expectedOrigin: config.origin,
                expectedRPID: config.rpId,
                requireUserVerification: true,
            });
            const { verified, registrationInfo } = verification;
            if (!verified || !registrationInfo) {
                throw createError("INVALID_REQUEST", 400, "registration_verify_failed");
            }
            const { credentialID, credentialPublicKey, counter, aaguid, credentialDeviceType, credentialBackedUp, } = registrationInfo;
            const transports = bodyResp?.response?.transports;
            const stored = {
                credentialID: toB64url(credentialID),
                credentialPublicKey: toB64url(credentialPublicKey),
                counter,
                aaguid,
                deviceType: credentialDeviceType,
                backedUp: credentialBackedUp,
                transports,
            };
            user.credentials.push(stored);
            MemoryStore.upsertUser(user);
            if (chall.chalId)
                MemoryStore.clearChallengeById(chall.chalId);
            audit.log("AUTH_SUCCESS", { phase: "webauthn_register", sub: user.id }, req);
            return { verified: true };
        }
        catch (e) {
            throw createError("INVALID_REQUEST", 400, e?.message ?? "registration_verify_error");
        }
    });
    // Authentication options
    app.post("/webauthn/authentication/options", async (req, reply) => {
        let user;
        const userId = pickField(req.body, USER_ID_KEYS);
        if (userId)
            user = MemoryStore.getUser(userId);
        if (!user) {
            const uname = pickField(req.body, USERNAME_KEYS);
            if (uname)
                user = MemoryStore.getUserByUsername(uname);
        }
        if (!user)
            throw createError("INVALID_REQUEST", 400, "user_not_found");
        return buildAuthenticationOptionsPayload(user);
    });
    app.get("/webauthn/authentication/options", async (req, reply) => {
        const q = (req.query || {});
        let user;
        const userId = pickField(q, USER_ID_KEYS);
        if (userId)
            user = MemoryStore.getUser(userId);
        if (!user) {
            const uname = pickField(q, USERNAME_KEYS);
            if (uname)
                user = MemoryStore.getUserByUsername(uname);
        }
        if (!user)
            throw createError("INVALID_REQUEST", 400, "user_not_found");
        return buildAuthenticationOptionsPayload(user);
    });
    // Authentication verify -> issue demo JWT (for演示用途)
    app.post("/webauthn/authentication/verify", async (req, reply) => {
        const userId = pickField(req.body, USER_ID_KEYS);
        if (!userId) {
            throw createError("INVALID_REQUEST", 400, "missing_user_id");
        }
        const bodyResp = req.body.response ?? req.body.assertion;
        if (!bodyResp) {
            throw createError("INVALID_REQUEST", 400, "missing_assertion");
        }
        const user = MemoryStore.getUser(userId);
        if (!user)
            throw createError("INVALID_REQUEST", 400, "user_not_found");
        const chall = resolveChallenge("authentication", user.id, req.body);
        const dbCred = user.credentials.find((c) => c.credentialID === bodyResp.id);
        if (!dbCred)
            throw createError("INVALID_REQUEST", 400, "credential_not_registered");
        try {
            const verification = await verifyAuthenticationResponse({
                response: bodyResp,
                expectedChallenge: chall.challenge,
                expectedOrigin: config.origin,
                expectedRPID: config.rpId,
                authenticator: {
                    credentialID: toBuf(dbCred.credentialID),
                    credentialPublicKey: toBuf(dbCred.credentialPublicKey),
                    counter: dbCred.counter,
                    transports: dbCred.transports,
                },
                requireUserVerification: true,
            });
            const { verified, authenticationInfo } = verification;
            if (!verified || !authenticationInfo) {
                throw createError("INVALID_REQUEST", 400, "authentication_verify_failed");
            }
            dbCred.counter = authenticationInfo.newCounter;
            MemoryStore.upsertUser(user);
            if (chall.chalId)
                MemoryStore.clearChallengeById(chall.chalId);
            // Demo JWT（非最终 OIDC）
            let token;
            if (config.jwtPrivateKeyPEM) {
                token = await signAccessToken({
                    sub: user.id,
                    username: user.username,
                    tenant: config.tenant,
                    amr: ["webauthn"],
                    acr: "urn:webauthn:uv",
                }, "15m");
            }
            audit.log("AUTH_SUCCESS", { phase: "webauthn_login", sub: user.id }, req);
            return { verified: true, sub: user.id, acr: "urn:webauthn:uv", token };
        }
        catch (e) {
            throw createError("INVALID_REQUEST", 400, e?.message ?? "authentication_verify_error");
        }
    });
}
