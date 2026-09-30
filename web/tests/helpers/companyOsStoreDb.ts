import { createHash, createPrivateKey, generateKeyPairSync, randomUUID, sign as edSign } from "node:crypto";
import { newDb } from "pg-mem";
import { NextRequest } from "next/server";
import { canonicalJson, signCompanyOsRequest, type RequestIdentity } from "@/lib/companyOs/auth";

/**
 * pg-mem stand-in for web/sql/company-os-marketplace.sql: the same tables and columns the
 * store and lifecycle code touch, without the CHECK regexes pg-mem cannot evaluate.
 */
export function createStoreDb() {
  const db = newDb();
  db.public.none(`
    CREATE TABLE company_os_packages(id text PRIMARY KEY,slug text,name text,summary text,status text DEFAULT 'active',created_at timestamptz DEFAULT now());
    CREATE TABLE company_os_publishers(key_id text PRIMARY KEY,public_key text,status text DEFAULT 'active',publisher_id text,name text,created_at timestamptz DEFAULT now());
    CREATE TABLE company_os_package_versions(id uuid PRIMARY KEY,package_id text,version text,status text,manifest jsonb,publisher_key_id text,publisher_signature text,artifact_url text,artifact_sha256 text,monthly_price_cents integer,stripe_price_id text,min_company_os_version text,published_at timestamptz);
    CREATE TABLE company_os_instance_keys(tenant_id uuid,instance_id uuid,key_id text,public_key text,not_before timestamptz DEFAULT now(),not_after timestamptz,revoked_at timestamptz,label text,enrolled_at timestamptz,last_contact_at timestamptz,PRIMARY KEY(tenant_id,instance_id,key_id));
    CREATE TABLE company_os_request_nonces(tenant_id text,instance_id text,nonce text,expires_at timestamptz,PRIMARY KEY(tenant_id,instance_id,nonce));
    CREATE TABLE company_os_installations(id uuid PRIMARY KEY,tenant_id uuid,instance_id uuid,package_id text,desired_version_id uuid,installed_version_id uuid,subscription_id uuid,bundle_subscription_id uuid,checkout_session_id uuid,local_agent_definition_id text,installation_state text,subscription_state text,stripe_checkout_session_id text,stripe_subscription_id text,entitled_at timestamptz,installed_at timestamptz,uninstall_request_id uuid,uninstall_requested_at timestamptz,receipt_accepted_at timestamptz,billing_cancel_effective_at timestamptz,billing_stopped_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE company_os_idempotency(tenant_id text,idempotency_key text,operation text,request_hash text,status text,response_body jsonb,created_at timestamptz DEFAULT now(),completed_at timestamptz,expires_at timestamptz,PRIMARY KEY(tenant_id,idempotency_key,operation));
    CREATE TABLE company_os_archive_receipts(receipt_id uuid PRIMARY KEY,tenant_id uuid,instance_id uuid,installation_id uuid,payload jsonb,signature text,accepted_at timestamptz DEFAULT now());
    CREATE TABLE company_os_uninstall_receipts(receipt_id uuid PRIMARY KEY,tenant_id uuid,instance_id uuid,installation_id uuid,uninstall_request_id uuid,subscription_id uuid,nonce text,payload jsonb,signature text,accepted_at timestamptz DEFAULT now(),UNIQUE(tenant_id,instance_id,nonce));
    CREATE TABLE company_os_billing_acknowledgements(event_id uuid PRIMARY KEY,receipt_id uuid,subscription_id uuid,receipt_state text,subscription_state text,effective_at timestamptz,rejection_reason text,payload jsonb,signature text,UNIQUE(receipt_id,subscription_state));
    CREATE TABLE company_os_webhook_events(provider text,event_id text,payload jsonb,processed_at timestamptz DEFAULT now(),PRIMARY KEY(provider,event_id));
    CREATE TABLE company_os_function_bundles(id text PRIMARY KEY,name text,description text,stripe_price_id text,polar_product_id text,monthly_price_cents integer,currency text DEFAULT 'chf',status text DEFAULT 'active',created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE company_os_bundle_packages(bundle_id text,package_id text,added_at timestamptz DEFAULT now(),PRIMARY KEY(bundle_id,package_id));
    CREATE TABLE company_os_package_artifacts(version_id uuid PRIMARY KEY,artifact bytea,artifact_bytes integer,artifact_sha256 text,uploaded_at timestamptz DEFAULT now());
    CREATE TABLE company_os_bundle_subscriptions(id uuid PRIMARY KEY,tenant_id uuid,instance_id uuid,bundle_id text,checkout_session_id uuid,stripe_checkout_session_id text,stripe_subscription_id text,billing_provider text,provider_checkout_id text,provider_subscription_id text,provider_customer_id text,subscription_state text,entitled_at timestamptz,cancel_effective_at timestamptz,stopped_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE company_os_enrolment_codes(code_hash text PRIMARY KEY,tenant_id uuid,label text,created_by text,created_at timestamptz DEFAULT now(),expires_at timestamptz,used_at timestamptz,instance_id uuid,key_id text,owner_email text);
  `);
  const adapter = db.adapters.createPg();
  return { db, pool: new adapter.Pool() as unknown as import("pg").Pool };
}

export type ApplianceKeys = { privatePem: string; publicPem: string };

export function ed25519Pair(): ApplianceKeys {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

export type Appliance = { tenantId: string; instanceId: string; keyId: string; keys: ApplianceKeys };

/** A signed appliance request, exactly as services/faivr-marketplace/app/company_os_faivr.py builds it. */
export function signedRequest(appliance: Appliance, method: string, pathAndQuery: string, body?: unknown, options: { idempotencyKey?: string; origin?: string; now?: number } = {}) {
  const origin = options.origin ?? "https://store.faivr.test";
  const text = body === undefined ? "" : canonicalJson(body);
  const identity: RequestIdentity = {
    tenantId: appliance.tenantId,
    instanceId: appliance.instanceId,
    keyId: appliance.keyId,
    timestamp: String(Math.floor((options.now ?? Date.now()) / 1000)),
    nonce: randomUUID(),
    idempotencyKey: options.idempotencyKey ?? (method === "GET" ? "" : `idem-${randomUUID()}`),
  };
  const headers: Record<string, string> = {
    "X-FAIVR-Tenant-Id": identity.tenantId,
    "X-FAIVR-Instance-Id": identity.instanceId,
    "X-FAIVR-Key-Id": identity.keyId,
    "X-FAIVR-Timestamp": identity.timestamp,
    "X-FAIVR-Nonce": identity.nonce,
    "X-FAIVR-Signature": signCompanyOsRequest(appliance.keys.privatePem, identity, method, pathAndQuery, text),
    Accept: "application/json",
  };
  if (identity.idempotencyKey) headers["Idempotency-Key"] = identity.idempotencyKey;
  if (text) headers["Content-Type"] = "application/json";
  return new NextRequest(origin + pathAndQuery, { method, headers, body: text || undefined });
}

export function envelope(appliance: Appliance, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: "faivr-marketplace-lifecycle.v1",
    requestId: randomUUID(),
    idempotencyKey: `idem-${randomUUID()}`,
    tenantId: appliance.tenantId,
    instanceId: appliance.instanceId,
    occurredAt: new Date().toISOString(),
    ...extra,
  };
}

/** A signed portable manifest for one payload, the way the Truchsess exporter signs it (RFC 8785 minus `signature`). */
export function signedManifest(input: { modelId: string; version: string; payload: Buffer; publisherKeyId: string; publisherPrivatePem: string; permissions: string[]; summary?: string }) {
  const sha256 = (value: Buffer) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const manifest: Record<string, unknown> = {
    schemaVersion: "faivr-portable-agent-bundle.v1",
    modelId: input.modelId,
    version: input.version,
    displayName: "Example reviewer",
    summary: input.summary ?? "Reviews supplied artifacts and returns findings.",
    publisher: { publisherId: "old-school", name: "Old School AG" },
    packageDigest: sha256(input.payload),
    artifactBytes: input.payload.length,
    entrypoint: "agent-definition.json",
    companyOsCompatibility: { minVersion: "1.0.0", maxVersion: "1.999.999" },
    permissions: input.permissions,
    dependencies: [],
    managedPaths: [`agents/${input.modelId}/${input.version}`],
    tenantDataIncluded: false,
    monthlyPrice: { billingPeriod: "month", amountCents: 1, stripePriceId: null, activationState: "price_required" },
    contents: [{ path: "agent-definition.json", sha256: "0".repeat(64), bytes: 2 }],
  };
  const value = edSign(null, Buffer.from(canonicalJson(manifest)), createPrivateKey(input.publisherPrivatePem)).toString("base64url");
  return { ...manifest, signature: { keyId: input.publisherKeyId, algorithm: "Ed25519", value } };
}
