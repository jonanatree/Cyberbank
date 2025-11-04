import { fineract, stdDates } from "./fineractClient.js";

export async function createClient(req, res) {
    try {
        const { dateFormat, locale, formatted } = stdDates();
        const body = {
            officeId: 1,
            firstname: req.body.firstname || "Test",
            lastname: req.body.lastname || "User",
            legalFormId: 1,
            dateFormat,
            locale,
            active: true,
            activationDate: formatted,
            submittedOnDate: formatted,
        };

        const response = await fineract.post(`/clients`, body);
        res.json(response.data);
    } catch (err) {
        res.status(500).json({
            error: err.message,
            data: err.response?.data || err.stack,
        });
    }
}
