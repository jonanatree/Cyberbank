export async function registerPolicyRoutes(app) {
    app.post("/policies/decide", async (req) => {
        const b = req.body || {};
        const L2 = b.thresholds?.L2 ?? 1000;
        const L3 = b.thresholds?.L3 ?? 10000;
        // High priority triggers
        if (b.changePin || b.changeLimit || b.newPayee) {
            const res = { decision: "require_step_up", level: "L3" };
            audit.log("POLICY_DECISION", { ...b, ...res }, req);
            return res;
        }
        if (b.newDevice) {
            const res = { decision: "require_step_up", level: "L2" };
            audit.log("POLICY_DECISION", { ...b, ...res }, req);
            return res;
        }
        const amt = b.amount ?? 0;
        if (amt > L3) {
            const r = { decision: "require_step_up", level: "L3" };
            audit.log("POLICY_DECISION", { ...b, ...r }, req);
            return r;
        }
        if (amt > L2) {
            const r = { decision: "require_step_up", level: "L2" };
            audit.log("POLICY_DECISION", { ...b, ...r }, req);
            return r;
        }
        const r = { decision: "allow" };
        audit.log("POLICY_DECISION", { ...b, ...r }, req);
        return r;
    });
}
import * as audit from "./audit.js";
