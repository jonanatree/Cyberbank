import pkg from "pg";
const { Pool } = pkg;

export const db = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function query(q, params) {
    return db.query(q, params);
}
export async function initCardLinksTable() {
    await query(`
    CREATE TABLE IF NOT EXISTS card_links (
      id SERIAL PRIMARY KEY,
      client_id INT NOT NULL,
      savings_account_id INT NOT NULL,
      card_number VARCHAR(32) UNIQUE NOT NULL,
      card_account_id VARCHAR(64),
      card_id VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
