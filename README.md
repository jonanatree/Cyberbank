# CIAM Integration (Zero changes to core bank code)

Modes: Basic | Embedded OAuth2 | External CIAM (Keycloak). Env lives in `core_bank/config/docker/env/`.

Select mode: `make env-external` then bring up Core Bank compose. For External CIAM, run Nginx gateway (infra/gateway) to block embedded IdP endpoints.

BFF: reuse `payment-system/` with `AUTH_MODE=BASIC|EXTERNAL_CIAM` (minimal patch). Windows users can use PowerShell scripts in `scripts/ciam/` and `scripts/env/`.

## Runbook – Failover & Evidence

- Failover: Basic ↔ External‑CIAM
  1) Switch env: `make env-basic` or `make env-external` (soft copy to `core_bank/config/docker/env/fineract.env`).
  2) Restart Core Bank compose: `cd core_bank && docker compose -f docker-compose-postgresql.yml up -d`.
  3) External‑CIAM模式：启动网关 `docker compose -f infra/gateway/docker-compose.nginx.yml up -d`；Basic模式：可直接通过 8443 访问。
  4) Payment/BFF：`AUTH_MODE=BASIC` 或 `AUTH_MODE=EXTERNAL_CIAM`（并配置 `KEYCLOAK_ISSUER/CLIENT_ID/CLIENT_SECRET`）。

- Evidence（证据留存）
  - 运行 `scripts/ciam/run-gates.sh external-ciam`（或 basic），自动将 smoke/负例输出保存到 `verification/reports/<YYYYMMDD-HHMMSS>/` 目录，包含响应码与时间戳。
  - 通过这些包进行 Go/No‑Go 审核与审计展示。
