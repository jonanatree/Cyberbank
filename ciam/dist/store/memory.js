import { randomUUID } from "crypto";
const users = new Map(); // key: userId
const usersByUsername = new Map(); // username -> userId
const challengesByUser = new Map();
const challengesById = new Map();
const challengesByValue = new Map();
function isExpired(rec) {
    if (Date.now() > rec.expiresAt) {
        removeChallenge(rec);
        return true;
    }
    return false;
}
function removeChallenge(rec) {
    challengesByUser.delete(rec.userId);
    if (rec.chalId)
        challengesById.delete(rec.chalId);
    challengesByValue.delete(rec.challenge);
}
export const MemoryStore = {
    upsertUser(u) {
        users.set(u.id, u);
        usersByUsername.set(u.username, u.id);
    },
    getUser(userId) {
        return users.get(userId);
    },
    getUserByUsername(username) {
        const id = usersByUsername.get(username);
        return id ? users.get(id) : undefined;
    },
    listUsers() {
        return Array.from(users.values());
    },
    setChallenge(rec) {
        const chalId = rec.chalId ?? randomUUID();
        const finalRec = { ...rec, chalId };
        const existing = challengesByUser.get(rec.userId);
        if (existing)
            removeChallenge(existing);
        challengesByUser.set(rec.userId, finalRec);
        challengesById.set(chalId, finalRec);
        challengesByValue.set(finalRec.challenge, finalRec);
        return finalRec;
    },
    getChallenge(userId) {
        const c = challengesByUser.get(userId);
        if (!c)
            return undefined;
        if (isExpired(c))
            return undefined;
        return c;
    },
    clearChallenge(userId) {
        const current = challengesByUser.get(userId);
        if (current)
            removeChallenge(current);
    },
    getChallengeById(chalId) {
        const rec = challengesById.get(chalId);
        if (!rec)
            return undefined;
        if (isExpired(rec))
            return undefined;
        return rec;
    },
    findChallengeByValue(challenge) {
        const rec = challengesByValue.get(challenge);
        if (!rec)
            return undefined;
        if (isExpired(rec))
            return undefined;
        return rec;
    },
    clearChallengeById(chalId) {
        const rec = challengesById.get(chalId);
        if (rec)
            removeChallenge(rec);
    },
};
