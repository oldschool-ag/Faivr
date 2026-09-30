import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Signing Polar webhooks for the tests, the way Polar signs them (Standard Webhooks:
 * HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${body}`, base64, header
 * `webhook-signature: v1,<signature>`), with both keys Polar has used:
 *
 * - `standard`: secrets generated on or after 8 September 2026 (the key is the base64 decoding
 *   of the secret after `whsec_`, as the Standard Webhooks specification says)
 * - `hmac`: the earlier Polar HMAC form (the key is the UTF-8 bytes of the whole `whsec_…` string)
 *
 * The SDK's `validateEvent` accepts both; the store passes the dashboard secret as is.
 */
export type PolarSigningForm = "standard" | "hmac";

export const POLAR_TEST_SECRET = "whsec_dGhlIHN0b3JlIHNpZ25zIFBvbGFyIHRlc3Qgd2ViaG9va3M=";

export function polarSigningKey(secret: string, form: PolarSigningForm): Buffer {
  if (form === "hmac") return Buffer.from(secret, "utf8");
  return Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
}

export function signPolarWebhook(body: string, options: { secret?: string; form?: PolarSigningForm; id?: string; timestamp?: number } = {}) {
  const secret = options.secret ?? POLAR_TEST_SECRET;
  const id = options.id ?? `msg_${randomUUID()}`;
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", polarSigningKey(secret, options.form ?? "standard")).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${signature}`, "webhook-api-version": "2026-10", "Content-Type": "application/json" };
}

export function polarFixture(name: string, values: Record<string, string | boolean | null>): string {
  let text = readFileSync(new URL(`../fixtures/polar/${name}.json`, import.meta.url), "utf8");
  for (const [key, value] of Object.entries(values)) {
    // booleans and nulls replace the quoted placeholder, strings replace the placeholder itself
    if (typeof value === "string") text = text.replaceAll(`{{${key}}}`, value);
    else text = text.replaceAll(`"{{${key}}}"`, JSON.stringify(value));
  }
  return text;
}

export function stripeApiFixture(name: string, values: Record<string, string>): string {
  let text = readFileSync(new URL(`../fixtures/stripe/api/${name}.json`, import.meta.url), "utf8");
  for (const [key, value] of Object.entries(values)) text = text.replaceAll(`{{${key}}}`, value);
  return text;
}
