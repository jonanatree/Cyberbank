import fp from "fastify-plugin";
import { randomUUID } from "crypto";

declare module "fastify" {
  interface FastifyRequest {
    traceId?: string;
  }
}

export default fp(async (app) => {
  app.addHook("onRequest", async (req, reply) => {
    const incoming = (req.headers["x-request-id"] as string) || undefined;
    const id = incoming || randomUUID();
    req.traceId = id;
    reply.header("X-Request-Id", id);
  });
});

