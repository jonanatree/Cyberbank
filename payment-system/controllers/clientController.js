import axios from "axios";
import https from "https";


const FINERACT_URL = process.env.FINERACT_URL || "https://localhost:8443/fineract-provider/api/v1";
const FINERACT_TENANT = process.env.FINERACT_TENANT || "default";
const AUTH = {
    username: process.env.FINERACT_USER || "mifos",
    password: process.env.FINERACT_PASSWORD || "password",
};

export async function createClient(req, res) {
    try {
        const body = {
            officeId: 1,
            firstname: req.body.firstname || "Test",
            lastname: req.body.lastname || "User",
            legalFormId: 1,
            dateFormat: "dd MMMM yyyy",
            locale: "en",
            active: true,
            activationDate: "18 October 2025",
            submittedOnDate: "18 October 2025",
            // no send clientTypeId、clientClassificationId、genderId、legalFormId
        };

        const response = await axios.post(`${FINERACT_URL}/clients`, body, {
            auth: AUTH,
            headers: { "Fineract-Platform-TenantId": FINERACT_TENANT },
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });

        res.json(response.data);
    } catch (err) {
        res.status(500).json({
            error: err.message,
            data: err.response?.data || err.stack,
        });
    }
}
