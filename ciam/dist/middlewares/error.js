import fp from "fastify-plugin";
import { AppError, MSG } from "../lib/errors.js";
export default fp(async (app) => {
    app.setErrorHandler((err, req, reply) => {
        const trace = req.traceId || req.id;
        let status = 500;
        let code = "INTERNAL";
        let message = "Internal server error";
        let details = undefined;
        if (err instanceof AppError) {
            const e = err;
            status = e.status;
            code = e.code;
            message = e.message || MSG[e.code] || e.code;
            details = e.details;
        }
        else if (err.validation) {
            status = 400;
            code = "INVALID_REQUEST";
            message = "validation_failed";
            details = { validation: err.validation };
        }
        app.log.error({ err, trace_id: trace }, "request_error");
        reply.code(status).send({ code, message, status, details, trace_id: trace });
    });
    app.setNotFoundHandler((req, reply) => {
        const trace = req.traceId || req.id;
        reply.code(400).send({ code: "INVALID_REQUEST", message: "not_found", status: 400, trace_id: trace });
    });
});
