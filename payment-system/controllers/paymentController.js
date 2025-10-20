

// controllers/paymentController.js
import { fineract, stdDates } from "./fineractClient.js";

// ：from → withdraw， to → deposit
// POST /payments { fromAccountId, toAccountId, amount }
export async function transferBetweenSavings(req, res) {
    const { fromAccountId, toAccountId, amount } = req.body;
    if (!fromAccountId || !toAccountId || !amount) {
        return res.status(400).json({ error: "fromAccountId, toAccountId, amount are required" });
    }
    if (fromAccountId === toAccountId)
        return res.status(400).json({ error: "fromAccountId and toAccountId must differ" });
    if (amount <= 0) return res.status(400).json({ error: "amount must be > 0" });

    const { dateFormat, locale, formatted } = stdDates();

    try {
        // 1 take money fromAccount）
        const debitPayload = {
            dateFormat,
            locale,
            transactionDate: formatted,
            transactionAmount: amount,
            paymentTypeId: 1, // 
        };
        const debit = await fineract.post(
            `/savingsaccounts/${fromAccountId}/transactions?command=withdrawal`,
            debitPayload
        );

        // 2 put money（toAccount）
        const creditPayload = {
            dateFormat,
            locale,
            transactionDate: formatted,
            transactionAmount: amount,
            paymentTypeId: 1, // 
        };
        const credit = await fineract.post(
            `/savingsaccounts/${toAccountId}/transactions?command=deposit`,
            creditPayload
        );

        res.json({
            status: "OK",
            message: "Transfer completed successfully",
            debit: debit.data,
            credit: credit.data,
        });
    } catch (err) {
        res.status(500).json({
            error: err.message,
            data: err.response?.data || err.stack,
        });
    }
}
