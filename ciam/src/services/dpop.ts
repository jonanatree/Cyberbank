import type { FastifyInstance } from "fastify";
import { verifyDPoP } from "../lib/dpop.js";
import { createError } from "../lib/errors.js";
import * as audit from "./audit.js";
import { config } from "../config.js";

export async function registerDpopRoutes(app: FastifyInstance) {
  app.post("/dpop/verify", async (req: any) => {
    const proof = (req.headers?.dpop as string) || req.body?.proof;
    const { htm = req.body?.htm || "POST", htu = req.body?.htu } = req.body || {};
    if (!proof || !htu) throw createError("INVALID_REQUEST", 400, "missing_dpop_or_htu");
    try {
      const res = await verifyDPoP(proof, htm, htu);
      audit.log("DPOP_VERIFIED", { jkt: res.jkt, htm, htu }, req);
      return { ok: true, jkt: res.jkt };
    } catch (e: any) {
      const reason = e?.message || "verify_failed";
      audit.log("DPOP_INVALID", { reason }, req);
      throw createError("INVALID_DPOP", 400, reason);
    }
  });
}

