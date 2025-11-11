import { newJti } from "../crypto/keys.js";

export interface AuthCode {
  code: string;
  client_id: string;
  redirect_uri?: string;
  scope?: string;
  code_challenge?: string;
  code_challenge_method?: "S256" | "plain";
  sub: string;
  username?: string;
  tenant: string;
  acr: string;
  createdAt: number;
  expiresAt: number;
}

export interface RefreshTokenRec {
  token: string;
  sub: string;
  tenant: string;
  acr: string;
  scope?: string;
  expiresAt: number;
}

export interface CibaSession {
  id: string;
  client_id: string;
  user_id: string;
  scope?: string;
  status: "pending" | "approved" | "denied" | "expired";
  level: "L2" | "L3";
  createdAt: number;
  expiresAt: number;
  intervalSec?: number;
  lastPollingAt?: number;
  nextPollAt?: number;
}

const authCodes = new Map<string, AuthCode>(); // code -> rec
const refreshTokens = new Map<string, RefreshTokenRec>(); // token -> rec
const cibaSessions = new Map<string, CibaSession>(); // id -> rec
const usedJtis = new Map<string, number>(); // jti -> expiresAt

export const AuthStore = {
  createCode(init: Omit<AuthCode, "code" | "createdAt">) {
    const code = newJti();
    const rec: AuthCode = { code, createdAt: Date.now(), ...init };
    authCodes.set(code, rec);
    return rec;
  },
  consumeCode(code: string) {
    const rec = authCodes.get(code);
    if (!rec) return undefined;
    authCodes.delete(code);
    if (rec.expiresAt < Date.now()) return undefined;
    return rec;
  },
  saveRefresh(rt: RefreshTokenRec) {
    refreshTokens.set(rt.token, rt);
  },
  getRefresh(token: string) {
    const rec = refreshTokens.get(token);
    if (!rec) return undefined;
    if (rec.expiresAt < Date.now()) {
      refreshTokens.delete(token);
      return undefined;
    }
    return rec;
  },
  createCibaSession(init: Omit<CibaSession, "id" | "createdAt">) {
    const id = newJti();
    const rec: CibaSession = { id, createdAt: Date.now(), ...init };
    cibaSessions.set(id, rec);
    return rec;
  },
  getCiba(id: string) {
    const rec = cibaSessions.get(id);
    if (!rec) return undefined;
    if (rec.expiresAt < Date.now()) {
      rec.status = "expired";
    }
    return rec;
  },
  setCibaStatus(id: string, status: CibaSession["status"]) {
    const rec = cibaSessions.get(id);
    if (rec) rec.status = status;
  },
  touchCibaPoll(id: string) {
    const rec = cibaSessions.get(id);
    if (rec) {
      const now = Date.now();
      rec.lastPollingAt = now;
      const interval = (rec.intervalSec ?? 3) * 1000;
      rec.nextPollAt = now + interval;
    }
  },
  listCiba() { return Array.from(cibaSessions.values()); },
  sweepExpiredCiba(onExpire?: (s: CibaSession)=>void) {
    const now = Date.now();
    for (const [id, s] of cibaSessions) {
      if (s.expiresAt < now || s.status === "expired") {
        s.status = "expired";
        if (onExpire) try { onExpire(s); } catch {}
        cibaSessions.delete(id);
      }
    }
  },
  markJti(jti: string, ttlMs: number) {
    usedJtis.set(jti, Date.now() + ttlMs);
  },
  isJtiUsed(jti: string) {
    const exp = usedJtis.get(jti);
    if (!exp) return false;
    if (Date.now() > exp) {
      usedJtis.delete(jti);
      return false;
    }
    return true;
  },
  sweepJti() {
    const now = Date.now();
    for (const [j, ts] of usedJtis) if (ts < now) usedJtis.delete(j);
  },
};
