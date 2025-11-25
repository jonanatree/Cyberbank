import { fullCardIssuance } from "./cardClient.js";
import { addCardLink, findByCardNumber } from "./cardRegistry.js";


export async function applyCard(req, res) {
    try {
        const { firstname, lastname, clientId, savingsAccountId } = req.body;

        if (!clientId || !savingsAccountId) {
            return res.status(400).json({ error: "clientId & savingsAccountId required" });
        }

        const cardInfo = await fullCardIssuance({
            holderName: `${firstname} ${lastname}`,
            initialBalance: 0,
            currency: "AUD",
        });

        await addCardLink({
            clientId,
            savingsAccountId,
            cardNumber: cardInfo.number,
            cardAccountId: cardInfo.cardAccountId,
            cardId: cardInfo.cardId,
        });


        res.status(201).json({
            message: "Card issued successfully",
            clientId,
            savingsAccountId,
            card: cardInfo,
        });
    } catch (err) {
        console.error("applyCard error:", err.response?.data || err.message);
        res.status(err.response?.status || 500).json({
            error: "apply card failed",
            details: err.response?.data || err.message,
        });
    }
}


export async function lookupClientByCard(req, res) {
    const { number } = req.query;

    if (!number) {
        return res.status(400).json({ error: "card number (number) is required" });
    }

    try {
        const link = await findByCardNumber(number);

        if (!link) {
            return res.status(404).json({ error: "card not found in registry" });
        }

        const clientId = link.client_id ?? link.clientId;
        const savingsAccountId = link.savings_account_id ?? link.savingsAccountId;
        const cardNumber = link.card_number ?? link.cardNumber;

        if (!clientId) {
            console.error("lookupClientByCard: found row but clientId is missing", link);
            return res.status(500).json({ error: "card link found but clientId missing" });
        }

        res.json({
            clientId,
            savingsAccountId,
            cardNumber,
            dashboardUrl: `/dashboard/${clientId}`,
        });
    } catch (e) {
        console.error("lookupClientByCard error:", e);
        res.status(500).json({ error: "lookup failed", details: e.message });
    }
}
