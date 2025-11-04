

// controllers/paymentController.js
import { fineract, stdDates } from "./fineractClient.js";

// ：from → withdraw， to → deposit
// POST /payments { fromAccountId, toAccountId, amount }
export async function transferBetweenSavings(req, res) {
    const { fromAccountId, toAccountId, amount, description } = req.body;
    if (!fromAccountId || !toAccountId || !amount) {
        return res.status(400).json({ error: "fromAccountId, toAccountId, amount are required" });
    }
    if (fromAccountId === toAccountId)
        return res.status(400).json({ error: "fromAccountId and toAccountId must differ" });
    if (amount <= 0) return res.status(400).json({ error: "amount must be > 0" });

    const { dateFormat, locale, formatted } = stdDates();

    // Prefer Fineract atomic account transfer endpoint. Fallback to two-step with compensation.
    const payload = {
        fromAccountType: 2, // 2 = Savings
        fromAccountId,
        toAccountType: 2,
        toAccountId,
        transferAmount: amount,
        transferDate: formatted,
        dateFormat,
        locale,
        transferDescription: description || "Internal transfer",
    };

    try {
        const r = await fineract.post(`/accounttransfers`, payload);
        return res.json({ status: "OK", message: "Transfer completed", transfer: r.data });
    } catch (primaryErr) {
        // If the endpoint is unavailable or validation fails, try legacy debit/credit with compensation
        try {
            const debitPayload = {
                dateFormat,
                locale,
                transactionDate: formatted,
                transactionAmount: amount,
                paymentTypeId: 1,
            };
            const debit = await fineract.post(
                `/savingsaccounts/${fromAccountId}/transactions?command=withdrawal`,
                debitPayload
            );

            const creditPayload = {
                dateFormat,
                locale,
                transactionDate: formatted,
                transactionAmount: amount,
                paymentTypeId: 1,
            };
            const credit = await fineract.post(
                `/savingsaccounts/${toAccountId}/transactions?command=deposit`,
                creditPayload
            );

            return res.json({
                status: "OK",
                message: "Transfer completed (fallback)",
                debit: debit.data,
                credit: credit.data,
            });
        } catch (fallbackErr) {
            // Compensation: if debit succeeded and credit failed, try to refund source account
            try {
                await fineract.post(
                    `/savingsaccounts/${fromAccountId}/transactions?command=deposit`,
                    {
                        dateFormat,
                        locale,
                        transactionDate: formatted,
                        transactionAmount: amount,
                        paymentTypeId: 1,
                    }
                );
                return res.status(500).json({
                    error: "transfer-failed-rolled-back",
                    cause: fallbackErr.message,
                    primaryError: primaryErr.response?.data || primaryErr.message,
                });
            } catch (compErr) {
                return res.status(500).json({
                    error: "transfer-failed-partial",
                    cause: fallbackErr.message,
                    rollbackError: compErr.response?.data || compErr.message,
                    primaryError: primaryErr.response?.data || primaryErr.message,
                });
            }
        }
    }
}
