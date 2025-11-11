import { decodeProtectedHeader, importJWK, jwtVerify, calculateJwkThumbprint } from "jose";
import { AuthStore } from "../store/auth.js";
export async function verifyDPoP(proof, expectedHtm, expectedHtu, iatSkewSec = 300) {
    const header = decodeProtectedHeader(proof);
    const jwk = header.jwk;
    if (!jwk)
        throw new Error("missing_jwk");
    const key = await importJWK(jwk, header.alg);
    const { payload } = await jwtVerify(proof, key, { clockTolerance: 5 });
    const htm = payload.htm;
    const htu = payload.htu;
    const iat = payload.iat;
    const jti = payload.jti;
    if (!htm || !htu || !iat || !jti)
        throw new Error("missing_claims");
    if (typeof htm !== "string" || typeof htu !== "string")
        throw new Error("invalid_claims");
    if (htm.toUpperCase() !== expectedHtm.toUpperCase())
        throw new Error("htm_mismatch");
    if (htu !== expectedHtu)
        throw new Error("htu_mismatch");
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - iat) > iatSkewSec)
        throw new Error("iat_out_of_window");
    if (AuthStore.isJtiUsed(jti))
        throw new Error("replay");
    AuthStore.markJti(jti, iatSkewSec * 1000);
    const jkt = await calculateJwkThumbprint(jwk);
    return { jkt, jwk, payload };
}
