import type { AuthenticatorTransportFuture } from "@simplewebauthn/types";

export type Base64URLString = string;

export interface StoredCredential {
  credentialID: Base64URLString;
  credentialPublicKey: Base64URLString;
  counter: number;
  transports?: AuthenticatorTransportFuture[]; // authenticator transports
  aaguid?: string;
  deviceType?: string;
  backedUp?: boolean;
}

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  credentials: StoredCredential[];
}

export interface ChallengeRecord {
  challenge: string;
  userId: string;
  kind: "registration" | "authentication";
  expiresAt: number; // epoch ms
  chalId?: string;
}
