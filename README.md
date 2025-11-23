# Cyberbank Monorepo

Cleaned foundation for the core banking stack. Legacy placeholder front-end/BFF assets were removed to make room for the new architecture (Next.js App Router + Node/TypeScript Orchestrator).

Current components:
- `core_bank/` – Apache Fineract setup.
- `modules/bank-card/` – issuer/acquirer stack with dynamic CVV support.
- `payment-system/` – payment orchestration helpers.
- `ciam/` – Keycloak based IAM.

Next steps (planned):
- Add `orchestrator/` service (Express + TypeScript) that fronts Fineract and the card API.
- Add `frontend/` (Next.js) that talks only to the orchestrator.
- Introduce new docker-compose for orchestrator + frontend (optional) once services land.

Refer to component-specific READMEs under each folder for build/run instructions. The previous `apps/bff`, `apps/web`, and `docker-compose.bff-web.yml` entries were intentionally removed during cleanup.
