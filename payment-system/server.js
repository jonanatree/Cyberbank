

import express from "express";
import { ciamEnforcer } from "./middleware/ciamEnforcer.js";
import { startHealthProbe, getHealth } from "./health/health.js";
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

const app = express();
app.use(express.json());
// CIAM fail-closed enforcement (tenant + scope), defaults: enforce on EXTERNAL_CIAM
app.use(ciamEnforcer());

// health probe (issuer/jwks reachability)
if (process.env.AUTH_MODE === 'EXTERNAL_CIAM') {
  const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8081/realms/fineract';
  const iv = parseInt(process.env.HEALTH_INTERVAL_SEC || '60', 10);
  startHealthProbe({ issuer, intervalSec: iv });
}

// health check
app.get("/health", (req, res) => {
    res.json({ status: "Payment API running", connectedTo: process.env.FINERACT_URL || "" });
});

app.get('/healthz', (req, res) => {
  const h = getHealth();
  res.status(h.ok ? 200 : 503).json(h);
});

// clients
app.post("/clients", createClient);

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
    console.log(`🚀 Payment API is running on port ${PORT}`);
});
