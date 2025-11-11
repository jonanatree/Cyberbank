export type Tbs = { txnId: string; amount: string; currency: string; payee: string; payer?: string };

export function fmtAmount(a: number | string): string {
  if (typeof a === "string") return Number(a).toFixed(2);
  return (a as number).toFixed(2);
}

export function canonicalTbs(obj: { txnId: string; amount: number | string; currency: string; payee: string; payer?: string }): Tbs {
  return {
    txnId: String(obj.txnId),
    amount: fmtAmount(obj.amount),
    currency: String(obj.currency),
    payee: String(obj.payee),
    ...(obj.payer ? { payer: String(obj.payer) } : {}),
  };
}

export function serializeTbs(t: Tbs): string {
  const ordered: any = { txnId: t.txnId, amount: t.amount, currency: t.currency, payee: t.payee };
  if (t.payer) ordered.payer = t.payer;
  return JSON.stringify(ordered);
}

