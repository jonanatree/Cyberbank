import type { FastifyInstance } from "fastify";

interface DecideReq {
  amount?: number;
  currency?: string;
  newPayee?: boolean;
  changeLimit?: boolean;
  changePin?: boolean;
  newDevice?: boolean;
  thresholds?: { L2: number; L3: number }; // optional override per-request
}

export async function registerPolicyRoutes(app: FastifyInstance) {
  app.post<{ Body: DecideReq }>("/policies/decide", async (req) => {
    const b = req.body || {};
    const L2 = b.thresholds?.L2 ?? 1000;
    const L3 = b.thresholds?.L3 ?? 10000;

    // High priority triggers
    if (b.changePin || b.changeLimit || b.newPayee) {
      const res = { decision: "require_step_up", level: "L3" } as const;
      audit.log("POLICY_DECISION", { ...b, ...res }, req);
      return res;
    }
    if (b.newDevice) {
      const res = { decision: "require_step_up", level: "L2" } as const;
      audit.log("POLICY_DECISION", { ...b, ...res }, req);
      return res;
    }
    const amt = b.amount ?? 0;
    if (amt > L3) { const r = { decision: "require_step_up", level: "L3" } as const; audit.log("POLICY_DECISION", { ...b, ...r }, req); return r; }
    if (amt > L2) { const r = { decision: "require_step_up", level: "L2" } as const; audit.log("POLICY_DECISION", { ...b, ...r }, req); return r; }
    const r = { decision: "allow" } as const; audit.log("POLICY_DECISION", { ...b, ...r }, req); return r;
  });
}
import * as audit from "./audit.js";
