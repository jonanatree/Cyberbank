
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

// clients
app.post("/clients", createClient);

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

// end restart system
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Payment API is running on port ${PORT}`);
});
