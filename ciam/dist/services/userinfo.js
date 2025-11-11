import { verifyJwt } from "../crypto/keys.js";
import { createError } from "../lib/errors.js";
export async function registerUserinfoRoutes(app) {
    app.get("/userinfo", async (req) => {
        const auth = req.headers["authorization"];
        if (!auth?.startsWith("Bearer "))
            throw createError("UNAUTHENTICATED", 401, "unauthenticated");
        let payload;
        try {
            payload = await verifyJwt(auth.slice(7));
        }
        catch {
            throw createError("UNAUTHENTICATED", 401, "invalid token");
        }
        const sub = String(payload.sub || "");
        const name = payload.name || payload.username || sub;
        const given_name = payload.given_name || "";
        const family_name = payload.family_name || "";
        return { sub, name, given_name, family_name, acr: payload.acr };
    });
}
