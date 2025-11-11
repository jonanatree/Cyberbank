import { buildApp } from "./app.js";
import { config } from "./config.js";
const app = buildApp();
app
    .listen({ port: config.port, host: "0.0.0.0" })
    .then((addr) => app.log.info({ addr, rpId: config.rpId, origin: config.origin }, "ciam started"))
    .catch((err) => {
    app.log.error(err, "failed to start");
    process.exit(1);
});
