export function fmtAmount(a) {
    if (typeof a === "string")
        return Number(a).toFixed(2);
    return a.toFixed(2);
}
export function canonicalTbs(obj) {
    return {
        txnId: String(obj.txnId),
        amount: fmtAmount(obj.amount),
        currency: String(obj.currency),
        payee: String(obj.payee),
        ...(obj.payer ? { payer: String(obj.payer) } : {}),
    };
}
export function serializeTbs(t) {
    const ordered = { txnId: t.txnId, amount: t.amount, currency: t.currency, payee: t.payee };
    if (t.payer)
        ordered.payer = t.payer;
    return JSON.stringify(ordered);
}
