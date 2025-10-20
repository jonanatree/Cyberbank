// controllers/analyticsController.js
import { fineract, stdDates } from "./fineractClient.js";

// search all transaction history
export async function getPaymentHistory(req, res) {
    try {
        const { clientId, from, to } = req.query;
        if (!clientId) return res.status(400).json({ error: "clientId is required" });

        // take clients list
        const accRes = await fineract.get(`/clients/${clientId}/accounts`);
        const accounts = accRes.data?.savingsAccounts || [];

        let allTx = [];
        for (const acc of accounts) {
            const txRes = await fineract.get(`/savingsaccounts/${acc.id}?associations=transactions`);
            const txs = txRes.data?.transactions || [];
            txs.forEach(t => {
                const date = new Date(t.date || t.submittedOnDate);
                if (
                    (!from || date >= new Date(from)) &&
                    (!to || date <= new Date(to))
                ) {
                    allTx.push({
                        accountId: acc.id,
                        productName: acc.productName,
                        type: t.transactionType?.value,
                        amount: t.amount,
                        date: t.date || t.submittedOnDate,
                        runningBalance: t.runningBalance,
                    });
                }
            });
        }

        allTx.sort((a, b) => new Date(b.date) - new Date(a.date));

        res.json({
            clientId,
            total: allTx.length,
            transactions: allTx,
        });
    } catch (err) {
        res.status(500).json({ error: err.message, data: err.response?.data || err.stack });
    }
}

// last 5 action
export async function getAccountDetails(req, res) {
    try {
        const { id } = req.params;
        const r = await fineract.get(`/savingsaccounts/${id}?associations=transactions`);
        const d = r.data;

        const summary = d.summary || {};
        const recent = (d.transactions || []).slice(0, 5).map(t => ({
            id: t.id,
            date: t.date || t.submittedOnDate,
            type: t.transactionType?.value,
            amount: t.amount,
            runningBalance: t.runningBalance,
        }));

        res.json({
            accountId: id,
            productName: d.savingsProductName,
            status: d.status?.value,
            balance: summary.accountBalance,
            availableBalance: summary.availableBalance,
            recentTransactions: recent,
        });
    } catch (err) {
        res.status(500).json({ error: err.message, data: err.response?.data || err.stack });
    }
}

//clients overview Dashboard
export async function getClientDashboard(req, res) {
    try {
        const { clientId } = req.params;
        if (!clientId) return res.status(400).json({ error: "clientId is required" });

        const accRes = await fineract.get(`/clients/${clientId}/accounts`);
        const accounts = accRes.data?.savingsAccounts || [];

        let totalBalance = 0;
        let monthlyDeposits = 0;
        let monthlyWithdrawals = 0;
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        for (const acc of accounts) {
            const r = await fineract.get(`/savingsaccounts/${acc.id}?associations=transactions`);
            const d = r.data;
            totalBalance += d.summary?.accountBalance || 0;

            (d.transactions || []).forEach(tx => {
                const txDate = new Date(tx.date || tx.submittedOnDate);
                if (txDate >= startOfMonth) {
                    if (tx.transactionType?.value?.toLowerCase().includes("deposit"))
                        monthlyDeposits += tx.amount;
                    if (tx.transactionType?.value?.toLowerCase().includes("withdrawal"))
                        monthlyWithdrawals += tx.amount;
                }
            });
        }

        res.json({
            clientId,
            totalBalance,
            accounts: accounts.map(a => ({
                id: a.id,
                productName: a.productName,
            })),
            monthlySummary: {
                deposits: monthlyDeposits,
                withdrawals: monthlyWithdrawals,
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message, data: err.response?.data || err.stack });
    }
}
