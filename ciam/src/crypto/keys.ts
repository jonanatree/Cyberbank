import { createHash, randomUUID } from "crypto";
import { config } from "../config.js";
import { importPKCS8, exportJWK, calculateJwkThumbprint, SignJWT, jwtVerify, JWK, generateKeyPair, KeyLike } from "jose";

let privateKey: KeyLike | null = null;
let publicJwk: JWK | null = null;
let kid: string | null = null;

function toPublicJwk(jwk: JWK): JWK {
  const pub: any = { kty: jwk.kty };
  if (jwk.kty === "RSA") {
    pub.n = (jwk as any).n;
    pub.e = (jwk as any).e;
  } else if (jwk.kty === "EC") {
    pub.crv = (jwk as any).crv;
    pub.x = (jwk as any).x;
    pub.y = (jwk as any).y;
  } else if (jwk.kty === "OKP") {
    pub.crv = (jwk as any).crv;
    pub.x = (jwk as any).x;
  }
  return pub as JWK;
}

export async function ensureKeys() {
  if (privateKey) return;
  if (config.jwtPrivateKeyPEM) {
    privateKey = await importPKCS8(config.jwtPrivateKeyPEM, "PS256");
    const privJwk = await exportJWK(privateKey);
    const pubOnly = toPublicJwk(privJwk);
    kid = await calculateJwkThumbprint({ ...pubOnly });
    publicJwk = { ...pubOnly, alg: "PS256", use: "sig", kid: kid! } as JWK;
  } else {
    // Dev fallback: generate ephemeral RSA-PSS (PS256) key pair
    const { privateKey: pk, publicKey } = await generateKeyPair("PS256");
    privateKey = pk;
    const pubJwk = await exportJWK(publicKey);
    kid = await calculateJwkThumbprint({ ...pubJwk });
    publicJwk = { ...pubJwk, alg: "PS256", use: "sig", kid: kid! } as JWK;
  }
}

export function getJwks() {
  if (!publicJwk) throw new Error("Keys not initialized");
  return { keys: [publicJwk] };
}

export async function signAccessToken(payload: Record<string, any>, ttl: string | number = "30m") {
  await ensureKeys();
  const withJti = { jti: newJti(), ...payload };
  return new SignJWT(withJti)
    .setProtectedHeader({ alg: publicJwk!.alg as string, kid: kid! })
    .setIssuer(config.jwtIssuer)
    .setAudience("api")
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(privateKey!);
}

export async function signRefreshToken(payload: Record<string, any>, ttl: string | number = "14d") {
  await ensureKeys();
  const withJti = { jti: newJti(), ...payload };
  return new SignJWT(withJti)
    .setProtectedHeader({ alg: publicJwk!.alg as string, kid: kid! })
    .setIssuer(config.jwtIssuer)
    .setAudience("api")
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(privateKey!);
}

export async function signIdToken(payload: Record<string, any>, audience: string, ttl: string | number = "5m") {
  await ensureKeys();
  // Minimal OIDC ID Token: iss, aud, iat, exp, sub, acr
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "PS256", kid: kid! })
    .setIssuer(config.jwtIssuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(privateKey!);
}

export async function verifyJwt(token: string) {
  await ensureKeys();
  // For local verification, reuse privateKey's public JWK; in production provide JWKS to consumers
  const { payload } = await jwtVerify(token, privateKey as any, { issuer: config.jwtIssuer, audience: "api", clockTolerance: 60 });
  return payload as Record<string, any>;
}

export function sha256b64url(input: string) {
  return createHash("sha256").update(input).digest("base64url");
}

export function newJti() {
  return randomUUID();
}
