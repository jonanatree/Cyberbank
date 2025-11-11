import { createHash, randomUUID } from "crypto";
import { config } from "../config.js";
import { importPKCS8, exportJWK, calculateJwkThumbprint, SignJWT, jwtVerify, generateKeyPair } from "jose";
let privateKey = null;
let publicJwk = null;
let kid = null;
function toPublicJwk(jwk) {
    const pub = { kty: jwk.kty };
    if (jwk.kty === "RSA") {
        pub.n = jwk.n;
        pub.e = jwk.e;
    }
    else if (jwk.kty === "EC") {
        pub.crv = jwk.crv;
        pub.x = jwk.x;
        pub.y = jwk.y;
    }
    else if (jwk.kty === "OKP") {
        pub.crv = jwk.crv;
        pub.x = jwk.x;
    }
    return pub;
}
export async function ensureKeys() {
    if (privateKey)
        return;
    if (config.jwtPrivateKeyPEM) {
        privateKey = await importPKCS8(config.jwtPrivateKeyPEM, "PS256");
        const privJwk = await exportJWK(privateKey);
        const pubOnly = toPublicJwk(privJwk);
        kid = await calculateJwkThumbprint({ ...pubOnly });
        publicJwk = { ...pubOnly, alg: "PS256", use: "sig", kid: kid };
    }
    else {
        // Dev fallback: generate ephemeral RSA-PSS (PS256) key pair
        const { privateKey: pk, publicKey } = await generateKeyPair("PS256");
        privateKey = pk;
        const pubJwk = await exportJWK(publicKey);
        kid = await calculateJwkThumbprint({ ...pubJwk });
        publicJwk = { ...pubJwk, alg: "PS256", use: "sig", kid: kid };
    }
}
export function getJwks() {
    if (!publicJwk)
        throw new Error("Keys not initialized");
    return { keys: [publicJwk] };
}
export async function signAccessToken(payload, ttl = "30m") {
    await ensureKeys();
    const withJti = { jti: newJti(), ...payload };
    return new SignJWT(withJti)
        .setProtectedHeader({ alg: publicJwk.alg, kid: kid })
        .setIssuer(config.jwtIssuer)
        .setAudience("api")
        .setIssuedAt()
        .setExpirationTime(ttl)
        .sign(privateKey);
}
export async function signRefreshToken(payload, ttl = "14d") {
    await ensureKeys();
    const withJti = { jti: newJti(), ...payload };
    return new SignJWT(withJti)
        .setProtectedHeader({ alg: publicJwk.alg, kid: kid })
        .setIssuer(config.jwtIssuer)
        .setAudience("api")
        .setIssuedAt()
        .setExpirationTime(ttl)
        .sign(privateKey);
}
export async function signIdToken(payload, audience, ttl = "5m") {
    await ensureKeys();
    // Minimal OIDC ID Token: iss, aud, iat, exp, sub, acr
    return new SignJWT(payload)
        .setProtectedHeader({ alg: "PS256", kid: kid })
        .setIssuer(config.jwtIssuer)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime(ttl)
        .sign(privateKey);
}
export async function verifyJwt(token) {
    await ensureKeys();
    // For local verification, reuse privateKey's public JWK; in production provide JWKS to consumers
    const { payload } = await jwtVerify(token, privateKey, { issuer: config.jwtIssuer, audience: "api", clockTolerance: 60 });
    return payload;
}
export function sha256b64url(input) {
    return createHash("sha256").update(input).digest("base64url");
}
export function newJti() {
    return randomUUID();
}
