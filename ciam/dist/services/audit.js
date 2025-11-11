import { createWriteStream, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "../config.js";
let stream = null;
function ensureStream() {
    const file = config.auditFile;
    if (!file)
        return null;
    const dir = dirname(file);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    if (!stream) {
        stream = createWriteStream(file, { flags: "a" });
    }
    return stream;
}
export function log(event, payload = {}, req) {
    const trace_id = req?.traceId || req?.id || undefined;
    const ip = req?.headers?.["x-forwarded-for"] || req?.ip;
    const ua = req?.headers?.["user-agent"];
    const line = {
        ts: new Date().toISOString(),
        event,
        trace_id,
        ip,
        ua,
        ...payload,
    };
    const s = ensureStream();
    const text = JSON.stringify(line) + "\n";
    if (s)
        s.write(text);
    process.stdout.write(text);
}
