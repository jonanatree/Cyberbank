// controllers/onboardingController.js
import { fineract, stdDates } from "./fineractClient.js";
import { fullCardIssuance } from "./cardClient.js";


export async function onboardClient(req, res) {
    try {
        const {
            firstname,
            lastname,
            openingBalance = 0,  // 初始存入金额，可选
            productId = 1,       // 储蓄产品 ID，默认 1
        } = req.body;

        if (!firstname || !lastname) {
            return res.status(400).json({ error: "firstname and lastname are required" });
        }

        const { dateFormat, locale, formatted } = stdDates();

        // 1️⃣ 创建 client
        const clientPayload = {
            officeId: 1,
            firstname,
            lastname,
            legalFormId: 1,
            dateFormat,
            locale,
            active: true,
            activationDate: formatted,
            submittedOnDate: formatted,
        };

        const clientRes = await fineract.post("/clients", clientPayload);
        const clientId =
            clientRes.data.clientId ||
            clientRes.data.resourceId ||
            clientRes.data.officeId; // 最保险多兜底一下

        if (!clientId) {
            return res.status(500).json({
                error: "Failed to get clientId from Fineract response",
                details: clientRes.data,
            });
        }

        // 2️⃣ 创建储蓄账户
        const savingsPayload = {
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
            minRequiredOpeningBalance: 0,
            lockinPeriodFrequency: 0,
            lockinPeriodFrequencyType: 0,
            withdrawalFeeForTransfers: false,
            allowOverdraft: false,
            enforceMinRequiredBalance: false,
            withHoldTax: false,
        };

        const savingsRes = await fineract.post("/savingsaccounts", savingsPayload);
        const savingsAccountId =
            savingsRes.data.savingsId ||
            savingsRes.data.accountId ||
            savingsRes.data.resourceId;

        if (!savingsAccountId) {
            return res.status(500).json({
                error: "Failed to get savingsAccountId from Fineract response",
                details: savingsRes.data,
            });
        }

        // 3️⃣ 批准账户
        const approvePayload = { dateFormat, locale, approvedOnDate: formatted };
        await fineract.post(`/savingsaccounts/${savingsAccountId}?command=approve`, approvePayload);

        // 4️⃣ 激活账户
        const activatePayload = { dateFormat, locale, activatedOnDate: formatted };
        await fineract.post(`/savingsaccounts/${savingsAccountId}?command=activate`, activatePayload);

        // 5️⃣ 可选：初始存款
        if (openingBalance > 0) {
            const depositPayload = {
                dateFormat,
                locale,
                transactionDate: formatted,
                transactionAmount: openingBalance,
                paymentTypeId: 1,  // Money Transfer
            };
            await fineract.post(
                `/savingsaccounts/${savingsAccountId}/transactions?command=deposit`,
                depositPayload
            );
        }

        let card = null;
        try {
            card = await fullCardIssuance({
                holderName: `${firstname} ${lastname}`,
                initialBalance: 0, // 这里只是卡系统里的账户余额，你可以先设 0
                currency: "AUD",
            });
        } catch (e) {
            console.error(
                "Issue card during onboard failed:",
                e.response?.data || e.message
            );
            card = null;
        }

        // 6️⃣ 返回结果（你关心的 clientId、savingsAccountId）
        res.status(201).json({
            clientId,
            savingsAccountId,
            initialDeposit: openingBalance,
            message: "Client onboarded successfully",
        });
    } catch (err) {
        console.error("Error in onboardClient:", err.response?.data || err.message);
        res.status(err.response?.status || 500).json({
            error: "Onboarding failed",
            details: err.response?.data || err.message,
        });
    }
}
