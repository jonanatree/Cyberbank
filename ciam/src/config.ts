export interface AppConfig {
  port: number;
  baseUrl: string; // e.g., https://idp.bank.local:3001 or http://localhost:3001
  rpId: string; // e.g., bank.local or localhost
  rpName: string;
  origin: string; // allowed RP origin for WebAuthn
  jwtIssuer: string;
  jwtPrivateKeyPEM?: string; // optional dev key for demo token issuance
  corsOrigins: string[];
  tenant: string;
  auditFile?: string;
  enforceTxSignature: boolean;
  enforceL3Strict: boolean;
  requireDpop: boolean;
  enableTxnSigning: boolean;
  webauthnRoamingOnly: boolean;
  showDemos: string[];
}

function env(name: string, def?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") return def ?? "";
  return v;
}

export const config: AppConfig = {
  port: parseInt(env("CIAM_PORT", "3001"), 10),
  baseUrl: env("CIAM_BASE_URL", "http://localhost:3001"),
  rpId: env("WEBAUTHN_RP_ID", env("RP_ID", "localhost")),
  rpName: env("WEBAUTHN_RP_NAME", "Cyberbank CIAM"),
  origin: env("WEBAUTHN_ORIGIN", env("ORIGIN", "http://localhost:3001")),
  jwtIssuer: env("OIDC_ISSUER", env("JWT_ISSUER", env("CIAM_BASE_URL", "http://localhost:3001"))),
  jwtPrivateKeyPEM: env("JWT_PRIVATE_KEY", undefined),
  corsOrigins: env("CORS_ORIGINS", "http://localhost:3000,https://app.bank.local")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  tenant: env("TENANT_ID", "default"),
  auditFile: env("AUDIT_FILE", "ciam/logs/audit.ndjson"),
  enforceTxSignature: env("ENFORCE_TX_SIGNATURE", "false").toLowerCase() === "true",
  enforceL3Strict: env("ENFORCE_L3_STRICT", "false").toLowerCase() === "true",
  requireDpop: env("REQUIRE_DPOP", "false").toLowerCase() === "true",
  enableTxnSigning: env("ENABLE_TXN_SIGNING", "false").toLowerCase() === "true",
  webauthnRoamingOnly: env("WEBAUTHN_ROAMING_ONLY", "true").toLowerCase() === "true",
  showDemos: env("SHOW_DEMOS", "demo-web,demo-approver")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
