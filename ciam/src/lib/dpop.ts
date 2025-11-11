import { decodeProtectedHeader, importJWK, jwtVerify, calculateJwkThumbprint, JWK } from "jose";
import { AuthStore } from "../store/auth.js";

export interface DPoPResult {
  jkt: string;
  jwk: JWK;
  payload: any;
}

export async function verifyDPoP(proof: string, expectedHtm: string, expectedHtu: string, iatSkewSec = 300): Promise<DPoPResult> {
  const header = decodeProtectedHeader(proof);
  const jwk = (header as any).jwk as JWK;
  if (!jwk) throw new Error("missing_jwk");
  const key = await importJWK(jwk, header.alg as string);
  const { payload } = await jwtVerify(proof, key as any, { clockTolerance: 5 });
  const htm = (payload as any).htm;
  const htu = (payload as any).htu;
  const iat = (payload as any).iat as number | undefined;
  const jti = (payload as any).jti as string | undefined;
  if (!htm || !htu || !iat || !jti) throw new Error("missing_claims");
  if (typeof htm !== "string" || typeof htu !== "string") throw new Error("invalid_claims");
  if (htm.toUpperCase() !== expectedHtm.toUpperCase()) throw new Error("htm_mismatch");
  if (htu !== expectedHtu) throw new Error("htu_mismatch");
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - iat) > iatSkewSec) throw new Error("iat_out_of_window");
  if (AuthStore.isJtiUsed(jti)) throw new Error("replay");
  AuthStore.markJti(jti, iatSkewSec * 1000);
  const jkt = await calculateJwkThumbprint(jwk);
  return { jkt, jwk, payload };
}

