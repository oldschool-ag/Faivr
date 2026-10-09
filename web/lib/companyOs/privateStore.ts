import "server-only";
import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { getPgPool } from "@/lib/postgres";
import { normalizePublicKeyPem } from "./publisherKeys";

/**
 * The private store (T6b): Old School's catalog of governed AI workers, installable on
 * enrolled Truchsess appliances only.
 *
 * Nothing here reaches the chain, the fee module, the router or an escrow contract: the
 * store is fiat through the configured billing provider (Polar by default, Stripe as the
 * second implementation; T6b.1), monthly, per function bundle. The state machine below is
 * provider-neutral; provider objects are opaque ids next to it. tests/company-os-frozen-boundaries
 * pins the first point.
 */

export type Queryable = Pick<PoolClient, "query">;
const db = (client?: Queryable): Queryable => client ?? getPgPool();

export class StoreError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export function hashEnrolmentCode(code: string): string {
  return createHash("sha256").update(code.trim()).digest("hex");
}

export function generateEnrolmentCode(): string {
  // Upper-case letters and digits without 0, O, 1, I: readable, typed once by the CEO.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const groups: string[] = [];
  for (let g = 0; g < 4; g += 1) {
    let group = "";
    for (let i = 0; i < 5; i += 1) group += alphabet[randomInt(alphabet.length)];
    groups.push(group);
  }
  return `TRS-${groups.join("-")}`;
}

// --- publishers --------------------------------------------------------------------------

export async function enrolPublisher(input: { publicKeyPem: string; publisherId: string; name: string }, client?: Queryable) {
  const { pem, keyId } = normalizePublicKeyPem(input.publicKeyPem);
  await db(client).query(
    "INSERT INTO company_os_publishers(key_id,public_key,status,publisher_id,name) VALUES($1,$2,'active',$3,$4) ON CONFLICT(key_id) DO UPDATE SET public_key=EXCLUDED.public_key,status='active',publisher_id=EXCLUDED.publisher_id,name=EXCLUDED.name",
    [keyId, pem, input.publisherId, input.name],
  );
  return { keyId, publisherId: input.publisherId, name: input.name };
}

export async function activePublishers(client?: Queryable) {
  const r = await db(client).query("SELECT key_id,public_key,publisher_id,name FROM company_os_publishers WHERE status='active' ORDER BY key_id");
  return r.rows.map((row) => ({ keyId: row.key_id as string, publicKeyPem: row.public_key as string, publisherId: (row.publisher_id as string | null) ?? "unknown", name: (row.name as string | null) ?? "unknown" }));
}

// --- enrolment -----------------------------------------------------------------------------

export async function issueEnrolmentCode(input: { tenantId?: string; label: string; createdBy: string; expiresInDays?: number; ownerEmail?: string | null }, client?: Queryable) {
  const code = generateEnrolmentCode();
  const tenantId = input.tenantId ?? randomUUID();
  const days = input.expiresInDays ?? 14;
  const email = input.ownerEmail?.trim() || null;
  if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new StoreError("owner_email_invalid", 400);
  await db(client).query(
    "INSERT INTO company_os_enrolment_codes(code_hash,tenant_id,label,created_by,expires_at,owner_email) VALUES($1,$2,$3,$4,now()+($5::text||' days')::interval,$6)",
    [hashEnrolmentCode(code), tenantId, input.label, input.createdBy, String(days), email],
  );
  return { code, tenantId, label: input.label, expiresInDays: days, ownerEmail: email };
}

export type EnrolmentResult = {
  tenantId: string;
  instanceId: string;
  keyId: string;
  label: string;
  enrolledAt: string;
};

/**
 * Redeem a one-time enrolment code with the appliance's public key.
 *
 * The code is compared by hash in constant time; a wrong, used or expired code yields the
 * same refusal. The key id is derived from the key, never taken from the appliance.
 */
export async function redeemEnrolmentCode(input: { code: string; appliancePublicKeyPem: string; label?: string }, client?: Queryable): Promise<EnrolmentResult> {
  const { pem, keyId } = normalizePublicKeyPem(input.appliancePublicKeyPem);
  const hash = hashEnrolmentCode(input.code);
  const r = await db(client).query("SELECT code_hash,tenant_id,label,expires_at,used_at FROM company_os_enrolment_codes WHERE code_hash=$1", [hash]);
  const row = r.rows[0];
  const supplied = Buffer.from(hash, "hex");
  const stored = Buffer.from((row?.code_hash as string | undefined) ?? "0".repeat(64), "hex");
  const matches = stored.length === supplied.length && timingSafeEqual(stored, supplied);
  if (!row || !matches || row.used_at || new Date(row.expires_at as string).getTime() < Date.now()) throw new StoreError("enrolment_code_refused", 403);
  const instanceId = randomUUID();
  const label = (input.label?.trim() || (row.label as string)).slice(0, 120);
  const now = new Date().toISOString();
  const claimed = await db(client).query(
    "UPDATE company_os_enrolment_codes SET used_at=now(),instance_id=$2,key_id=$3 WHERE code_hash=$1 AND used_at IS NULL RETURNING tenant_id",
    [hash, instanceId, keyId],
  );
  if (!claimed.rowCount) throw new StoreError("enrolment_code_refused", 403);
  await db(client).query(
    "INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key,label,enrolled_at) VALUES($1,$2,$3,$4,$5,now())",
    [row.tenant_id, instanceId, keyId, pem, label],
  );
  return { tenantId: row.tenant_id as string, instanceId, keyId, label, enrolledAt: now };
}

export async function touchLastContact(tenantId: string, instanceId: string, keyId: string, client?: Queryable) {
  await db(client).query("UPDATE company_os_instance_keys SET last_contact_at=now() WHERE tenant_id=$1 AND instance_id=$2 AND key_id=$3", [tenantId, instanceId, keyId]);
}

// --- bundles -------------------------------------------------------------------------------

const POLAR_PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BundleRow = { id: string; name: string; description: string; stripe_price_id: string | null; polar_product_id: string | null; monthly_price_cents: number; currency: string };

export function billingBundle(row: BundleRow) {
  return { id: row.id, name: row.name, polarProductId: row.polar_product_id ?? null, stripePriceId: row.stripe_price_id ?? null, monthlyPriceCents: row.monthly_price_cents, currency: row.currency };
}

/** A function bundle: the Polar product id and/or the Stripe price id are the provider references; the active provider decides which one counts. */
export async function upsertBundle(input: { id: string; name: string; description: string; stripePriceId: string | null; polarProductId?: string | null; monthlyPriceCents: number; currency?: string }, client?: Queryable) {
  if (input.stripePriceId !== null && !/^price_[A-Za-z0-9]+$/.test(input.stripePriceId)) throw new StoreError("stripe_price_id_invalid", 400);
  const polarProductId = input.polarProductId ?? null;
  if (polarProductId !== null && !POLAR_PRODUCT_ID.test(polarProductId)) throw new StoreError("polar_product_id_invalid", 400);
  if (!Number.isSafeInteger(input.monthlyPriceCents) || input.monthlyPriceCents < 0) throw new StoreError("monthly_price_invalid", 400);
  await db(client).query(
    "INSERT INTO company_os_function_bundles(id,name,description,stripe_price_id,polar_product_id,monthly_price_cents,currency) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,stripe_price_id=EXCLUDED.stripe_price_id,polar_product_id=EXCLUDED.polar_product_id,monthly_price_cents=EXCLUDED.monthly_price_cents,currency=EXCLUDED.currency,updated_at=now()",
    [input.id, input.name, input.description, input.stripePriceId, polarProductId, input.monthlyPriceCents, (input.currency ?? "chf").toLowerCase()],
  );
}

export async function addPackageToBundle(bundleId: string, packageId: string, client?: Queryable) {
  const bundle = await db(client).query("SELECT id FROM company_os_function_bundles WHERE id=$1", [bundleId]);
  if (!bundle.rowCount) throw new StoreError("bundle_not_found", 404);
  const pkg = await db(client).query("SELECT id FROM company_os_packages WHERE id=$1", [packageId]);
  if (!pkg.rowCount) throw new StoreError("package_not_found", 404);
  await db(client).query("INSERT INTO company_os_bundle_packages(bundle_id,package_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [bundleId, packageId]);
}

function compareSemver(a: string, b: string): number {
  const parse = (value: string) => {
    const clean = value.split("+", 1)[0];
    const dash = clean.indexOf("-");
    return { core: (dash < 0 ? clean : clean.slice(0, dash)).split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease: dash < 0 ? [] : clean.slice(dash + 1).split(".") };
  };
  const [left, right] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i += 1) if ((left.core[i] ?? 0) !== (right.core[i] ?? 0)) return (left.core[i] ?? 0) - (right.core[i] ?? 0);
  if (!left.prerelease.length || !right.prerelease.length) return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.prerelease.length, right.prerelease.length); i += 1) {
    const [x, y] = [left.prerelease[i], right.prerelease[i]];
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1;
    if (x === y) continue;
    const [xn, yn] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

export type CatalogPackage = {
  modelId: string;
  name: string;
  summary: string;
  versionId: string;
  version: string;
  packageDigest: string;
  publisherKeyId: string | null;
  publisherId: string | null;
  publisherName: string | null;
  permissions: string[];
  /** Empty when the signed manifest has no installation questions. */
  slots: Array<{ id: string; question: string; kind: "repository" | "product" | "website"; required: boolean }>;
  description: string;
  minCompanyOsVersion: string;
  maxCompanyOsVersion: string | null;
  installation: { installationId: string; state: string; localAgentDefinitionId: string | null } | null;
  /** Present only for a package the appliance has installed through an active bundle subscription. */
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  artifact?: { downloadPath: string; packageDigest: string; publisherKeyId: string | null; publisherSignature: string; manifest: Record<string, unknown> };
  permissionChanges?: { added: string[]; removed: string[] };
  releaseNotes?: string | null;
};

export type CatalogBundle = {
  bundleId: string;
  name: string;
  description: string;
  monthlyPriceCents: number;
  currency: string;
  priceConfigured: boolean;
  subscription: { subscriptionId: string; state: string; checkoutSessionId: string | null; cancelEffectiveAt: string | null } | null;
  packages: CatalogPackage[];
};

export type CatalogOptions = {
  /** Whether the active billing provider has a reference for the bundle (T6b.1); Stripe's price by default. */
  priceConfigured?: (bundle: ReturnType<typeof billingBundle>) => boolean;
  /** T55 sends this signed query value: base64url(JSON([{installationId,versionId}])). */
  installedVersions?: Map<string, string>;
};

function manifestPermissions(manifest: unknown): string[] {
  const permissions = (manifest as Record<string, unknown> | null)?.permissions;
  return Array.isArray(permissions) ? permissions.filter((permission): permission is string => typeof permission === "string") : [];
}

function permissionChanges(installedManifest: unknown, latestManifest: unknown) {
  const installed = manifestPermissions(installedManifest);
  const latest = manifestPermissions(latestManifest);
  const installedSet = new Set(installed);
  const latestSet = new Set(latest);
  return { added: latest.filter((permission) => !installedSet.has(permission)), removed: installed.filter((permission) => !latestSet.has(permission)) };
}

/** What one enrolled appliance may see: every active bundle with its packages, and the appliance's own state on each. */
export async function catalogForAppliance(tenantId: string, instanceId: string, options: CatalogOptions = {}, client?: Queryable): Promise<CatalogBundle[]> {
  const q = db(client);
  const priced = options.priceConfigured ?? ((bundle) => Boolean(bundle.stripePriceId));
  const bundles = await q.query("SELECT id,name,description,stripe_price_id,polar_product_id,monthly_price_cents,currency FROM company_os_function_bundles WHERE status='active' ORDER BY name");
  const members = await q.query("SELECT bundle_id,package_id FROM company_os_bundle_packages ORDER BY bundle_id,package_id");
  const packages = await q.query("SELECT id,name,summary FROM company_os_packages WHERE status='active'");
  const versions = await q.query(
    "SELECT v.id,v.package_id,v.version,v.manifest,v.publisher_key_id,v.publisher_signature,v.artifact_sha256,v.min_company_os_version,v.release_notes,pub.publisher_id,pub.name AS publisher_name FROM company_os_package_versions v LEFT JOIN company_os_publishers pub ON pub.key_id=v.publisher_key_id WHERE v.status='published'",
  );
  const subscriptions = await q.query(
    "SELECT id,bundle_id,subscription_state,checkout_session_id,cancel_effective_at,created_at FROM company_os_bundle_subscriptions WHERE tenant_id=$1 AND instance_id=$2 ORDER BY created_at DESC",
    [tenantId, instanceId],
  );
  const installations = await q.query(
    "SELECT id,package_id,installed_version_id,installation_state,local_agent_definition_id,created_at FROM company_os_installations WHERE tenant_id=$1 AND instance_id=$2 AND installation_state NOT IN ('removed','failed') ORDER BY created_at DESC",
    [tenantId, instanceId],
  );
  const packageById = new Map(packages.rows.map((row) => [row.id as string, row]));
  const versionById = new Map(versions.rows.map((row) => [row.id as string, row]));
  const latestVersion = new Map<string, Record<string, unknown>>();
  for (const row of versions.rows) {
    const current = latestVersion.get(row.package_id as string);
    if (!current || compareSemver(row.version as string, current.version as string) > 0) latestVersion.set(row.package_id as string, row);
  }
  const installationByPackage = new Map<string, Record<string, unknown>>();
  for (const row of installations.rows) if (!installationByPackage.has(row.package_id as string)) installationByPackage.set(row.package_id as string, row);
  const subscriptionByBundle = new Map<string, Record<string, unknown>>();
  for (const row of subscriptions.rows) {
    const existing = subscriptionByBundle.get(row.bundle_id as string);
    // the live subscription wins over an ended one; otherwise the newest
    const live = (state: unknown) => !["cancelled"].includes(String(state));
    if (!existing || (!live(existing.subscription_state) && live(row.subscription_state))) subscriptionByBundle.set(row.bundle_id as string, row);
  }
  return bundles.rows.map((bundle) => {
    const subscription = subscriptionByBundle.get(bundle.id as string);
    const packageIds = members.rows.filter((m) => m.bundle_id === bundle.id).map((m) => m.package_id as string);
    const items: CatalogPackage[] = [];
    for (const packageId of packageIds) {
      const pkg = packageById.get(packageId);
      const version = latestVersion.get(packageId);
      if (!pkg || !version) continue;
      const manifest = (version.manifest ?? {}) as Record<string, unknown>;
      const compatibility = (manifest.companyOsCompatibility ?? {}) as Record<string, unknown>;
      const installation = installationByPackage.get(packageId);
      const item: CatalogPackage = {
        modelId: packageId,
        name: pkg.name as string,
        summary: pkg.summary as string,
        versionId: version.id as string,
        version: version.version as string,
        packageDigest: version.artifact_sha256 as string,
        publisherKeyId: (version.publisher_key_id as string | null) ?? null,
        publisherId: (version.publisher_id as string | null) ?? null,
        publisherName: (version.publisher_name as string | null) ?? null,
        permissions: manifestPermissions(manifest),
        slots: Array.isArray(manifest.slots) ? manifest.slots.filter((slot): slot is { id: string; question: string; kind: "repository" | "product" | "website"; required: boolean } => Boolean(slot && typeof slot === "object" && typeof (slot as Record<string, unknown>).id === "string" && typeof (slot as Record<string, unknown>).question === "string" && ["repository", "product", "website"].includes(String((slot as Record<string, unknown>).kind)) && typeof (slot as Record<string, unknown>).required === "boolean")) : [],
        description: typeof manifest.summary === "string" ? manifest.summary : (pkg.summary as string),
        minCompanyOsVersion: version.min_company_os_version as string,
        maxCompanyOsVersion: typeof compatibility.maxVersion === "string" ? compatibility.maxVersion : null,
        installation: installation ? { installationId: installation.id as string, state: installation.installation_state as string, localAgentDefinitionId: (installation.local_agent_definition_id as string | null) ?? null } : null,
      };
      const reportedVersionId = installation && options.installedVersions ? options.installedVersions.get(installation.id as string) : undefined;
      const installedCandidate = installation ? versionById.get(reportedVersionId ?? (options.installedVersions ? "" : installation.installed_version_id as string)) : undefined;
      const installed = installedCandidate?.package_id === packageId ? installedCandidate : undefined;
      if (subscription?.subscription_state === "active" && installation && installed) {
        const installedManifest = (installed.manifest ?? {}) as Record<string, unknown>;
        const updateAvailable = compareSemver(version.version as string, installed.version as string) > 0;
        item.installedVersion = installed.version as string;
        item.latestVersion = version.version as string;
        item.updateAvailable = updateAvailable;
        item.permissionChanges = permissionChanges(installedManifest, manifest);
        item.releaseNotes = typeof version.release_notes === "string" ? version.release_notes : (typeof manifest.releaseNotes === "string" ? manifest.releaseNotes : null);
        if (updateAvailable) item.artifact = {
          downloadPath: `/api/company-os/v1/installations/${installation.id as string}/package?versionId=${version.id as string}`,
          packageDigest: version.artifact_sha256 as string,
          publisherKeyId: (version.publisher_key_id as string | null) ?? null,
          publisherSignature: version.publisher_signature as string,
          manifest,
        };
      }
      items.push(item);
    }
    return {
      bundleId: bundle.id as string,
      name: bundle.name as string,
      description: bundle.description as string,
      monthlyPriceCents: bundle.monthly_price_cents as number,
      currency: bundle.currency as string,
      priceConfigured: priced(billingBundle(bundle as BundleRow)),
      subscription: subscription
        ? {
            subscriptionId: subscription.id as string,
            state: subscription.subscription_state as string,
            checkoutSessionId: (subscription.checkout_session_id as string | null) ?? null,
            cancelEffectiveAt: subscription.cancel_effective_at ? new Date(subscription.cancel_effective_at as string).toISOString() : null,
          }
        : null,
      packages: items,
    };
  });
}

// --- bundle subscriptions -----------------------------------------------------------------
// One row per bundle checkout. The provider's objects are opaque ids next to the state:
// billing_provider, provider_checkout_id, provider_subscription_id, provider_customer_id.

export type BundleSubscriptionRow = {
  id: string;
  tenant_id: string;
  instance_id: string;
  bundle_id: string;
  checkout_session_id: string | null;
  billing_provider: string | null;
  provider_checkout_id: string | null;
  provider_subscription_id: string | null;
  provider_customer_id: string | null;
  subscription_state: string;
  entitled_at: unknown;
  cancel_effective_at: unknown;
  stopped_at: unknown;
  created_at: unknown;
};

export async function bundleForCheckout(bundleId: string, client?: Queryable) {
  const r = await db(client).query("SELECT id,name,description,stripe_price_id,polar_product_id,monthly_price_cents,currency FROM company_os_function_bundles WHERE id=$1 AND status='active'", [bundleId]);
  if (!r.rowCount) throw new StoreError("bundle_not_found", 404);
  return r.rows[0] as BundleRow;
}

/** The email the owner gave when the enrolment code was issued, if any: pre-fills the provider's checkout. */
export async function ownerEmail(tenantId: string, client?: Queryable): Promise<string | null> {
  const r = await db(client).query("SELECT owner_email FROM company_os_enrolment_codes WHERE tenant_id=$1 AND owner_email IS NOT NULL ORDER BY created_at DESC LIMIT 1", [tenantId]);
  return (r.rows[0]?.owner_email as string | undefined) ?? null;
}

export async function liveSubscription(tenantId: string, bundleId: string, client?: Queryable) {
  const r = await db(client).query(
    "SELECT id,subscription_state,checkout_session_id,billing_provider,provider_checkout_id,provider_subscription_id,provider_customer_id FROM company_os_bundle_subscriptions WHERE tenant_id=$1 AND bundle_id=$2 AND subscription_state IN ('checkout_pending','active','past_due','suspended','cancellation_pending_uninstall','cancel_at_period_end') ORDER BY created_at DESC LIMIT 1",
    [tenantId, bundleId],
  );
  return (r.rows[0] as Pick<BundleSubscriptionRow, "id" | "subscription_state" | "checkout_session_id" | "billing_provider" | "provider_checkout_id" | "provider_subscription_id" | "provider_customer_id"> | undefined) ?? null;
}

export async function createBundleSubscription(input: { tenantId: string; instanceId: string; bundleId: string; provider: string }, client?: Queryable) {
  const id = randomUUID();
  const checkoutSessionId = randomUUID();
  await db(client).query(
    "INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,checkout_session_id,billing_provider,subscription_state) VALUES($1,$2,$3,$4,$5,$6,'checkout_pending')",
    [id, input.tenantId, input.instanceId, input.bundleId, checkoutSessionId, input.provider],
  );
  return { subscriptionId: id, checkoutSessionId };
}

export async function recordBundleCheckout(subscriptionId: string, providerCheckoutId: string, client?: Queryable) {
  await db(client).query("UPDATE company_os_bundle_subscriptions SET provider_checkout_id=$2,updated_at=now() WHERE id=$1", [subscriptionId, providerCheckoutId]);
}

export async function abandonBundleCheckout(subscriptionId: string, client?: Queryable) {
  await db(client).query("UPDATE company_os_bundle_subscriptions SET subscription_state='cancelled',stopped_at=now(),updated_at=now() WHERE id=$1 AND subscription_state='checkout_pending' AND provider_subscription_id IS NULL", [subscriptionId]);
}

/**
 * The provider reports the checkout paid and its subscription created: the appliance may now
 * install the bundle's packages. The row is found by the provider's checkout id (the one the
 * store recorded when it created the checkout); the metadata the provider echoes back must
 * agree with it when present.
 */
export async function activateBundleSubscription(input: { provider: string; providerCheckoutId: string; providerSubscriptionId: string; providerCustomerId?: string | null; subscriptionId?: string | null; tenantId?: string | null }, client?: Queryable) {
  const r = await db(client).query(
    "UPDATE company_os_bundle_subscriptions SET subscription_state='active',provider_subscription_id=$3,provider_customer_id=COALESCE($4,provider_customer_id),entitled_at=COALESCE(entitled_at,now()),updated_at=now() WHERE billing_provider=$1 AND provider_checkout_id=$2 AND ($5::uuid IS NULL OR id=$5::uuid) AND ($6::uuid IS NULL OR tenant_id=$6::uuid) AND subscription_state IN ('checkout_pending','active','past_due') RETURNING id",
    [input.provider, input.providerCheckoutId, input.providerSubscriptionId, input.providerCustomerId ?? null, input.subscriptionId ?? null, input.tenantId ?? null],
  );
  return Boolean(r.rowCount);
}

export async function bundleSubscriptionRow(tenantId: string, filter: { subscriptionId?: string; bundleId?: string }, client?: Queryable): Promise<BundleSubscriptionRow | null> {
  const r = filter.subscriptionId
    ? await db(client).query("SELECT * FROM company_os_bundle_subscriptions WHERE tenant_id=$1 AND id=$2", [tenantId, filter.subscriptionId])
    : await db(client).query("SELECT * FROM company_os_bundle_subscriptions WHERE tenant_id=$1 AND bundle_id=$2 ORDER BY created_at DESC LIMIT 1", [tenantId, filter.bundleId]);
  return (r.rows[0] as BundleSubscriptionRow | undefined) ?? null;
}

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

/** What the appliance polls: the provider-neutral state, never a provider id. */
export function subscriptionViewOf(row: BundleSubscriptionRow) {
  return {
    subscriptionId: row.id,
    bundleId: row.bundle_id,
    subscriptionState: row.subscription_state,
    checkoutSessionId: row.checkout_session_id ?? null,
    entitledAt: iso(row.entitled_at),
    cancelEffectiveAt: iso(row.cancel_effective_at),
    stoppedAt: iso(row.stopped_at),
  };
}

export async function subscriptionView(tenantId: string, filter: { subscriptionId?: string; bundleId?: string }, client?: Queryable) {
  const row = await bundleSubscriptionRow(tenantId, filter, client);
  return row ? subscriptionViewOf(row) : null;
}

export type BundleSubscriptionTransition = "past_due" | "active" | "uncancelled" | "cancel_at_period_end" | "cancelled";

/**
 * A provider event on the bundle subscription it sold; the installation mirror is derived from it.
 *
 * - `active`: back from past due (a scheduled cancellation is not undone by a payment)
 * - `uncancelled`: the scheduled cancellation reverted before the period end
 * - `cancel_at_period_end`: active until the period end, the date recorded
 * - `cancelled`: billing stopped
 */
export async function markBundleSubscriptionState(provider: string, providerSubscriptionId: string, transition: BundleSubscriptionTransition, effectiveAt: string | null, client?: Queryable) {
  const q = db(client);
  const statements: Record<BundleSubscriptionTransition, string> = {
    cancelled: "UPDATE company_os_bundle_subscriptions SET subscription_state='cancelled',stopped_at=$3,updated_at=now() WHERE billing_provider=$1 AND provider_subscription_id=$2 AND subscription_state<>'cancelled' RETURNING id",
    cancel_at_period_end: "UPDATE company_os_bundle_subscriptions SET subscription_state='cancel_at_period_end',cancel_effective_at=$3,updated_at=now() WHERE billing_provider=$1 AND provider_subscription_id=$2 AND subscription_state IN ('active','past_due','cancellation_pending_uninstall','cancel_at_period_end') RETURNING id",
    past_due: "UPDATE company_os_bundle_subscriptions SET subscription_state='past_due',updated_at=now() WHERE billing_provider=$1 AND provider_subscription_id=$2 AND subscription_state='active' AND $3::text IS NULL RETURNING id",
    active: "UPDATE company_os_bundle_subscriptions SET subscription_state='active',updated_at=now() WHERE billing_provider=$1 AND provider_subscription_id=$2 AND subscription_state IN ('past_due','suspended') AND $3::text IS NULL RETURNING id",
    uncancelled: "UPDATE company_os_bundle_subscriptions SET subscription_state='active',cancel_effective_at=NULL,updated_at=now() WHERE billing_provider=$1 AND provider_subscription_id=$2 AND subscription_state='cancel_at_period_end' AND $3::text IS NULL RETURNING id",
  };
  const effective = transition === "cancelled" || transition === "cancel_at_period_end" ? (effectiveAt ?? new Date().toISOString()) : null;
  const r = await q.query(statements[transition], [provider, providerSubscriptionId, effective]);
  if (!r.rowCount) return false;
  const ids = r.rows.map((row) => row.id as string);
  const state = transition === "uncancelled" ? "active" : transition;
  // mirror on the installations that ride this subscription (the appliance polls both)
  await q.query("UPDATE company_os_installations SET subscription_state=$2,updated_at=now() WHERE bundle_subscription_id = ANY($1::uuid[])", [ids, state]);
  if (transition === "cancel_at_period_end") await q.query("UPDATE company_os_installations SET billing_cancel_effective_at=$2,updated_at=now() WHERE bundle_subscription_id = ANY($1::uuid[])", [ids, effective]);
  if (transition === "uncancelled") await q.query("UPDATE company_os_installations SET billing_cancel_effective_at=NULL,updated_at=now() WHERE bundle_subscription_id = ANY($1::uuid[])", [ids]);
  if (transition === "cancelled") await q.query("UPDATE company_os_installations SET billing_stopped_at=COALESCE(billing_stopped_at,$2),updated_at=now() WHERE bundle_subscription_id = ANY($1::uuid[]) AND installation_state='removed'", [ids, effective]);
  return true;
}

export async function rememberProviderCustomer(provider: string, providerSubscriptionId: string, providerCustomerId: string, client?: Queryable) {
  await db(client).query("UPDATE company_os_bundle_subscriptions SET provider_customer_id=$3,updated_at=now() WHERE billing_provider=$1 AND provider_subscription_id=$2 AND provider_customer_id IS NULL", [provider, providerSubscriptionId, providerCustomerId]);
}

/**
 * A catch-all provider update (Polar's subscription.updated): a refresh of the known fields,
 * never a state source of its own. It records the period end of a scheduled cancellation,
 * moves active <-> past_due when the provider says so, and never touches a pending checkout
 * or an ended subscription.
 */
export async function refreshBundleSubscription(provider: string, providerSubscriptionId: string, view: { state: string | null; periodEnd: string | null; providerCustomerId: string | null }, client?: Queryable) {
  const q = db(client);
  const r = await q.query("SELECT id,subscription_state FROM company_os_bundle_subscriptions WHERE billing_provider=$1 AND provider_subscription_id=$2", [provider, providerSubscriptionId]);
  const row = r.rows[0] as { id: string; subscription_state: string } | undefined;
  if (!row) return false;
  if (view.providerCustomerId) await rememberProviderCustomer(provider, providerSubscriptionId, view.providerCustomerId, q);
  if (row.subscription_state === "cancel_at_period_end" && view.periodEnd) {
    await q.query("UPDATE company_os_bundle_subscriptions SET cancel_effective_at=$2,updated_at=now() WHERE id=$1", [row.id, view.periodEnd]);
    await q.query("UPDATE company_os_installations SET billing_cancel_effective_at=$2,updated_at=now() WHERE bundle_subscription_id=$1", [row.id, view.periodEnd]);
  }
  if (view.state === "past_due" && row.subscription_state === "active") await markBundleSubscriptionState(provider, providerSubscriptionId, "past_due", null, q);
  if (view.state === "active" && row.subscription_state === "past_due") await markBundleSubscriptionState(provider, providerSubscriptionId, "active", null, q);
  return true;
}

// --- installations inside a bundle subscription ---------------------------------------------

/**
 * An installation of one package of a subscribed bundle: created straight into `entitled`,
 * because the money question was answered at the bundle checkout. The installation shares
 * the bundle subscription's identity, so the locked uninstall receipt and billing
 * acknowledgement keep working unchanged on the appliance.
 */
export async function createStoreInstallation(input: { tenantId: string; instanceId: string; bundleId: string; modelId: string }, client?: Queryable) {
  const q = db(client);
  const member = await q.query("SELECT 1 FROM company_os_bundle_packages WHERE bundle_id=$1 AND package_id=$2", [input.bundleId, input.modelId]);
  if (!member.rowCount) throw new StoreError("package_not_in_bundle", 404);
  const subscription = await liveSubscription(input.tenantId, input.bundleId, q);
  if (!subscription || subscription.subscription_state !== "active") throw new StoreError("subscription_not_active", 409);
  const existing = await q.query(
    "SELECT id,installation_state FROM company_os_installations WHERE tenant_id=$1 AND package_id=$2 AND installation_state NOT IN ('removed','failed') ORDER BY created_at DESC LIMIT 1",
    [input.tenantId, input.modelId],
  );
  if (existing.rowCount) throw new StoreError(`package_already_installed:${existing.rows[0].id}`, 409);
  const version = await q.query(
    "SELECT id,version,artifact_sha256,publisher_key_id FROM company_os_package_versions WHERE package_id=$1 AND status='published' ORDER BY published_at DESC",
    [input.modelId],
  );
  if (!version.rowCount) throw new StoreError("package_not_found", 404);
  let latest = version.rows[0];
  for (const row of version.rows) if (compareSemver(row.version as string, latest.version as string) > 0) latest = row;
  const installationId = randomUUID();
  await q.query(
    "INSERT INTO company_os_installations(id,tenant_id,instance_id,package_id,desired_version_id,subscription_id,bundle_subscription_id,installation_state,subscription_state,entitled_at) VALUES($1,$2,$3,$4,$5,$6,$6,'entitled','active',now())",
    [installationId, input.tenantId, input.instanceId, input.modelId, latest.id, subscription.id],
  );
  return {
    installationId,
    subscriptionId: subscription.id,
    bundleId: input.bundleId,
    modelId: input.modelId,
    versionId: latest.id as string,
    version: latest.version as string,
    packageDigest: latest.artifact_sha256 as string,
    publisherKeyId: (latest.publisher_key_id as string | null) ?? null,
    state: "entitled" as const,
    subscriptionState: "active" as const,
  };
}

/** After an accepted uninstall receipt: does any other installation still ride the bundle subscription? */
export async function otherInstallationsOnSubscription(bundleSubscriptionId: string, installationId: string, client?: Queryable) {
  const r = await db(client).query(
    "SELECT count(*)::int AS remaining FROM company_os_installations WHERE bundle_subscription_id=$1 AND id<>$2 AND installation_state NOT IN ('removed','failed')",
    [bundleSubscriptionId, installationId],
  );
  return Number(r.rows[0]?.remaining ?? 0);
}

export async function bundleSubscriptionForInstallation(installationId: string, client?: Queryable) {
  const r = await db(client).query(
    "SELECT s.id,s.billing_provider,s.provider_subscription_id,s.provider_customer_id,s.subscription_state FROM company_os_installations i JOIN company_os_bundle_subscriptions s ON s.id=i.bundle_subscription_id WHERE i.id=$1",
    [installationId],
  );
  return (r.rows[0] as { id: string; billing_provider: string | null; provider_subscription_id: string | null; provider_customer_id: string | null; subscription_state: string } | undefined) ?? null;
}

export async function scheduleBundleCancellation(subscriptionId: string, effectiveAt: string, client?: Queryable) {
  await db(client).query(
    "UPDATE company_os_bundle_subscriptions SET subscription_state='cancel_at_period_end',cancel_effective_at=$2,updated_at=now() WHERE id=$1 AND subscription_state IN ('active','past_due','cancellation_pending_uninstall')",
    [subscriptionId, effectiveAt],
  );
  await db(client).query("UPDATE company_os_installations SET subscription_state='cancel_at_period_end',billing_cancel_effective_at=$2,updated_at=now() WHERE bundle_subscription_id=$1", [subscriptionId, effectiveAt]);
}

/** The CEO cancels a bundle nothing is installed from any more (the receipt-gated path handles the rest). */
export async function cancellableSubscription(tenantId: string, subscriptionId: string, client?: Queryable) {
  const q = db(client);
  const r = await q.query("SELECT id,bundle_id,subscription_state,billing_provider,provider_subscription_id FROM company_os_bundle_subscriptions WHERE tenant_id=$1 AND id=$2", [tenantId, subscriptionId]);
  const row = r.rows[0] as { id: string; bundle_id: string; subscription_state: string; billing_provider: string | null; provider_subscription_id: string | null } | undefined;
  if (!row) throw new StoreError("subscription_not_found", 404);
  if (!["active", "past_due", "suspended"].includes(row.subscription_state)) throw new StoreError(`subscription_state_mismatch:${row.subscription_state}`, 409);
  const active = await q.query("SELECT count(*)::int AS n FROM company_os_installations WHERE bundle_subscription_id=$1 AND installation_state NOT IN ('removed','failed')", [subscriptionId]);
  if (Number(active.rows[0]?.n ?? 0) > 0) throw new StoreError("installations_still_active_uninstall_first", 409);
  return row;
}

/** The artifact bytes Old School uploaded for a version, when the store serves it itself. */
export async function storedArtifact(versionId: string, client?: Queryable) {
  const r = await db(client).query("SELECT artifact,artifact_bytes,artifact_sha256 FROM company_os_package_artifacts WHERE version_id=$1", [versionId]);
  const row = r.rows[0];
  if (!row) return null;
  return { bytes: Buffer.from(row.artifact as Buffer), digest: row.artifact_sha256 as string, length: row.artifact_bytes as number };
}
