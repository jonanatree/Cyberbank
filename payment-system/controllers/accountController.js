
// controllers/accountController.js
import { fineract, stdDates } from "./fineractClient.js";

// create account
export async function createSavingsAccount(req, res) {
    try {
        const { clientId, productId = 1, openingBalance = 0 } = req.body;
        if (!clientId) return res.status(400).json({ error: "clientId is required" });

        const { dateFormat, locale, formatted } = stdDates();
        const payload = {
            clientId,
            productId,
            locale,
            dateFormat,
            submittedOnDate: formatted,
            nominalAnnualInterestRate: 0,
            interestCompoundingPeriodType: 1,
            interestPostingPeriodType: 4,
            interestCalculationType: 1,
            interestCalculationDaysInYearType: 365,
            minRequiredOpeningBalance: openingBalance,
            lockinPeriodFrequency: 0,
            lockinPeriodFrequencyType: 0,
            withdrawalFeeForTransfers: false,
            allowOverdraft: false,
            enforceMinRequiredBalance: false,
            withHoldTax: false,
        };

        const r = await fineract.post(`/savingsaccounts`, payload);
        res.json(r.data);
    } catch (err) {
        res.status(500).json({ error: err.message, data: err.response?.data || err.stack });
    }
}

// approve
export async function approveSavingsAccount(req, res) {
    try {
        const { id } = req.params;
        const { dateFormat, locale, formatted } = stdDates();
        const payload = { dateFormat, locale, approvedOnDate: formatted };
        const r = await fineract.post(`/savingsaccounts/${id}?command=approve`, payload);
        res.json(r.data);
    } catch (err) {
        res.status(500).json({ error: err.message, data: err.response?.data || err.stack });
    }
}

// activate
export async function activateSavingsAccount(req, res) {
    try {
        const { id } = req.params;
        const { dateFormat, locale, formatted } = stdDates();
        const payload = { dateFormat, locale, activatedOnDate: formatted };
        const r = await fineract.post(`/savingsaccounts/${id}?command=activate`, payload);
        res.json(r.data);
    } catch (err) {
        res.status(500).json({ error: err.message, data: err.response?.data || err.stack });
    }
}

// deposit
export async function depositToSavings(req, res) {
    try {
        const { id } = req.params;
        const { amount } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ error: "amount must be > 0" });

        const { dateFormat, locale, formatted } = stdDates();
        const payload = {
            dateFormat,
            locale,
            transactionDate: formatted,
            transactionAmount: amount,
            paymentTypeId: 1,  //  Money Transfer
        };

        const r = await fineract.post(`/savingsaccounts/${id}/transactions?command=deposit`, payload);
        res.json(r.data);
    } catch (err) {
        res.status(500).json({ error: err.message, data: err.response?.data || err.stack });
    }
}

// withdraw
export async function withdrawFromSavings(req, res) {
    try {
        const { id } = req.params;
        const { amount } = req.body;
        if (!amount || amount <= 0) return res.status(400).json({ error: "amount must be > 0" });

        const { dateFormat, locale, formatted } = stdDates();
        const payload = {
            dateFormat,
            locale,
            transactionDate: formatted,
            transactionAmount: amount,
            paymentTypeId: 1,  // Money Transfer
        };

        const r = await fineract.post(`/savingsaccounts/${id}/transactions?command=withdrawal`, payload);
        res.json(r.data);
    } catch (err) {
        res.status(500).json({ error: err.message, data: err.response?.data || err.stack });
    }
}

// search transfer history
export async function listSavingsTransactions(req, res) {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ error: "Account ID required" });

        const r = await fineract.get(`/savingsaccounts/${id}?associations=transactions`);
        const txs = r.data?.transactions || [];

        const result = txs.map(tx => ({
            id: tx.id,
            date: tx.date || tx.submittedOnDate,
            type: tx.transactionType?.value || "Unknown",
            amount: tx.amount,
            currency: tx.currency?.code,
            runningBalance: tx.runningBalance,
            reversed: tx.reversed,
        }));

        res.json({
            accountId: id,
            total: result.length,
            transactions: result,
        });
    } catch (err) {
        res.status(500).json({
            error: err.message,
            data: err.response?.data || err.stack,
        });
    }
}

// search account balance
// GET /balance/:id
export async function getSavingsBalance(req, res) {
    try {
        const { id } = req.params;
        if (!id) return res.status(400).json({ error: "Account ID required" });

        const r = await fineract.get(`/savingsaccounts/${id}`);

        const data = r.data;
        const balance = data.summary?.accountBalance || 0;
        const available = data.summary?.availableBalance || 0;
        const clientName = data.clientName || data.clientId || "Unknown";
        const status = data.status?.value || "Unknown";

        res.json({
            accountId: id,
            clientName,
            status,
            balance,
            availableBalance: available,
            currency: data.currency?.code || "AUD",
            productName: data.savingsProductName,
        });
    } catch (err) {
        res.status(500).json({ error: err.message, data: err.response?.data || err.stack });
    }
}
