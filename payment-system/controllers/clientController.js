// import axios from "axios";
// import https from "https";


// const FINERACT_URL = process.env.FINERACT_URL || "https://localhost:8443/fineract-provider/api/v1";
// const FINERACT_TENANT = process.env.FINERACT_TENANT || "default";
// const AUTH = {
//     username: process.env.FINERACT_USER || "mifos",
//     password: process.env.FINERACT_PASSWORD || "password",
// };

// export async function createClient(req, res) {
//     try {
//         const body = {
//             officeId: 1,
//             firstname: req.body.firstname || "Test",
//             lastname: req.body.lastname || "User",
//             legalFormId: 1,
//             dateFormat: "dd MMMM yyyy",
//             locale: "en",
//             active: true,
//             activationDate: "18 October 2025",
//             submittedOnDate: "18 October 2025",
//             // no send clientTypeId、clientClassificationId、genderId、legalFormId
//         };

//         const response = await axios.post(`${FINERACT_URL}/clients`, body, {
//             auth: AUTH,
//             headers: { "Fineract-Platform-TenantId": FINERACT_TENANT },
//             httpsAgent: new https.Agent({ rejectUnauthorized: false }),
//         });

//         res.json(response.data);
//     } catch (err) {
//         res.status(500).json({
//             error: err.message,
//             data: err.response?.data || err.stack,
//         });
//     }
// }








import axios from "axios";
import https from "https";

const FINERACT_URL = process.env.FINERACT_URL;           // 例如 https://core_bank-fineract-1:8443/fineract-provider/api/v1
const FINERACT_TENANT = process.env.FINERACT_TENANT;     // default
const FINERACT_USER = process.env.FINERACT_USER;         // mifos
const FINERACT_PASSWORD = process.env.FINERACT_PASSWORD; // password

// 忽略自签名证书（你 docker-compose 里已经设了 NODE_TLS_REJECT_UNAUTHORIZED=0，这里再保险一次）
// const httpsAgent = new https.Agent({
//     rejectUnauthorized: false,
// });
const httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    // 强制 SNI 用 localhost（和你 curl 的场景保持一致）
    servername: "localhost",
    // 一些 Java TLS 配置对 TLS1.3 支持不太好，直接锁到 1.2 最稳
    minVersion: "TLSv1.2",
    maxVersion: "TLSv1.2",
});

export async function createClient(req, res) {
    try {
        const { firstname, lastname } = req.body;

        // 根据 Fineract API 要求构造 payload
        const payload = {
            firstname: req.body.firstname || "Test",
            lastname: req.body.lastname || "User",
            locale: "en",
            dateFormat: "dd MMMM yyyy",
            active: true,
            activationDate: "01 January 2025",
            submittedOnDate: "18 October 2025",
            officeId: 1,
            legalFormId: 1,   // ✅ 新增：个人
        };


        // ✅ 正确拼 URL：一定是 纯 FINERACT_URL + "/clients"
        const url = `${FINERACT_URL}/clients`;

        console.log("Calling Fineract create client:", url);

        const response = await axios.post(url, payload, {
            auth: {
                username: FINERACT_USER,
                password: FINERACT_PASSWORD,
            },
            params: {
                tenantIdentifier: FINERACT_TENANT,
            },
            headers: {
                Host: "localhost", // ✅ 关键：HTTP Host 头也伪装成 localhost
                "Fineract-Platform-TenantId": FINERACT_TENANT,
                "Content-Type": "application/json",
                Accept: "application/json",
            },
            httpsAgent,
        });


        res.status(201).json(response.data);
    } catch (err) {
        // 打印更有用的日志
        if (err.response) {
            console.error("Error in createClient - status:", err.response.status);
            console.error("Error in createClient - data:", err.response.data);
        } else {
            console.error("Error in createClient:", err.message || err);
        }

        // 把 Fineract 的响应透传回去，方便你用 curl 看到具体原因
        const status = err.response?.status || 500;
        const data = err.response?.data || err.message;

        res.status(status).json({
            error: "Fineract request failed",
            details: data,
        });
    }

}

// // 如果你有 GET /clients 的路由，也可以顺便加上
// export async function listClients(req, res) {
//     try {
//         const url = `${FINERACT_URL}/clients`;

//         console.log("Calling Fineract list clients:", url);

//         const response = await axios.get(url, {
//             auth: {
//                 username: FINERACT_USER,
//                 password: FINERACT_PASSWORD,
//             },
//             headers: {
//                 "Fineract-Platform-TenantId": FINERACT_TENANT,
//             },
//             httpsAgent,
//         });

//         res.json(response.data);
//     } catch (err) {
//         console.error("Error in listClients:", err);
//         res.status(500).json({
//             error: err.message,
//             data: err.stack,
//         });
//     }
// }
