import type { FastifyInstance } from "fastify";
import { AuthStore } from "../store/auth.js";
import { SignJWT, importPKCS8, jwtVerify } from "jose";
import { config } from "../config.js";
import { newJti, sha256b64url } from "../crypto/keys.js";
import { createError } from "../lib/errors.js";
import * as audit from "./audit.js";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { MemoryStore } from "../store/memory.js";
import { canonicalTbs, serializeTbs, Tbs } from "../lib/txn.js";

const TX_TTL = 3 * 60; // seconds

function nowSec() { return Math.floor(Date.now() / 1000); }

type ChalRec = { id: string; userId: string; tbs: Tbs; tbsHash: string; createdAt: number; expiresAt: number; signed?: boolean; route?: string };
const CHALS = new Map<string, ChalRec>();

export async function registerTxnRoutes(app: FastifyInstance) {
  app.log.info("registerTxnRoutes enabled");
  // New M0 flow: WebAuthn-based dynamic linking challenge
  app.post("/txn/challenge/webauthn", async (req: any, reply) => {
    const auth = req.headers["authorization"] as string | undefined;
    if (!auth?.startsWith("Bearer ")) throw createError("UNAUTHENTICATED", 401, "unauthenticated");
    if (!config.jwtPrivateKeyPEM) throw createError("INTERNAL", 500, "server_key_unset");
    // Identify user from AT (demo内在同进程验证)
    let at: any;
    try { const { payload } = await jwtVerify(auth.slice(7), await importPKCS8(config.jwtPrivateKeyPEM, "PS256") as any); at = payload; } catch { throw createError("UNAUTHENTICATED", 401, "invalid token"); }
    const userId = String(at.sub || "");
    const { txnId, amount, currency, payee, payer, route } = req.body || {};
    if (!txnId || amount == null || !currency || !payee) throw createError("invalid_txn", 400, "invalid_txn");
    const user = MemoryStore.getUser(userId);
    if (!user) throw createError("INVALID_REQUEST", 400, "user_not_found");
    const tbs = canonicalTbs({ txnId, amount, currency, payee, payer });
    const tbsStr = serializeTbs(tbs);
    const tbsHash = sha256b64url(tbsStr);
    const chal_id = `txc-${newJti()}`;
    const rec: ChalRec = { id: chal_id, userId, tbs, tbsHash, createdAt: Date.now(), expiresAt: Date.now() + TX_TTL * 1000, route };
    CHALS.set(chal_id, rec);
    const allowCredentials = user.credentials.map((c) => ({ id: Buffer.from(c.credentialID, "base64url"), type: "public-key", transports: c.transports }));
    const webauthnOptions = { challenge: Buffer.from(tbsHash, "base64url"), rpId: config.rpId, userVerification: "required" as const, allowCredentials, timeout: TX_TTL * 1000 };
    audit.log("TXN_CHALLENGE_ISSUED", { chal_id, user: userId, tbs, tbs_hash: tbsHash }, req);
    return reply.send({ chal_id, expires_in: TX_TTL, tbs, tbs_hash: tbsHash, webauthnOptions });
  });

  app.post("/txn/confirm", async (req: any) => {
    const { chal_id, method, assertion } = req.body || {};
    if (!chal_id || method !== "webauthn") throw createError("INVALID_REQUEST", 400, "invalid_request");
    const rec = CHALS.get(chal_id);
    if (!rec) throw createError("challenge_expired", 400, "challenge_expired");
    if (rec.signed) throw createError("already_signed", 400, "already_signed");
    if (Date.now() > rec.expiresAt) { CHALS.delete(chal_id); throw createError("challenge_expired", 400, "challenge_expired"); }
    const user = MemoryStore.getUser(rec.userId);
    if (!user) throw createError("INVALID_REQUEST", 400, "user_not_found");
    const dbCred = user.credentials.find((c) => c.credentialID === assertion?.id);
    if (!dbCred) throw createError("INVALID_REQUEST", 400, "credential_not_registered");
    try {
      const verification = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: rec.tbsHash,
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
      if (!verification.verified || !verification.authenticationInfo) throw createError("webauthn_verify_fail", 400, "webauthn_verify_fail");
      dbCred.counter = verification.authenticationInfo.newCounter;
      MemoryStore.upsertUser(user);
    } catch (e: any) {
      throw createError("webauthn_verify_fail", 400, "webauthn_verify_fail");
    }
    if (!config.jwtPrivateKeyPEM) throw createError("INTERNAL", 500, "server_key_unset");
    const pk = await importPKCS8(config.jwtPrivateKeyPEM, "PS256");
    const jti = newJti();
    const payload: any = { sub: rec.userId, txn: rec.tbs, txn_hash: rec.tbsHash, method: "webauthn", jti, aud: "api", ...(rec.route ? { route: rec.route } : {}) };
    const tx_sig = await new SignJWT(payload).setProtectedHeader({ alg: "PS256", typ: "JWT" }).setIssuedAt().setExpirationTime(TX_TTL).sign(pk);
    rec.signed = true;
    audit.log("TXN_SIGNED", { chal_id, user: rec.userId, jti, method: "webauthn" }, req);
    return { tx_sig, txn_hash: rec.tbsHash, method: "webauthn", expires_in: TX_TTL };
  });
  app.post("/txn/challenge", async (req: any, reply) => {
    const { txnId, amount, currency, payee, payer, purpose, hash } = req.body || {};
    if (!txnId || amount == null || !currency || !payee) throw createError("INVALID_REQUEST", 400, "invalid_request");
    if (!config.jwtPrivateKeyPEM) throw createError("INTERNAL", 500, "server_key_unset");
    const pk = await importPKCS8(config.jwtPrivateKeyPEM, "PS256");
    const jti = newJti();
    const payload: any = { txnId, amount, currency, payee, payer, purpose, hash, iat: nowSec(), exp: nowSec() + TX_TTL, jti };
    const jws = await new SignJWT(payload)
      .setProtectedHeader({ alg: "PS256", typ: "JWT" })
      .sign(pk);
    audit.log("TX_CHALLENGE_ISSUED", { txnId, amount, currency, payee, jti }, req);
    return { txn_jws: jws, jti, exp: payload.exp };
  });

  app.post("/txn/verify", async (req: any, reply) => {
    const { txn_jws, amount, currency, payee, txnId, tx_sig, tbs } = req.body || {};
    if (!txn_jws && !tx_sig) throw createError("INVALID_REQUEST", 400, "invalid_request");
    if (!config.jwtPrivateKeyPEM) throw createError("INTERNAL", 500, "server_key_unset");
    try {
      const token = txn_jws || tx_sig;
      const { payload } = await jwtVerify(token, await importPKCS8(config.jwtPrivateKeyPEM, "PS256") as any);
      const p: any = payload;
      if (p.exp && nowSec() > p.exp) { audit.log("TX_INVALID", { reason: "expired", jti: p.jti, txnId: p.txnId }, req); throw createError("TXSIGN_INVALID", 403, "expired"); }
      if (AuthStore.isJtiUsed(p.jti)) { audit.log("TX_REPLAY_BLOCKED", { jti: p.jti, txnId: p.txnId }, req); throw createError("REPLAY_DETECTED", 429, "replay"); }
      if (tx_sig && tbs) {
        const t = canonicalTbs(tbs);
        const h = sha256b64url(serializeTbs(t));
        if (p.txn_hash !== h) { audit.log("TXN_VERIFY_FAIL", { reason: "mismatch" }, req); throw createError("TXSIGN_INVALID", 403, "mismatch"); }
      } else {
        if (txnId && p.txnId !== txnId) { audit.log("TX_INVALID", { reason: "txnId_mismatch", jti: p.jti }, req); throw createError("TXSIGN_INVALID", 403, "txnId_mismatch"); }
        if (amount != null && p.amount !== amount) { audit.log("TX_INVALID", { reason: "amount_mismatch", jti: p.jti }, req); throw createError("TXSIGN_INVALID", 403, "amount_mismatch"); }
        if (currency && p.currency !== currency) { audit.log("TX_INVALID", { reason: "currency_mismatch", jti: p.jti }, req); throw createError("TXSIGN_INVALID", 403, "currency_mismatch"); }
        if (payee && p.payee !== payee) { audit.log("TX_INVALID", { reason: "payee_mismatch", jti: p.jti }, req); throw createError("TXSIGN_INVALID", 403, "payee_mismatch"); }
      }
      AuthStore.markJti(p.jti, TX_TTL * 1000);
      audit.log("TXN_VERIFY_OK", { jti: p.jti }, req);
      return { verified: true };
    } catch (e: any) {
      if (e instanceof Error && (e as any).code) throw e;
      audit.log("TXN_VERIFY_FAIL", { reason: e?.message || "verify_error" }, req);
      throw createError("TXSIGN_INVALID", 403, "verify_error");
    }
  });
}
