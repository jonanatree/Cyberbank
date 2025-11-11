import fp from "fastify-plugin";
import { randomUUID } from "crypto";
export default fp(async (app) => {
    app.addHook("onRequest", async (req, reply) => {
        const incoming = req.headers["x-request-id"] || undefined;
        const id = incoming || randomUUID();
        req.traceId = id;
        reply.header("X-Request-Id", id);
    });
});
