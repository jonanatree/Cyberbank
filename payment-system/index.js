import express from "express";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(express.json());

const {
    FINERACT_URL,
    FINERACT_TENANT,
    FINERACT_USER,
    FINERACT_PASSWORD,
    PORT
} = process.env;

// 🔹 Health Check
app.get("/health", (req, res) => {
    res.json({ status: "Payment API running", connectedTo: FINERACT_URL });
});

// 🔹 获取所有客户（测试用）
app.get("/clients", async (req, res) => {
    try {
        const resp = await axios.get(`${FINERACT_URL}/clients`, {
            auth: { username: FINERACT_USER, password: FINERACT_PASSWORD },
            headers: { "Fineract-Platform-TenantId": FINERACT_TENANT },
            httpsAgent: new (await import("https")).Agent({ rejectUnauthorized: false })
        });
        res.json(resp.data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 🔹 示例支付接口（调用 Core Bank 内部 API）
app.post("/transfer", async (req, res) => {
    const { fromClientId, toClientId, amount } = req.body;
    try {
        const payload = {
            fromClientId,
            toClientId,
            amount
        };
        // 你可以在这里替换成对应 fineract 交易 API
        res.json({ message: "Simulated transfer", payload });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Payment API running on port ${PORT}`));
