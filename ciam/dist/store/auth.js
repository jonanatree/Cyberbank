import { newJti } from "../crypto/keys.js";
const authCodes = new Map(); // code -> rec
const refreshTokens = new Map(); // token -> rec
const cibaSessions = new Map(); // id -> rec
const usedJtis = new Map(); // jti -> expiresAt
export const AuthStore = {
    createCode(init) {
        const code = newJti();
        const rec = { code, createdAt: Date.now(), ...init };
        authCodes.set(code, rec);
        return rec;
    },
    consumeCode(code) {
        const rec = authCodes.get(code);
        if (!rec)
            return undefined;
        authCodes.delete(code);
        if (rec.expiresAt < Date.now())
            return undefined;
        return rec;
    },
    saveRefresh(rt) {
        refreshTokens.set(rt.token, rt);
    },
    getRefresh(token) {
        const rec = refreshTokens.get(token);
        if (!rec)
            return undefined;
        if (rec.expiresAt < Date.now()) {
            refreshTokens.delete(token);
            return undefined;
        }
        return rec;
    },
    createCibaSession(init) {
        const id = newJti();
        const rec = { id, createdAt: Date.now(), ...init };
        cibaSessions.set(id, rec);
        return rec;
    },
    getCiba(id) {
        const rec = cibaSessions.get(id);
        if (!rec)
            return undefined;
        if (rec.expiresAt < Date.now()) {
            rec.status = "expired";
        }
        return rec;
    },
    setCibaStatus(id, status) {
        const rec = cibaSessions.get(id);
        if (rec)
            rec.status = status;
    },
    touchCibaPoll(id) {
        const rec = cibaSessions.get(id);
        if (rec) {
            const now = Date.now();
            rec.lastPollingAt = now;
            const interval = (rec.intervalSec ?? 3) * 1000;
            rec.nextPollAt = now + interval;
        }
    },
    listCiba() { return Array.from(cibaSessions.values()); },
    sweepExpiredCiba(onExpire) {
        const now = Date.now();
        for (const [id, s] of cibaSessions) {
            if (s.expiresAt < now || s.status === "expired") {
                s.status = "expired";
                if (onExpire)
                    try {
                        onExpire(s);
                    }
                    catch { }
                cibaSessions.delete(id);
            }
        }
    },
    markJti(jti, ttlMs) {
        usedJtis.set(jti, Date.now() + ttlMs);
    },
    isJtiUsed(jti) {
        const exp = usedJtis.get(jti);
        if (!exp)
            return false;
        if (Date.now() > exp) {
            usedJtis.delete(jti);
            return false;
        }
        return true;
    },
    sweepJti() {
        const now = Date.now();
        for (const [j, ts] of usedJtis)
            if (ts < now)
                usedJtis.delete(j);
    },
};
