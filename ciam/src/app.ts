import Fastify from "fastify";
// fastify-cors is deprecated; Fastify has @fastify/cors, but keeping simple here
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { config } from "./config.js";
import { registerWebAuthnRoutes } from "./services/webauthn.js";
import { registerOidcRoutes } from "./services/oidc.js";
import { registerPolicyRoutes } from "./services/policy.js";
import { registerCibaRoutes } from "./services/ciba.js";
import { registerTxnRoutes } from "./services/txn.js";
import { registerGatewayRoutes } from "./services/gateway.js";
import { registerDpopRoutes } from "./services/dpop.js";
import { AuthStore } from "./store/auth.js";
import { registerUserinfoRoutes } from "./services/userinfo.js";
import requestId from "./middlewares/request-id.js";
import errorHandler from "./middlewares/error.js";
import * as audit from "./services/audit.js";

export function buildApp() {
  const app = Fastify({ logger: true });
  app.register(requestId);
  app.register(cors as any, {
    origin: (origin: string, cb: (err: Error | null, allowed: boolean) => void) => {
      if (!origin) return cb(null, true);
      const allowed = config.corsOrigins.some((o) => origin.startsWith(o));
      cb(null, allowed);
    },
    credentials: true,
  });
  app.register(formbody as any);

  app.get("/", async () => ({ service: "ciam-idp", webauthn: true }));
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/metrics", async () => "up 1\n");

  // Static demo (served by fastify only for this simple case)
  if (config.showDemos.includes("demo")) app.get("/demo", async (_req, reply) => { reply.type("text/html").send(DEMO_HTML); });
  if (config.showDemos.includes("demo-l3")) app.get("/demo-l3", async (_req, reply) => { reply.type("text/html").send(DEMO_L3_HTML); });
  if (config.showDemos.includes("demo-web")) app.get("/demo-web", async (_req, reply) => { reply.type("text/html").send(DEMO_WEB_HTML); });
  if (config.showDemos.includes("demo-approver")) app.get("/demo-approver", async (_req, reply) => { reply.type("text/html").send(DEMO_APPROVER_HTML); });
  if (config.showDemos.includes("demo-passkey")) app.get("/demo-passkey", async (_req, reply) => { reply.type("text/html").send(DEMO_PASSKEY_HTML); });
  if (config.showDemos.includes("demo-tx")) app.get("/demo-tx", async (_req, reply) => { reply.type("text/html").send(DEMO_TX_HTML); });
  if (config.showDemos.includes("demo-dpop")) app.get("/demo-dpop", async (_req, reply) => { reply.type("text/html").send(DEMO_DPOP_HTML); });

  registerWebAuthnRoutes(app);
  registerOidcRoutes(app);
  registerPolicyRoutes(app);
  registerCibaRoutes(app);
  if (config.enableTxnSigning) registerTxnRoutes(app);
  registerGatewayRoutes(app);
  registerDpopRoutes(app);
  registerUserinfoRoutes(app);
  app.register(errorHandler);
  app.addHook("onReady", async () => {
    audit.log("APP_STARTED", { baseUrl: config.baseUrl });
    // periodic sweeper for expired CIBA sessions and stale jti
    setInterval(() => {
      try { AuthStore.sweepExpiredCiba((s)=>audit.log("CIBA_EXPIRED", { auth_req_id: s.id, user_id: s.user_id })); } catch {}
      try { AuthStore.sweepJti(); } catch {}
    }, 60_000);
    // optional demo user pre-seed
    try {
      if (process.env.DEMO_PRESEED?.toLowerCase() === 'true') {
        const { MemoryStore } = await import('./store/memory.js');
        MemoryStore.upsertUser({ id: 'u1', username: 'u1', displayName: 'Alice', credentials: [] });
        MemoryStore.upsertUser({ id: 'u2', username: 'u2', displayName: 'Bob', credentials: [] });
        audit.log('DEMO_PRESEED', { users: ['u1','u2'] });
      }
    } catch {}
  });
  return app;
}


const DEMO_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WebAuthn Demo</title>
  <style>body{font-family:system-ui;margin:2rem;max-width:900px}</style>
  <script>
    async function post(path, body){
      const r = await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      if(!r.ok){const t=await r.text();throw new Error(t)};return r.json();
    }
    function b64urlToBuf(b64){return Uint8Array.from(atob(b64.replaceAll('-', '+').replaceAll('_','/')), c=>c.charCodeAt(0));}
    function bufToB64url(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
    async function register(){
      const userId = document.getElementById('userId').value||crypto.randomUUID();
      const username = document.getElementById('username').value||('user_'+userId.slice(0,6));
      const displayName = document.getElementById('displayName').value||username;
      const opts = await post('/webauthn/registration/options',{userId,username,displayName});
      opts.challenge = b64urlToBuf(opts.challenge);
      opts.user.id = b64urlToBuf(opts.user.id);
      if(opts.excludeCredentials){opts.excludeCredentials = opts.excludeCredentials.map(c=>({...c,id:b64urlToBuf(c.id)}));}
      const cred = await navigator.credentials.create({publicKey: opts});
      const attestationResponse = {
        id: cred.id,
        rawId: bufToB64url(cred.rawId),
        response: {
          clientDataJSON: bufToB64url(cred.response.clientDataJSON),
          attestationObject: bufToB64url(cred.response.attestationObject)
        },
        type: cred.type
      };
      const res = await post('/webauthn/registration/verify',{userId, response: attestationResponse});
      document.getElementById('out').textContent = 'Registered: '+JSON.stringify(res);
      document.getElementById('userId').value = userId;
      document.getElementById('username').value = username;
      return false;
    }
    async function login(){
      const userId = document.getElementById('userId').value;
      const username = document.getElementById('username').value;
      const opts = await post('/webauthn/authentication/options',{userId,username});
      opts.challenge = b64urlToBuf(opts.challenge);
      if(opts.allowCredentials){opts.allowCredentials = opts.allowCredentials.map(c=>({...c,id:b64urlToBuf(c.id)}));}
      const cred = await navigator.credentials.get({publicKey: opts});
      const assertionResponse = {
        id: cred.id,
        rawId: bufToB64url(cred.rawId),
        response: {
          clientDataJSON: bufToB64url(cred.response.clientDataJSON),
          authenticatorData: bufToB64url(cred.response.authenticatorData),
          signature: bufToB64url(cred.response.signature),
          userHandle: cred.response.userHandle?bufToB64url(cred.response.userHandle):null
        },
        type: cred.type
      };
      const res = await post('/webauthn/authentication/verify',{userId, response: assertionResponse});
      document.getElementById('out').textContent = 'Login: '+JSON.stringify(res);
      return false;
    }
  </script>
  </head>
<body>
  <h1>WebAuthn Passkey Demo</h1>
  <form onsubmit="return register()">
    <h3>Register</h3>
    <label>User ID <input id="userId" placeholder="uuid" /></label><br/>
    <label>Username <input id="username" placeholder="alice" /></label><br/>
    <label>Display Name <input id="displayName" placeholder="Alice" /></label><br/>
    <button type="submit">Create Passkey</button>
  </form>
  <hr/>
  <form onsubmit="return login()">
    <h3>Login</h3>
    <button type="submit">Use Passkey</button>
  </form>
  <pre id="out"></pre>
  <hr/>
  <p>RP ID / Origin configured by server. Use Chrome DevTools Virtual Authenticator for testing.</p>
</body>
</html>`;

const DEMO_L3_HTML = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>WebAuthn L3 Step-up Demo</title>
  <style>body{font-family:system-ui;margin:2rem;max-width:900px}</style>
  <script>
    async function post(path, body){
      const r = await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const t = await r.text();
      let j; try{ j=JSON.parse(t) }catch{ j={raw:t} }
      if(!r.ok){throw new Error(JSON.stringify(j))}; return j;
    }
    function b64urlToBuf(b64){return Uint8Array.from(atob(b64.replaceAll('-', '+').replaceAll('_','/')), c=>c.charCodeAt(0));}
    function bufToB64url(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
    async function stepup(){
      const userId = document.getElementById('userId').value;
      const opts = await post('/webauthn/authentication/options',{userId});
      opts.challenge = b64urlToBuf(opts.challenge);
      if(opts.allowCredentials){opts.allowCredentials = opts.allowCredentials.map(c=>({...c,id:b64urlToBuf(c.id)}));}
      const cred = await navigator.credentials.get({publicKey: opts});
      const assertion = {
        id: cred.id,
        rawId: bufToB64url(cred.rawId),
        response: {
          clientDataJSON: bufToB64url(cred.response.clientDataJSON),
          authenticatorData: bufToB64url(cred.response.authenticatorData),
          signature: bufToB64url(cred.response.signature),
          userHandle: cred.response.userHandle?bufToB64url(cred.response.userHandle):null
        },
        type: cred.type
      };
      const tok = await post('/oauth/token',{grant_type:'webauthn', user_id:userId, response: assertion});
      document.getElementById('out').textContent = JSON.stringify(tok,null,2);
      return false;
    }
  </script>
  </head>
<body>
  <h1>WebAuthn L3 Step-up Demo</h1>
  <p>Ensure the user has registered a Passkey. Enable UV in virtual authenticator.</p>
  <label>User ID <input id="userId" placeholder="u1" value="u1"/></label>
  <button onclick="stepup()">Step-up to L3 (get token)</button>
  <pre id="out"></pre>
</body>
</html>`;

const DEMO_WEB_HTML = `<!doctype html><meta charset="utf-8">
<h3>Demo-Web (PC)</h3>
<input id=u placeholder="user id" value="u1">
<button id=go>Start CIBA</button>
<pre id=log></pre>
<script>
const BASE = location.origin;
const log = (...a)=>document.getElementById('log').textContent+=a.join(' ')+'\n';
document.getElementById('go').onclick = async ()=>{
  const user = document.getElementById('u').value||'u1';
  const r = await fetch(BASE+'/backchannel/authentication',{method:'POST',headers:{'Content-Type':'application/json'},
    body: JSON.stringify({client_id:'web', scope:'openid payments', login_hint:user, binding_message:'Confirm $1.00?'})
  }).then(r=>r.json());
  log('auth_req_id =', r.auth_req_id);
  const poll = setInterval(async ()=>{
    const t = await fetch(BASE+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/json'},
      body: JSON.stringify({grant_type:'ciba', auth_req_id:r.auth_req_id})
    }).then(r=>r.json());
    if(t.access_token){
      clearInterval(poll);
      log('OK token acr='+(t.acr||'n/a')+'  access_token=' + t.access_token.slice(0,24)+'...');
    } else if(t.code==='access_denied'){ clearInterval(poll); log('DENIED'); }
    else if(t.code==='expired_token'){ clearInterval(poll); log('EXPIRED'); }
    else if(t.code==='authorization_pending'){ log('PENDING'); }
    else if(t.code==='slow_down'){ log('SLOW_DOWN'); }
    else { log('... waiting'); }
  }, (r.interval||5)*1000);
};
</script>`;

const DEMO_APPROVER_HTML = `<!doctype html><meta charset="utf-8">
<h3>Demo-Approver (Mobile/H5)</h3>
<input id=u placeholder="user id" value="u1"><button id=conn>Connect</button>
<div id=reqs></div><pre id=log></pre>
<script>
const BASE = location.origin;
const log=(...a)=>document.getElementById('log').textContent+=a.join(' ')+'\n';
document.getElementById('conn').onclick=()=>{
  const user=document.getElementById('u').value||'u1';
  let backoff=1000;
  function connect(){
    const es=new EventSource(BASE+'/ciba/stream/'+encodeURIComponent(user));
    es.onmessage = ev=>{
      backoff=1000;
      const m = JSON.parse(ev.data);
      if(m.type==='ciba_request'){
        const div=document.createElement('div');
        const p=document.createElement('p');
        p.innerHTML='<b>Pending:</b> '+(m.binding_message||'')+' <code>'+m.auth_req_id+'</code>';
        const b1=document.createElement('button'); b1.textContent='Approve (L3 optional)'; b1.onclick=()=>approve(m.auth_req_id,1);
        const b2=document.createElement('button'); b2.textContent='Deny'; b2.onclick=()=>approve(m.auth_req_id,0);
        div.appendChild(p); div.appendChild(b1); div.appendChild(document.createTextNode(' ')); div.appendChild(b2);
        document.getElementById('reqs').prepend(div);
      } else if(m.type==='ciba_update'){ log('Update '+m.auth_req_id+' '+m.status); }
    };
    es.onerror = ()=>{
      es.close();
      const jitter = Math.floor(Math.random()*200)-100; // +/-100ms
      setTimeout(connect, Math.max(0, backoff + jitter));
      backoff = Math.min(backoff*2, 5000);
    };
  }
  connect();
};
async function approve(id, ok){
  const user=document.getElementById('u').value||'u1';
  const qs = 'action='+(ok?'approve':'deny')+(ok?'&require_l3=1':'')+'&user_id='+encodeURIComponent(user);
  const url = BASE+'/ciba/approve/'+encodeURIComponent(id)+'?'+qs;
  const r = await fetch(url,{method:'POST'}).then(r=>r.json());
  log('Submitted: '+id+' '+(r.status||'')+' '+(r.acr||''));
}
</script>`;

const DEMO_TX_HTML = `<!doctype html><meta charset="utf-8">
<title>Transaction Signing Demo</title>
<style>body{font-family:system-ui;margin:2rem;max-width:720px}label{display:block;margin:0.5rem 0}</style>
<body>
  <h1>Transaction Signing Demo</h1>
  <p>Call <code>/txn/challenge</code> to mint a transaction JWS for downstream policy checks.</p>
  <label>Transaction ID <input id="txnId" placeholder="txn-123" /></label>
  <label>Amount <input id="amount" type="number" placeholder="2500" /></label>
  <label>Currency <input id="currency" value="USD" /></label>
  <label>Payee <input id="payee" placeholder="Acme Corp" /></label>
  <label>Payer <input id="payer" placeholder="user123" /></label>
  <label>Purpose <input id="purpose" placeholder="Invoice Payment" /></label>
  <button onclick="requestChallenge()">Request Challenge</button>
  <pre id="out"></pre>
  <script>
    async function requestChallenge(){
      const body = {
        txnId: document.getElementById('txnId').value || crypto.randomUUID(),
        amount: Number(document.getElementById('amount').value || 0),
        currency: document.getElementById('currency').value || 'USD',
        payee: document.getElementById('payee').value || 'merchant',
        payer: document.getElementById('payer').value || 'user123',
        purpose: document.getElementById('purpose').value || undefined,
      };
      const r = await fetch('/txn/challenge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const txt = await r.text();
      try {
        const json = JSON.parse(txt);
        document.getElementById('out').textContent = JSON.stringify(json,null,2);
      } catch {
        document.getElementById('out').textContent = txt;
      }
    }
</script>
</body>`;

const DEMO_PASSKEY_HTML = `<!doctype html>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<title>Passkey Quick Test</title>
<style>body{font-family:system-ui;margin:2rem;max-width:760px}button{margin-right:1rem;margin-bottom:1rem}</style>
<h2>Passkey Quick Test (Security Key only)</h2>
<p>Enable Chrome DevTools → WebAuthn → Add virtual authenticator (CTAP2, Resident Key ON, User Verification ON, transport usb). Buttons below use <code>user_id = u1</code>.</p>
<button id="btnReg">Register Passkey (u1)</button>
<button id="btnAuth">Sign in with Passkey (u1)</button>
<pre id="out" style="background:#0b0;color:#fff;padding:12px;min-height:120px"></pre>
<script>
const out=(...a)=>{document.getElementById('out').textContent+=a.join(' ')+'\\n';};
const b2a=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0)).buffer;
const a2b=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const U='u1';

function ensureVirtualEnv(){
  if (!window.isSecureContext || !("credentials" in navigator)) {
    out('error', 'Secure context or WebAuthn API unavailable. Use Chrome with DevTools → WebAuthn virtual authenticator.');
    return false;
  }
  return true;
}

async function reg(){
  if (!ensureVirtualEnv()) return;
  try{
    const opt=await fetch('/webauthn/registration/options?user_id='+U,{credentials:'include'}).then(r=>r.json());
    const chal_id=opt.chal_id, challenge=opt.challenge;
    opt.challenge=b2a(opt.challenge); opt.user.id=b2a(opt.user.id);
    if(opt.excludeCredentials){ opt.excludeCredentials=opt.excludeCredentials.map(c=>({...c,id:b2a(c.id)})); }
    const cred=await navigator.credentials.create({publicKey:opt});
    const att=cred.response;
    const payload={ user_id:U, chal_id, challenge, response:{
      id:cred.id, rawId:a2b(cred.rawId), type:cred.type,
      response:{ clientDataJSON:a2b(att.clientDataJSON), attestationObject:a2b(att.attestationObject) }
    }};
    const res=await fetch('/webauthn/registration/verify',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});
    const json=await res.json().catch(()=>({}));
    out('register', res.status, JSON.stringify(json,null,2));
  }catch(e){
    if (e && e.name === 'NotAllowedError') {
      out('register error','Virtual authenticator not enabled. Open DevTools → WebAuthn and add CTAP2 security key.');
      return;
    }
    out('register error', e?.message||e);
  }
}

async function authn(){
  if (!ensureVirtualEnv()) return;
  try{
    const opt=await fetch('/webauthn/authentication/options?user_id='+U,{credentials:'include'}).then(r=>r.json());
    const challenge=opt.challenge;
    opt.challenge=b2a(opt.challenge);
    if(opt.allowCredentials){ opt.allowCredentials=opt.allowCredentials.map(c=>({...c,id:b2a(c.id)})); }
    const asn=await navigator.credentials.get({publicKey:opt});
    const ar=asn.response;
    const payload={ user_id:U, challenge, response:{
      id:asn.id, rawId:a2b(asn.rawId), type:asn.type,
      response:{ clientDataJSON:a2b(ar.clientDataJSON), authenticatorData:a2b(ar.authenticatorData), signature:a2b(ar.signature), userHandle: ar.userHandle? a2b(ar.userHandle):null }
    }};
    const res=await fetch('/webauthn/authentication/verify',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify(payload)});
    const json=await res.json().catch(()=>({}));
    out('authenticate', res.status, JSON.stringify(json,null,2));
  }catch(e){
    if (e && e.name === 'NotAllowedError') {
      out('authenticate error','Virtual authenticator not enabled. Open DevTools → WebAuthn and add CTAP2 security key.');
      return;
    }
    out('authenticate error', e?.message||e);
  }
}

document.getElementById('btnReg').onclick=reg;
document.getElementById('btnAuth').onclick=authn;
</script>`;

const DEMO_DPOP_HTML = `<!doctype html><meta charset="utf-8">
<title>DPoP Helper</title>
<style>body{font-family:system-ui;margin:2rem;max-width:900px} input,textarea{width:100%}</style>
<h2>DPoP Browser Helper</h2>
<ol>
  <li>Generate P-256 JWK (private key stays in browser)</li>
  <li>Show jkt (JWK thumbprint)</li>
  <li>Enter htm/htu to build dpop+jwt</li>
  <li>Call /dpop/verify to validate</li>
  <li>Send dpop_proof to /oauth/token to bind access_token.cnf.jkt</li>
  </ol>
<button id=gen>Generate Key</button>
<div>jkt: <code id=jkt>-</code></div>
<h3>Build Proof</h3>
<label>HTTP Method <input id=htm value="POST"></label>
<label>HTTP URL (htu) <input id=htu value="${config.baseUrl}/oauth/token"></label>
<button id=make>Make dpop+jwt</button>
<label>DPoP Proof (compact) <textarea id=proof rows=4></textarea></label>
<button id=verify>POST /dpop/verify</button>
<pre id=out></pre>
<script>
let jwkPriv, jwkPub;
const out=(...a)=>{document.getElementById('out').textContent+=a.join(' ')+'\n'};
function b64url(buf){return btoa(String.fromCharCode(...new Uint8Array(buf))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
async function sha256(s){const d=new TextEncoder().encode(s);const h=await crypto.subtle.digest('SHA-256',d);return new Uint8Array(h)}
async function jwkThumbprint(jwk){const t={crv:jwk.crv,kty:jwk.kty,x:jwk.x,y:jwk.y};const s=JSON.stringify(t);const h=await sha256(s);return b64url(h)}
document.getElementById('gen').onclick=async()=>{
  const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  jwkPriv=await crypto.subtle.exportKey('jwk',key.privateKey); jwkPub=await crypto.subtle.exportKey('jwk',key.publicKey);
  const jkt=await jwkThumbprint(jwkPub); document.getElementById('jkt').textContent=jkt; out('jkt=',jkt);
};
async function signCompact(header,payload){
  const enc=s=>b64url(new TextEncoder().encode(JSON.stringify(s)));
  const h=enc(header), p=enc(payload); const data=new TextEncoder().encode(h+'.'+p);
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, await crypto.subtle.importKey('jwk',jwkPriv,{name:'ECDSA',namedCurve:'P-256'},false,['sign']), data);
  return h+'.'+p+'.'+b64url(new Uint8Array(sig));
}
document.getElementById('make').onclick=async()=>{
  if(!jwkPriv){alert('Generate key first');return}
  const htm=document.getElementById('htm').value.trim(); const htu=document.getElementById('htu').value.trim();
  const header={alg:'ES256',typ:'dpop+jwt',jwk:{kty:jwkPub.kty,crv:jwkPub.crv,x:jwkPub.x,y:jwkPub.y}};
  const payload={htm,htu,iat:Math.floor(Date.now()/1000),jti:crypto.randomUUID()};
  const jws=await signCompact(header,payload); document.getElementById('proof').value=jws; out('built proof');
};
document.getElementById('verify').onclick=async()=>{
  const proof=document.getElementById('proof').value.trim(); const htm=document.getElementById('htm').value.trim(); const htu=document.getElementById('htu').value.trim();
  const r=await fetch('${config.baseUrl}/dpop/verify',{method:'POST',headers:{'content-type':'application/json','dpop':proof},body:JSON.stringify({htm,htu})});
  out('verify status', r.status, await r.text());
};
</script>`;



