import { AuthStore } from "../store/auth.js";
import { Push } from "../store/push.js";
import * as audit from "./audit.js";
import { createError } from "../lib/errors.js";
import { config } from "../config.js";
const DEFAULT_INTERVAL = 3; // seconds
const DEFAULT_TTL = 120; // seconds
export async function registerCibaRoutes(app) {
    // Spec-alias: backchannel authentication start (alias of /ciba/auth)
    app.post("/backchannel/authentication", async (req, reply) => {
        const { client_id = "web", scope = "openid", login_hint, binding_message } = req.body || {};
        if (!login_hint)
            throw createError("INVALID_REQUEST", 400, "login_hint required");
        const now = Date.now();
        const sess = AuthStore.createCibaSession({
            client_id: String(client_id),
            user_id: String(login_hint),
            scope: String(scope),
            status: "pending",
            level: "L2",
            expiresAt: now + DEFAULT_TTL * 1000,
            intervalSec: DEFAULT_INTERVAL,
        });
        Push.notify(String(login_hint), {
            type: "ciba_request",
            auth_req_id: sess.id,
            binding_message: binding_message ?? "",
            client_id: client_id,
            scope,
            expires_at: now + DEFAULT_TTL * 1000,
        });
        return reply.send({ auth_req_id: sess.id, expires_in: DEFAULT_TTL, interval: DEFAULT_INTERVAL, delivery_mode: "push" });
    });
    app.post("/ciba/auth", async (req, reply) => {
        const { login_hint, user_id, client_id = "public-client", scope, level = "L2" } = req.body || {};
        const uid = user_id || login_hint;
        if (!uid)
            throw createError("INVALID_REQUEST", 400, "login_hint_required");
        const now = Date.now();
        const sess = AuthStore.createCibaSession({
            client_id,
            user_id: uid,
            scope,
            status: "pending",
            level: level === "L3" ? "L3" : "L2",
            expiresAt: now + DEFAULT_TTL * 1000,
            intervalSec: DEFAULT_INTERVAL,
        });
        audit.log("CIBA_STARTED", { auth_req_id: sess.id, user_id: uid, client_id, scope, level: sess.level }, req);
        // Push notify authenticators bound to this user
        Push.notify(uid, {
            type: "ciba_auth",
            auth_req_id: sess.id,
            level: sess.level,
            scope: sess.scope,
            createdAt: sess.createdAt,
            expiresAt: sess.expiresAt,
        });
        return reply.send({ auth_req_id: sess.id, expires_in: DEFAULT_TTL, interval: DEFAULT_INTERVAL, delivery_mode: "push" });
    });
    // Tiny approval page (Approve/Deny)
    app.get("/ciba/approve/:id", async (req, reply) => {
        const id = req.params.id;
        const s = AuthStore.getCiba(id);
        if (!s)
            throw createError("INVALID_REQUEST", 400, "not_found");
        const action = (req.query?.action || "").toString();
        if (action === "approve")
            AuthStore.setCibaStatus(id, "approved");
        if (action === "deny")
            AuthStore.setCibaStatus(id, "denied");
        const status = AuthStore.getCiba(id)?.status ?? s.status;
        // notify subscribers of status change
        Push.notify(s.user_id, { type: "ciba_update", auth_req_id: id, status });
        if (status === "approved")
            audit.log("CIBA_APPROVED", { auth_req_id: id, user_id: s.user_id }, req);
        if (status === "denied")
            audit.log("CIBA_DENIED", { auth_req_id: id, user_id: s.user_id }, req);
        reply.type("text/html").send(`<!doctype html><html><body>
      <h3>CIBA Approval (${id})</h3>
      <p>Status: ${status}</p>
      <a href="?action=approve">Approve</a> | <a href="?action=deny">Deny</a>
    </body></html>`);
    });
    // JSON approval endpoint (mobile/H5 posts approve/deny)
    app.post("/ciba/approve/:id", async (req, reply) => {
        const id = req.params.id;
        const s = AuthStore.getCiba(id);
        if (!s)
            throw createError("INVALID_REQUEST", 400, "not_found");
        const actionVal = (req.query?.action ?? req.body?.action ?? "").toString();
        const approve = actionVal === "approve" || actionVal === "true";
        const qUser = ((req.query?.user_id ?? req.body?.user_id) ?? "").toString();
        if (!qUser || qUser !== s.user_id) {
            audit.log("CIBA_DENIED", { auth_req_id: id, reason: "user_mismatch" }, req);
            throw createError("access_denied", 400, "access denied");
        }
        const reqOrigin = (req.headers?.origin || "").toString();
        try {
            const allowedOrigin = new URL(config.baseUrl).origin;
            if (reqOrigin && reqOrigin !== allowedOrigin) {
                audit.log("CIBA_DENIED", { auth_req_id: id, reason: "origin" }, req);
                throw createError("access_denied", 400, "origin not allowed");
            }
        }
        catch { }
        const requireL3 = !!(req.query?.require_l3 ?? req.body?.require_l3);
        // Idempotency: if already terminal, return as-is
        const current = AuthStore.getCiba(id)?.status ?? s.status;
        if (current !== "pending") {
            return reply.send({ status: current.toUpperCase(), ...(current === "approved" && requireL3 ? { acr: "urn:step-up:L3" } : {}) });
        }
        AuthStore.setCibaStatus(id, approve ? "approved" : "denied");
        const status = AuthStore.getCiba(id)?.status ?? s.status;
        if (approve && requireL3) {
            Push.notify(s.user_id, { type: "ciba_update", auth_req_id: id, status, acr: "urn:step-up:L3" });
            audit.log("CIBA_APPROVED", { auth_req_id: id, user_id: s.user_id, acr: "urn:step-up:L3" }, req);
            return reply.send({ status: status.toUpperCase(), acr: "urn:step-up:L3" });
        }
        Push.notify(s.user_id, { type: "ciba_update", auth_req_id: id, status });
        if (approve)
            audit.log("CIBA_APPROVED", { auth_req_id: id, user_id: s.user_id }, req);
        if (!approve)
            audit.log("CIBA_DENIED", { auth_req_id: id, user_id: s.user_id }, req);
        return reply.send({ status: status.toUpperCase() });
    });
    // Fallback JSON approval without params (for testing environments)
    app.post("/ciba/approve-json", async (req, reply) => {
        const id = String(req.body?.auth_req_id || req.body?.id || "");
        const user_id = String(req.body?.user_id || "");
        const approve = !!req.body?.approve;
        const requireL3 = !!req.body?.require_l3;
        const s = AuthStore.getCiba(id);
        if (!s)
            throw createError("INVALID_REQUEST", 400, "not_found");
        if (!user_id || user_id !== s.user_id) {
            audit.log("CIBA_DENIED", { auth_req_id: id, reason: "user_mismatch" }, req);
            throw createError("access_denied", 400, "access denied");
        }
        const current = AuthStore.getCiba(id)?.status ?? s.status;
        if (current !== "pending") {
            return reply.send({ status: current.toUpperCase(), ...(current === "approved" && requireL3 ? { acr: "urn:step-up:L3" } : {}) });
        }
        AuthStore.setCibaStatus(id, approve ? "approved" : "denied");
        const status = AuthStore.getCiba(id)?.status ?? s.status;
        if (approve && requireL3) {
            Push.notify(s.user_id, { type: "ciba_update", auth_req_id: id, status, acr: "urn:step-up:L3" });
            audit.log("CIBA_APPROVED", { auth_req_id: id, user_id: s.user_id, acr: "urn:step-up:L3" }, req);
            return reply.send({ status: status.toUpperCase(), acr: "urn:step-up:L3" });
        }
        Push.notify(s.user_id, { type: "ciba_update", auth_req_id: id, status });
        if (approve)
            audit.log("CIBA_APPROVED", { auth_req_id: id, user_id: s.user_id }, req);
        else
            audit.log("CIBA_DENIED", { auth_req_id: id, user_id: s.user_id }, req);
        return reply.send({ status: status.toUpperCase() });
    });
    // SSE stream for mobile authenticators to receive push requests
    app.get("/ciba/stream", async (req, reply) => {
        const user_id = (req.query?.user_id || "").toString();
        if (!user_id)
            throw createError("INVALID_REQUEST", 400, "user_id_required");
        Push.add(user_id, reply);
    });
    // SSE path param variant: /ciba/stream/:userId
    app.get("/ciba/stream/:userId", async (req, reply) => {
        const user_id = (req.params?.userId || "").toString();
        if (!user_id)
            throw createError("INVALID_REQUEST", 400, "user_id_required");
        Push.add(user_id, reply);
    });
    // TEMP: debug dump of CIBA sessions (will be removed after testing)
    app.get("/ciba/_dump", async () => {
        try {
            // @ts-ignore
            const list = AuthStore.listCiba ? AuthStore.listCiba() : [];
            return { count: list.length, items: list };
        }
        catch {
            return { count: 0, items: [] };
        }
    });
    // Minimal mobile page (for dev): listens to SSE and renders Approve/Deny
    app.get("/ciba/mobile", async (req, reply) => {
        const user_id = (req.query?.user_id || "").toString();
        reply.type("text/html").send(`<!doctype html><meta charset=utf-8><title>Mobile Auth</title>
    <style>body{font-family:system-ui;margin:2rem;max-width:800px}</style>
    <h2>Mobile Auth for ${user_id || "(set ?user_id=...)"}</h2>
    <div id="list"></div>
    <script>
      const u = new URL(location.href);
      const uid = u.searchParams.get('user_id')||'';
      if(!uid){document.getElementById('list').textContent='Add ?user_id=...' } else {
        const es = new EventSource('/ciba/stream?user_id='+encodeURIComponent(uid));
        es.onmessage = (e)=>{
          const ev = JSON.parse(e.data);
          if(ev.type==='ciba_auth') addReq(ev);
          if(ev.type==='ciba_update') mark(ev);
        };
      }
      function addReq(ev){
        const list = document.getElementById('list');
        const d = document.createElement('div');
        d.id = 'req_'+ev.auth_req_id; d.style.border='1px solid #ccc'; d.style.padding='8px'; d.style.margin='8px 0';
        d.innerHTML = '<b>auth_req_id:</b> '+ev.auth_req_id+'<br/><b>level:</b> '+ev.level+' <b>scope:</b> '+(ev.scope||'')+
          '<br/><button onclick="approve(\''+ev.auth_req_id+'\')">Approve</button> '+
          '<button onclick="deny(\''+ev.auth_req_id+'\')">Deny</button>';
        list.prepend(d);
      }
      function mark(ev){
        const d=document.getElementById('req_'+ev.auth_req_id); if(d){ d.insertAdjacentHTML('beforeend','<div>Status: '+ev.status+'</div>'); }
      }
      async function approve(id){ const url='/ciba/approve/'+id+'?action=approve&user_id='+encodeURIComponent(uid); await fetch(url,{method:'POST'}); }
      async function deny(id){ const url='/ciba/approve/'+id+'?action=deny&user_id='+encodeURIComponent(uid); await fetch(url,{method:'POST'}); }
    </script>`);
    });
}
