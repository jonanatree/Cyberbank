import fp from "fastify-plugin";
import type { FastifyError } from "fastify";
import { AppError, MSG } from "../lib/errors.js";

export default fp(async (app) => {
  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    const trace = (req as any).traceId || req.id;
    let status = 500;
    let code: string = "INTERNAL";
    let message = "Internal server error";
    let details: any = undefined;

    if ((err as any) instanceof AppError) {
      const e = err as AppError;
      status = e.status;
      code = e.code;
      message = e.message || MSG[e.code as keyof typeof MSG] || e.code;
      details = e.details;
    } else if ((err as any).validation) {
      status = 400;
      code = "INVALID_REQUEST";
      message = "validation_failed";
      details = { validation: (err as any).validation };
    }

    app.log.error({ err, trace_id: trace }, "request_error");
    reply.code(status).send({ code, message, status, details, trace_id: trace });
  });

  app.setNotFoundHandler((req, reply) => {
    const trace = (req as any).traceId || req.id;
    reply.code(400).send({ code: "INVALID_REQUEST", message: "not_found", status: 400, trace_id: trace });
  });
});
