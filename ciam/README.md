CIAM (Identity Provider) – WebAuthn/Passkeys Demo

Overview
- Node.js + TypeScript + Fastify service exposing WebAuthn (Passkeys) for passwordless login / strong MFA.
- Clean, minimal scaffold; in-memory store for development; ready to swap to Redis later.
- Ships with a tiny /demo page to exercise flows using Chrome DevTools Virtual Authenticator (no hardware needed).

Endpoints
- GET /healthz – health check
- POST /webauthn/registration/options – returns PublicKeyCredentialCreationOptions
- POST /webauthn/registration/verify – verifies attestation and stores credential
- POST /webauthn/authentication/options – returns PublicKeyCredentialRequestOptions
- POST /webauthn/authentication/verify – verifies assertion; issues demo JWT if JWT_PRIVATE_KEY provided
  - Demo JWT claims: sub, username, tenant, acr=urn:webauthn:uv, amr=["webauthn"]
- GET /dev/users – list in-memory users (dev only)
- GET /demo – minimal in-browser demo

OIDC Baseline
- GET /.well-known/openid-configuration
- GET|POST /oauth/authorize – issues code (JSON or 302 redirect)
- POST /oauth/token – grant_type=authorization_code|refresh_token|ciba
- GET /.well-known/jwks.json – JWKS from JWT_PRIVATE_KEY
 - P2: grant_type=webauthn – submit WebAuthn assertion to mint L3 ACR token (use /webauthn/authentication/options to fetch challenge first)

Policies (Step-up)
- POST /policies/decide → { decision: allow|require_step_up|deny, level?: L2|L3 }
  - Defaults: amount ≤ 1000 allow; 1000–10000 L2; >10000 L3; new payee/limit/PIN → L3; new device → L2

CIBA (Poll)
- POST /ciba/auth → { auth_req_id, expires_in, interval } (body: user_id/login_hint, level=L2|L3)
- GET /ciba/approve/:id → Approve/Deny tiny HTML
- /oauth/token grant_type=ciba → mints token with acr urn:step-up:L2|L3

Push Approval (SSE)
- GET /ciba/stream?user_id=... – Server-Sent Events for authenticators to receive CIBA requests
- GET /ciba/mobile?user_id=... – Minimal “mobile app” page listening to stream and approving/denying
- Server pushes events on new CIBA session and on approval status changes

DPoP (Soft Verify)
- POST /dpop/verify – body/header includes DPoP proof; validates htm/htu/iat/jti; returns { ok, jkt }
- /oauth/token accepts optional `dpop_proof` to bind access_token with `cnf.jkt`
- /gateway/check enforces DPoP if token carries `cnf.jkt` and matches `jkt`

Transaction JWS
- POST /txn/challenge → returns { txn_jws, jti, exp }
- POST /txn/verify → verifies signature, fields, and jti anti-replay (in-memory TTL)

Gateway Minimal Check (demo)
- POST /gateway/check with Authorization: Bearer <jwt> and header Fineract-Platform-TenantId
  - Enforces tenant match; route requirements: set-pin → acr≥L3 + txn_jws; limit → L2≤amt≤1000 else L3+txn_jws; payments → L3+txn_jws
  - On step-up needed: 403 { error: STEP_UP_REQUIRED, level }
  - On missing/invalid txn signature: 403 { error: TXSIGN_INVALID }

Config (env)
- CIAM_PORT (default 3001)
- CIAM_BASE_URL (default http://localhost:3001)
- WEBAUTHN_RP_ID (default localhost) – set to bank.local for subdomain RP
- WEBAUTHN_ORIGIN (default http://localhost:3001)
- OIDC_ISSUER / JWT_ISSUER (default CIAM_BASE_URL)
- JWT_PRIVATE_KEY (optional PKCS#8 PEM, PS256) – if present, /webauthn/authentication/verify returns a demo JWT
- TENANT_ID (default: "default") – embedded in demo JWT as tenant
- CORS_ORIGINS (comma list; default http://localhost:3000,https://app.bank.local)

Local Dev
1) Install deps and run
   - npm i
   - npm run dev
2) Open Chrome → DevTools → More tools → WebAuthn → Enable and Add Virtual Authenticator
   - Choose Platform or Cross-platform; enable Resident Key and User Verification
3) Visit http://localhost:3001/demo to register/login with passkey

Bank Local Domains (optional)
- Add hosts: 127.0.0.1 bank.local app.bank.local api.bank.local idp.bank.local
- Generate TLS via mkcert for bank.local and *.bank.local; run CIAM under https and set:
  - CIAM_BASE_URL=https://idp.bank.local:3001
  - WEBAUTHN_RP_ID=bank.local
  - WEBAUTHN_ORIGIN=https://idp.bank.local:3001

Notes
- This is not a full OIDC provider yet. It focuses on Passkey login; OIDC Authorization Code + PKCE can be layered next.
- Memory store is for demo only; replace with Redis/DB in production.

Error Format (Unified)
- All errors follow: `{ code, message, status, details?, trace_id }`
- Examples:
  - 401 UNAUTHENTICATED
  - 403 TENANT_MISMATCH
  - 403 STEP_UP_REQUIRED with `{ level }`
  - 403 TXSIGN_INVALID, 429 REPLAY_DETECTED
  - 400 AUTHORIZATION_PENDING (CIBA), 400 INVALID_GRANT (pkce_failed)

Audit (Minimal)
- File: `ciam/logs/audit.ndjson` (set via `AUDIT_FILE`; empty = stdout only)
- Events: AUTH_SUCCESS, TOKEN_REFRESHED, POLICY_DECISION, CIBA_STARTED/APPROVED/DENIED/EXPIRED, TX_CHALLENGE_ISSUED, TX_VERIFIED, TX_REPLAY_BLOCKED, TX_INVALID, GATEWAY_ALLOW/DENY
