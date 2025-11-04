// controllers/fineractClient.js
import axios from "axios";
import https from "https";
import { getClientCredentialsToken } from "../security/tokenCache.js";

// --- CIAM ADD BEGIN ---
export const AUTH_MODE = process.env.AUTH_MODE ?? "BASIC"; // BASIC | EXTERNAL_CIAM
export const KEYCLOAK_ISSUER = process.env.KEYCLOAK_ISSUER ?? "http://localhost:8081/realms/fineract";
export const CLIENT_ID = process.env.CLIENT_ID ?? "payment-bff";
export const CLIENT_SECRET = process.env.CLIENT_SECRET ?? "CHANGE_ME";
export const CIAM_SCOPE = process.env.CIAM_SCOPE ?? "fineract.write payments.execute";
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

function base64UrlDecode(str) {
    try {
        let s = str.replace(/-/g, "+").replace(/_/g, "/");
        while (s.length % 4) s += "=";
        return Buffer.from(s, "base64").toString("utf8");
    } catch {
        return "{}";
    }
}

export async function getServiceToken() {
    // use single-flight cache
    return getClientCredentialsToken({ issuer: KEYCLOAK_ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, scope: CIAM_SCOPE });
}

export async function ciamAuthHeaders() {
    if (AUTH_MODE === "EXTERNAL_CIAM") {
        const token = await getServiceToken();
        return { Authorization: `Bearer ${token}` };
    }
    // BASIC fallback (current integration)
    const user = process.env.FINERACT_USER || "mifos";
    const pass = process.env.FINERACT_PASSWORD || "password";
    const basic = Buffer.from(`${user}:${pass}`).toString("base64");
    return { Authorization: `Basic ${basic}` };
}
// --- CIAM ADD END ---

const baseURL = process.env.FINERACT_URL; // : https://fineract-development:8443/fineract-provider/api/v1
const FINERACT_TENANT = process.env.FINERACT_TENANT || "default";

if (!baseURL) {
    throw new Error("FINERACT_URL is not set in environment!");
}

export const fineract = axios.create({
    baseURL,
    headers: { "Fineract-Platform-TenantId": FINERACT_TENANT },
    httpsAgent,
});

// Attach Authorization per mode on each request without changing callers
fineract.interceptors.request.use(async (config) => {
    const auth = await ciamAuthHeaders();

    // Derive tenant from token when enforced
    let tenant = FINERACT_TENANT;
    try {
        if (AUTH_MODE === "EXTERNAL_CIAM" && process.env.ENFORCE_TENANT_FROM_TOKEN !== "false") {
            const b = (await getServiceToken()).split(".")[1];
            const payload = JSON.parse(base64UrlDecode(b));
            if (payload && payload.tenant) tenant = payload.tenant;
        }
    } catch { /* ignore decode errors, fallback to env tenant */ }

    // set mandatory headers and prevent override by callers; attach subject hint for gateway limiting
    const headersOut = { ...(config.headers || {}), ...auth, "Fineract-Platform-TenantId": tenant };
    if (AUTH_MODE === "EXTERNAL_CIAM") {
        try {
            const tok = await getServiceToken();
            const pl = JSON.parse(base64UrlDecode(tok.split('.')[1]||''));
            headersOut['X-Subject'] = pl.sub;
            headersOut['X-Azp'] = pl.azp || 'payment-bff';
            headersOut['X-Scope'] = pl.scope || '';
            headersOut['X-Tenant'] = tenant;
        } catch {}
    }
    config.headers = headersOut;

    // also normalize query param tenantIdentifier if present
    if (config.params && Object.prototype.hasOwnProperty.call(config.params, "tenantIdentifier")) {
        config.params.tenantIdentifier = tenant;
    }
    return config;
});

// real date + locale
export function stdDates(date = new Date()) {
    // 用 “dd MMMM yyyy”  “18 October 2025”
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, "0");
    const monthName = d.toLocaleString("en", { month: "long" });
    const year = d.getFullYear();
    return {
        dateFormat: "dd MMMM yyyy",
        locale: "en",
        formatted: `${day} ${monthName} ${year}`,
    };
}

// Fineract may return dates as [yyyy, mm, dd]
export function parseFineractDate(x) {
    if (!x) return new Date(NaN);
    if (Array.isArray(x) && x.length >= 3) {
        const [y, m, d] = x;
        return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    }
    if (typeof x === 'object' && x.year && x.month && x.day) {
        return new Date(Date.UTC(Number(x.year), Number(x.month) - 1, Number(x.day)));
    }
    return new Date(x);
}

export function toIsoDateString(d) {
    const dd = d instanceof Date ? d : new Date(d);
    return isNaN(dd.getTime()) ? null : dd.toISOString().slice(0, 10);
}
