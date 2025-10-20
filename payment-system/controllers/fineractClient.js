// controllers/fineractClient.js
import axios from "axios";
import https from "https";

const baseURL = process.env.FINERACT_URL; // : https://fineract-development:8443/fineract-provider/api/v1
const FINERACT_TENANT = process.env.FINERACT_TENANT || "default";
const FINERACT_USER = process.env.FINERACT_USER || "mifos";
const FINERACT_PASSWORD = process.env.FINERACT_PASSWORD || "password";

if (!baseURL) {
    throw new Error("FINERACT_URL is not set in environment!");
}

export const fineract = axios.create({
    baseURL,
    auth: { username: FINERACT_USER, password: FINERACT_PASSWORD },
    headers: { "Fineract-Platform-TenantId": FINERACT_TENANT },
    httpsAgent: new https.Agent({ rejectUnauthorized: false }), // 
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
