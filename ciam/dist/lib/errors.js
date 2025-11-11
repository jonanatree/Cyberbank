export class AppError extends Error {
    constructor(code, status, message, details) {
        super(message || code);
        this.code = code;
        this.status = status;
        this.details = details;
    }
}
export function createError(code, status, message, details) {
    return new AppError(code, status, message, details);
}
export const MSG = {
    UNAUTHENTICATED: "unauthenticated",
    TENANT_MISMATCH: "tenant mismatch",
    STEP_UP_REQUIRED: "additional verification required",
    TXSIGN_INVALID: "transaction signature invalid",
    REPLAY_DETECTED: "replay detected",
    INVALID_DPOP: "invalid dpop",
    authorization_pending: "approval is pending",
    access_denied: "access denied",
    expired_token: "expired",
    slow_down: "polling too fast",
    invalid_txn: "invalid transaction",
    challenge_expired: "challenge expired",
    webauthn_verify_fail: "webauthn verify failed",
    already_signed: "already signed",
    txn_signature_required: "transaction signature required",
    txn_invalid: "transaction signature invalid",
    txn_mismatch: "transaction data mismatch",
    txn_replay: "transaction signature replayed",
    txn_expired: "transaction signature expired",
    INVALID_GRANT: "invalid grant",
    INVALID_REQUEST: "invalid request",
    RATE_LIMITED: "rate limited",
    INTERNAL: "internal error",
};
