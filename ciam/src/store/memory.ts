import { randomUUID } from "crypto";
import { ChallengeRecord, UserRecord } from "../types.js";

const users = new Map<string, UserRecord>(); // key: userId
const usersByUsername = new Map<string, string>(); // username -> userId

const challengesByUser = new Map<string, ChallengeRecord>();
const challengesById = new Map<string, ChallengeRecord>();
const challengesByValue = new Map<string, ChallengeRecord>();

function isExpired(rec: ChallengeRecord) {
  if (Date.now() > rec.expiresAt) {
    removeChallenge(rec);
    return true;
  }
  return false;
}

function removeChallenge(rec: ChallengeRecord) {
  challengesByUser.delete(rec.userId);
  if (rec.chalId) challengesById.delete(rec.chalId);
  challengesByValue.delete(rec.challenge);
}

export const MemoryStore = {
  upsertUser(u: UserRecord) {
    users.set(u.id, u);
    usersByUsername.set(u.username, u.id);
  },
  getUser(userId: string): UserRecord | undefined {
    return users.get(userId);
  },
  getUserByUsername(username: string): UserRecord | undefined {
    const id = usersByUsername.get(username);
    return id ? users.get(id) : undefined;
  },
  listUsers(): UserRecord[] {
    return Array.from(users.values());
  },
  setChallenge(rec: ChallengeRecord) {
    const chalId = rec.chalId ?? randomUUID();
    const finalRec: ChallengeRecord = { ...rec, chalId };
    const existing = challengesByUser.get(rec.userId);
    if (existing) removeChallenge(existing);
    challengesByUser.set(rec.userId, finalRec);
    challengesById.set(chalId, finalRec);
    challengesByValue.set(finalRec.challenge, finalRec);
    return finalRec;
  },
  getChallenge(userId: string): ChallengeRecord | undefined {
    const c = challengesByUser.get(userId);
    if (!c) return undefined;
    if (isExpired(c)) return undefined;
    return c;
  },
  clearChallenge(userId: string) {
    const current = challengesByUser.get(userId);
    if (current) removeChallenge(current);
  },
  getChallengeById(chalId: string): ChallengeRecord | undefined {
    const rec = challengesById.get(chalId);
    if (!rec) return undefined;
    if (isExpired(rec)) return undefined;
    return rec;
  },
  findChallengeByValue(challenge: string): ChallengeRecord | undefined {
    const rec = challengesByValue.get(challenge);
    if (!rec) return undefined;
    if (isExpired(rec)) return undefined;
    return rec;
  },
  clearChallengeById(chalId: string) {
    const rec = challengesById.get(chalId);
    if (rec) removeChallenge(rec);
  },
};
