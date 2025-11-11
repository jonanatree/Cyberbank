import type { FastifyInstance } from "fastify";
import { verifyJwt } from "../crypto/keys.js";
import { createError } from "../lib/errors.js";

export async function registerUserinfoRoutes(app: FastifyInstance) {
  app.get("/userinfo", async (req: any) => {
    const auth = req.headers["authorization"] as string | undefined;
    if (!auth?.startsWith("Bearer ")) throw createError("UNAUTHENTICATED", 401, "unauthenticated");
    let payload: any;
    try { payload = await verifyJwt(auth.slice(7)); } catch { throw createError("UNAUTHENTICATED", 401, "invalid token"); }
    const sub = String(payload.sub || "");
    const name = payload.name || payload.username || sub;
    const given_name = payload.given_name || "";
    const family_name = payload.family_name || "";
    return { sub, name, given_name, family_name, acr: payload.acr };
  });
}

