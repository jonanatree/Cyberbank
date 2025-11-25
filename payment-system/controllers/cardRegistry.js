// // controllers/cardRegistry.js

// // 简单内存表：服务重启会清空，但 demo 够用
// const links = [];

// /**
//  * 在发卡时登记一条映射关系
//  * { clientId, savingsAccountId, cardNumber, cardAccountId, cardId }
//  */
// export function addCardLink(link) {
//     links.push(link);
//     console.log("Card link registered:", link);
// }

// /**
//  * 通过卡号查找映射
//  */
// export function findByCardNumber(cardNumber) {
//     return links.find((l) => l.cardNumber === cardNumber);
// }

// /**
//  * （可选）调试用：列出所有已登记卡
//  */
// export function listAllCards() {
//     return links;
// }

// export function getAllCards() {
//     return links;
// }


/////////////

import { query } from "../db.js";


export async function addCardLink(link) {
    const {
        clientId,
        savingsAccountId,
        cardNumber,
        cardAccountId,
        cardId,
    } = link;

    await query(
        `INSERT INTO card_links
       (client_id, savings_account_id, card_number, card_account_id, card_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (card_number) DO UPDATE
       SET client_id = EXCLUDED.client_id,
           savings_account_id = EXCLUDED.savings_account_id,
           card_account_id = EXCLUDED.card_account_id,
           card_id = EXCLUDED.card_id`,
        [clientId, savingsAccountId, cardNumber, cardAccountId, cardId]
    );

    console.log("Card link saved to database:", link);
}

// 通过卡号查找映射
export async function findByCardNumber(cardNumber) {
    const { rows } = await query(
        `SELECT * FROM card_links WHERE card_number = $1`,
        [cardNumber]
    );
    const row = rows[0];
    if (!row) return null;

    // 这里直接转成 camelCase，方便 controller 用
    return {
        clientId: row.client_id,
        savingsAccountId: row.savings_account_id,
        cardNumber: row.card_number,
        cardAccountId: row.card_account_id,
        cardId: row.card_id,
    };
}

// （可选）列出所有卡
export async function getAllCards() {
    const { rows } = await query(
        `SELECT * FROM card_links ORDER BY created_at DESC`
    );
    return rows.map((row) => ({
        clientId: row.client_id,
        savingsAccountId: row.savings_account_id,
        cardNumber: row.card_number,
        cardAccountId: row.card_account_id,
        cardId: row.card_id,
    }));
}
