// controllers/cardClient.js
import axios from "axios";

const CARD_ISSUER_URL =
    process.env.CARD_ISSUER_URL || "http://host.docker.internal:9090";

// 创建发卡系统里的“账户”（和 core bank 储蓄账户是不同世界）
export async function createCardAccount({ balance, currency }) {
    const payload = { balance, currency };
    const res = await axios.post(`${CARD_ISSUER_URL}/accounts`, payload);
    return res.data;
}

// 在这个 card-account 下发一张卡
export async function issueCard(accountId) {
    const res = await axios.post(
        `${CARD_ISSUER_URL}/accounts/${accountId}/cards`
    );
    return res.data;
}

// 设置持卡人姓名
export async function setCardHolder(accountId, cardId, holderName) {
    const payload = { cardholder_name: holderName };
    const res = await axios.post(
        `${CARD_ISSUER_URL}/accounts/${accountId}/cards/${cardId}/holder`,
        payload
    );
    return res.data;
}


export async function fullCardIssuance({
    holderName,
    initialBalance = 0,
    currency = "AUD",
}) {
    // 1. 创建 issuer account
    const account = await createCardAccount({ balance: initialBalance, currency });
    const cardAccountId = account.ID || account.id;

    // 2. 发卡
    const card = await issueCard(cardAccountId);
    const cardId = card.ID || card.id;

    // 3. 尝试设置持卡人 —— 但如果当前 issuer 模式不支持，就忽略错误
    try {
        await setCardHolder(cardAccountId, cardId, holderName);
    } catch (e) {
        console.warn(
            "setCardHolder failed (issuer in DB mode probably does not support holder update):",
            e.response?.data || e.message
        );
        // 不往外抛，让流程继续
    }

    // 4. 整理返回字段
    return {
        cardAccountId,
        cardId,
        number: card.Number || card.number,
        expiry: card.ExpirationDate || card.expirationDate,
        cvv: card.CardVerificationValue || card.cardVerificationValue,
        cardFace: card.card_face || null,
    };
}
