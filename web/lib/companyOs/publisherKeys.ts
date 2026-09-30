import { createHash, createPublicKey, type KeyObject } from "node:crypto";

/**
 * Ed25519 key identity shared with the Truchsess appliance.
 *
 * The appliance derives every key id as `ed25519-` plus the first 16 hex characters of
 * SHA-256 over the raw 32-byte public key (packages/agent-bundles/scripts/publisher_key.py).
 * FAIVR re-derives it here, so a publisher or appliance key is never registered under a
 * typed id that does not belong to its key.
 */
export const KEY_ID_PATTERN = /^ed25519-[0-9a-f]{16}$/;

export class PublicKeyError extends Error {}

export function loadEd25519PublicKey(pem: string): KeyObject {
  if (typeof pem !== "string" || !pem.includes("-----BEGIN PUBLIC KEY-----")) throw new PublicKeyError("public key must be a PEM SubjectPublicKeyInfo block");
  if (pem.includes("PRIVATE KEY")) throw new PublicKeyError("a private key was supplied where a public key is expected");
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    throw new PublicKeyError("public key PEM cannot be parsed");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new PublicKeyError(`public key must be Ed25519, got ${key.asymmetricKeyType}`);
  return key;
}

export function keyIdFor(key: KeyObject): string {
  // SPKI DER of an Ed25519 key is a fixed 12-byte prefix followed by the 32 raw bytes.
  const der = key.export({ type: "spki", format: "der" });
  const raw = der.subarray(der.length - 32);
  return `ed25519-${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}

export function normalizePublicKeyPem(pem: string): { pem: string; keyId: string } {
  const key = loadEd25519PublicKey(pem);
  return { pem: key.export({ type: "spki", format: "pem" }).toString(), keyId: keyIdFor(key) };
}
