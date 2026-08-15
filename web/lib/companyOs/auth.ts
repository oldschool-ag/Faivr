import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";

export const CONTRACT_VERSION = "faivr-marketplace-lifecycle.v1";
export const MAX_CLOCK_SKEW_SECONDS = 300;

export type RequestIdentity = {
  tenantId: string;
  instanceId: string;
  keyId: string;
  timestamp: string;
  nonce: string;
  idempotencyKey: string;
};

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalRequest(identity: RequestIdentity, method: string, exactPathAndQuery: string, body: string): string {
  return [
    method.toUpperCase(),
    exactPathAndQuery,
    sha256(body),
    identity.timestamp,
    identity.nonce,
    identity.tenantId,
    identity.instanceId,
    identity.idempotencyKey || "",
  ].join("\n");
}

export function signCompanyOsRequest(privateKey: string, identity: RequestIdentity, method: string, exactPathAndQuery: string, body: string): string {
  return sign(null, Buffer.from(canonicalRequest(identity, method, exactPathAndQuery, body)), createPrivateKey(privateKey)).toString("base64url");
}

export function verifyCompanyOsRequest(input: {
  publicKey: string;
  identity: RequestIdentity;
  signature: string | null;
  method: string;
  exactPathAndQuery: string;
  body: string;
  now?: number;
}): boolean {
  const epoch = Number(input.identity.timestamp);
  if (!input.signature || !Number.isFinite(epoch) || Math.abs((input.now ?? Date.now()) / 1000 - epoch) > MAX_CLOCK_SKEW_SECONDS) return false;
  try {
    return verify(null, Buffer.from(canonicalRequest(input.identity, input.method, input.exactPathAndQuery, input.body)), createPublicKey(input.publicKey), Buffer.from(input.signature, "base64url"));
  } catch { return false; }
}

export function canonicalSignedMessage<T extends { signature?: unknown }>(message: T): string {
  const { signature: _signature, ...unsigned } = message;
  return canonicalJson(unsigned);
}

/** RFC 8785 JSON Canonicalization Scheme for JSON-compatible values. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("RFC8785 forbids non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("RFC8785 only accepts JSON values");
}

export function verifyMessageSignature(message: Record<string, unknown> & { signature: { value: string } }, publicKey: string): boolean {
  try { return verify(null, Buffer.from(canonicalSignedMessage(message)), createPublicKey(publicKey), Buffer.from(message.signature.value, "base64url")); }
  catch { return false; }
}

export function signBillingAcknowledgement<T extends object>(message: T, privateKey: string, keyId: string) {
  const unsigned = { ...message, signature: { keyId, algorithm: "Ed25519", value: "" } };
  const value = sign(null, Buffer.from(canonicalSignedMessage(unsigned)), createPrivateKey(privateKey)).toString("base64url");
  return { ...message, signature: { keyId, algorithm: "Ed25519" as const, value } };
}
