import type { FastifyInstance } from "fastify";
import { verifyJwt } from "../crypto/keys.js";
import { createError } from "../lib/errors.js";
import * as audit from "./audit.js";
import { verifyDPoP } from "../lib/dpop.js";
import { config } from "../config.js";
import { importPKCS8, jwtVerify } from "jose";
import { canonicalTbs, serializeTbs } from "../lib/txn.js";

function requiredLevelForRoute(route: string, amount?: number) {
  const L2 = 1000, L3 = 10000;
  if (route === "set-pin") return "L3";
  if (route === "payments") return "L3";
  if (route === "limit") {
    if (!amount || amount <= L2) return "L2";
    return "L3";
  }
  return "L1";
}

function acrToLevel(acr?: string): "L1"|"L2"|"L3" {
  if (!acr) return "L1";
  if (acr.includes("L3")) return "L3";
  if (acr.includes("webauthn:uv") || acr.includes("L2")) return "L2";
  return "L1";
}

export async function registerGatewayRoutes(app: FastifyInstance) {
  app.post("/gateway/check", async (req: any, reply) => {
    const auth = req.headers["authorization"] as string | undefined;
    const tenantHeader = req.headers["fineract-platform-tenantid"] as string | undefined;
    if (!auth?.startsWith("Bearer ")) throw createError("UNAUTHENTICATED", 401, "missing_bearer");
    let authPayload: any;
    try { authPayload = await verifyJwt(auth.slice(7)); } catch { throw createError("UNAUTHENTICATED", 401, "invalid_token"); }
    if (!tenantHeader || tenantHeader !== authPayload?.tenant) { audit.log("GATEWAY_DENY", { code: "TENANT_MISMATCH", header: tenantHeader, token: authPayload?.tenant }, req); throw createError("TENANT_MISMATCH", 403, "Tenant header does not match token", { header: tenantHeader, token: authPayload?.tenant }); }

    const { route, amount, htm, htu } = req.body || {};
    const needed = requiredLevelForRoute(route, amount);
    const have = acrToLevel(authPayload?.acr);
    // Optional DPoP: if token bound (cnf.jkt present), require proof and match jkt
    const tokenJkt: string | undefined = (authPayload?.cnf as any)?.jkt;
    const proof = (req.headers["dpop"] as string | undefined) || undefined;
    if (tokenJkt && config.requireDpop) {
      if (!proof) { audit.log("GATEWAY_DENY", { code: "INVALID_DPOP", reason: "missing", route }, req); throw createError("INVALID_DPOP", 400, "missing"); }
      if (!htm || !htu) { audit.log("GATEWAY_DENY", { code: "INVALID_DPOP", reason: "missing_htm_htu" }, req); throw createError("INVALID_DPOP", 400, "missing_htm_htu"); }
      try {
        const res = await verifyDPoP(proof, htm, htu);
        if (res.jkt !== tokenJkt) { audit.log("GATEWAY_DENY", { code: "INVALID_DPOP", reason: "jkt_mismatch" }, req); throw createError("INVALID_DPOP", 400, "jkt_mismatch"); }
      } catch (e: any) {
        const reason = e?.message || "dpop_verify_failed";
        audit.log("GATEWAY_DENY", { code: "INVALID_DPOP", reason }, req);
        throw createError("INVALID_DPOP", 400, reason);
      }
    }
    if ((needed === "L2" && have === "L1") || (needed === "L3" && have !== "L3")) {
      const strict = config.enforceL3Strict;
      if (strict && needed === "L3") {
        audit.log("GATEWAY_DENY", { code: "access_denied", level: needed }, req);
        throw createError("access_denied", 400, "access denied");
      }
      audit.log("GATEWAY_DENY", { code: "STEP_UP_REQUIRED", level: needed }, req);
      throw createError("STEP_UP_REQUIRED", 403, "Additional verification is required.", { level: needed });
    }
    const requiresSig = config.enforceTxSignature && (route === "set-pin" || route === "payments" || (route === "limit" && needed === "L3"));
    if (requiresSig) {
      const txSig = req.body?.tx_sig as string | undefined;
      const legacy = req.body?.txn_jws as string | undefined;
      if (!txSig && !legacy) { audit.log("GATEWAY_DENY", { code: "txn_signature_required" }, req); throw createError("txn_signature_required", 403, "txn_signature_required"); }
      try {
        const token = txSig || legacy!;
        const { payload: sigPayload } = await jwtVerify(token, await importPKCS8(config.jwtPrivateKeyPEM!, "PS256") as any, { clockTolerance: 60 });
        const p: any = sigPayload;
        if (p.exp && Math.floor(Date.now()/1000) > p.exp) { audit.log("GATEWAY_DENY", { code: "txn_expired" }, req); throw createError("txn_expired", 403, "txn_expired"); }
        if (p.sub && p.sub !== authPayload.sub && txSig) {
          // ensure AT.sub matches tx_sig.sub when new flow used
          audit.log("GATEWAY_DENY", { code: "txn_invalid", reason: "sub_mismatch" }, req); throw createError("txn_invalid", 403, "sub_mismatch");
        }
        // bind audience/route if present
        if (p.aud && p.aud !== "api") { audit.log("GATEWAY_DENY", { code: "txn_invalid", reason: "aud" }, req); throw createError("txn_invalid", 403, "aud_mismatch"); }
        if (p.route && route && p.route !== route) { audit.log("GATEWAY_DENY", { code: "txn_invalid", reason: "route" }, req); throw createError("txn_invalid", 403, "route_mismatch"); }
        if (txSig) {
          // primary: compare txn_hash from canonical current body
          const body = req.body || {};
          const tbs = canonicalTbs({ txnId: String(body.txnId||body.txn_id||body.id||""), amount: body.amount, currency: String(body.currency||""), payee: String(body.payee||"") });
          const h = require("crypto").createHash("sha256").update(serializeTbs(tbs)).digest("base64url");
          if (p.txn_hash && p.txn_hash !== h) {
            audit.log("GATEWAY_DENY", { code: "txn_mismatch", expected: p.txn_hash.slice(0,12), got: h.slice(0,12), route }, req);
            throw createError("txn_mismatch", 403, "txn_mismatch", { expected_hash: p.txn_hash, got_hash: h });
          }
          // fallback: field-by-field
          const txn = p.txn;
          if (!txn) { audit.log("GATEWAY_DENY", { code: "txn_invalid", reason: "no_txn" }, req); throw createError("txn_invalid", 403, "no_txn"); }
          const mismatches: any = {};
          if (String(body.txnId||body.txn_id||body.id) !== String(txn.txnId)) mismatches.txnId = { expected: txn.txnId, got: String(body.txnId||body.txn_id||body.id) };
          if (String(body.currency||"") !== String(txn.currency)) mismatches.currency = { expected: txn.currency, got: String(body.currency||"") };
          if (String(body.payee||"") !== String(txn.payee)) mismatches.payee = { expected: txn.payee, got: String(body.payee||"") };
          if (body.amount != null && String(Number(body.amount).toFixed(2)) !== String(txn.amount)) mismatches.amount = { expected: txn.amount, got: String(Number(body.amount).toFixed(2)) };
          if (Object.keys(mismatches).length) { audit.log("GATEWAY_DENY", { code: "txn_mismatch", mismatches, route }, req); throw createError("txn_mismatch", 403, "txn_mismatch", mismatches); }
          // mark txnId consumed to prevent re-use within TTL window
          if (txn.txnId && (global as any).__consumedTxn?.has(txn.txnId)) { audit.log("GATEWAY_DENY", { code: "txn_replay", txnId: txn.txnId }, req); throw createError("txn_replay", 429, "txn_replay"); }
          (global as any).__consumedTxn = (global as any).__consumedTxn || new Set();
          (global as any).__consumedTxn.add(txn.txnId);
        }
        if (legacy) audit.log("GATEWAY_WARN_LEGACY_TXN_JWS", { note: "legacy txn_jws compatibility, will be removed in future" }, req);
      } catch (e: any) {
        if ((e as any).code) throw e;
        audit.log("GATEWAY_DENY", { code: "txn_invalid", reason: e?.message }, req);
        throw createError("txn_invalid", 403, "txn_invalid");
      }
    }
    audit.log("GATEWAY_ALLOW", { route, needed, have }, req);
    return { allow: true };
  });
}
