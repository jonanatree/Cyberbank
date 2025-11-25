
import cors from "cors";
import express from "express";
import bodyParser from "body-parser";
import { createClient } from "./controllers/clientController.js";
import {
    createSavingsAccount,
    approveSavingsAccount,
    activateSavingsAccount,
    depositToSavings,
    withdrawFromSavings,
    listSavingsTransactions,
} from "./controllers/accountController.js";
import {
    getPaymentHistory,
    getAccountDetails,
    getClientDashboard,
} from "./controllers/analyticsController.js";
import { transferBetweenSavings } from "./controllers/paymentController.js";
import path from "path";
import { fileURLToPath } from "url";
import { onboardClient } from "./controllers/onboardingController.js";
// import { applyCard } from "./controllers/cardController.js";
import { applyCard, lookupClientByCard } from "./controllers/cardController.js";
import { findByCardNumber } from "./controllers/cardRegistry.js";
import { getAllCards } from "./controllers/cardRegistry.js";
import { initCardLinksTable } from "./db.js";





const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "frontend")));

app.use(cors()); // ← 新增，允许所有来源访问

app.use(bodyParser.json());

// health check
app.get("/health", (req, res) => {
    res.json({ status: "Payment API running", connectedTo: process.env.FINERACT_URL || "" });
});

// 调试用：查看所有发过的卡
app.get("/cards/all", (req, res) => {
    res.json(getAllCards());
});


// clients
app.post("/clients", createClient);

app.post("/cards/apply", applyCard);
app.get("/cards/lookup", lookupClientByCard);

// 一键开户（创建 client + 储蓄账户 + 批准 + 激活 + 初始存款）
app.post("/onboard", onboardClient);

app.get("/clients", (req, res) => {
    res.json({
        message: "Payment API running normally. Use POST /clients to create a new client."
    });
});

// deposit account
app.post("/accounts", createSavingsAccount);
app.post("/accounts/:id/approve", approveSavingsAccount);
app.post("/accounts/:id/activate", activateSavingsAccount);
app.post("/accounts/:id/deposit", depositToSavings);
app.post("/accounts/:id/withdraw", withdrawFromSavings);
app.get("/accounts/:id/transactions", listSavingsTransactions);
app.get("/accounts/:id/details", getAccountDetails);

// payment tranfer
app.post("/payments", transferBetweenSavings);
app.get("/payments/history", getPaymentHistory);

// dashboard
app.get("/dashboard/:clientId", getClientDashboard);
// dashboard – 通过卡号查询
app.get("/dashboard/by-card/:cardNumber", async (req, res) => {
    try {
        const { cardNumber } = req.params;

        if (!cardNumber) {
            return res.status(400).json({ error: "cardNumber is required" });
        }

        // 从内存注册表查这张卡
        const link = findByCardNumber(cardNumber);
        if (!link) {
            return res.status(404).json({ error: "Card not found for this number" });
        }

        // 复用原来的 getClientDashboard，构造一个假的 req，把 clientId 塞进去
        const fakeReq = {
            ...req,
            params: { clientId: String(link.clientId) },
            query: req.query,
        };

        return getClientDashboard(fakeReq, res);
    } catch (err) {
        console.error("dashboard/by-card error:", err);
        res.status(500).json({
            error: "dashboard by card failed",
            details: err.message || err,
        });
    }
});

// end restart system
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Payment API is running on port ${PORT}`);
});

(async () => {
    try {
        await initCardLinksTable();
        console.log("card_links table ensured");
    } catch (e) {
        console.error("Failed to ensure card_links table:", e);
    }
})();