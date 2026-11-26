import { createPrivateKey, randomUUID, sign as edSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as unknown as import("pg").Pool }));
vi.mock("@/lib/postgres", () => ({ getPgPool: () => holder.pool }));

import { canonicalSignedMessage } from "@/lib/companyOs/auth";
import { addPackageToBundle, enrolPublisher, issueEnrolmentCode, refreshBundleSubscription, upsertBundle } from "@/lib/companyOs/privateStore";
import { applyDueSubscriptionDates, endSubscriptionByAdmin, grantSubscriptionByOrder, OrderError } from "@/lib/companyOs/subscriptionOrders.mjs";
import { applyBillingEvent } from "@/lib/companyOs/billing/events";
import { keyIdFor, loadEd25519PublicKey } from "@/lib/companyOs/publisherKeys";
import { enrol, storeCatalog, storeCheckoutSessions, storeInstallations, storeSubscriptionCancel, storeSubscriptions } from "@/app/api/company-os/v1/storeHandlers";
import { activationReceipts, billing, uninstallReceipts, uninstallRequests } from "@/app/api/company-os/v1/handlers";
import { POST as polarWebhook } from "@/app/api/company-os/v1/billing/polar/webhook/route";
import { createStoreDb, ed25519Pair, envelope, signedManifest, signedRequest, type Appliance } from "./helpers/companyOsStoreDb";
import { POLAR_TEST_SECRET, polarFixture, signPolarWebhook } from "./helpers/polarWebhook";
import { assertSafeMigration } from "../scripts/run-store-migrations.mjs";

/**
 * ST1, subscriptions by order: Old School grants a box a function billed by invoice, and ends a
 * subscription with a grace, without a billing provider. Polar is configured (sandbox) the whole
 * time, as in production, and every request to it is recorded: the invoice path makes none.
 */

const MODEL_ID = "faivr.agent.example-reviewer";
const VERSION = "1.2.0";
const BUNDLE = "design-review";
const PAYLOAD = Buffer.from("deterministic payload bytes of the example reviewer package");
const PERMISSIONS = ["workspace.read", "workspace.write", "exec.sandbox", "net.allowlist", "model.lane:standard"];
const POLAR = {
  product: "55555555-5555-4555-8555-555555555555",
  checkout: "66666666-6666-4666-8666-666666666666",
  subscription: "77777777-7777-4777-8777-777777777777",
  customer: "88888888-8888-4888-8888-888888888888",
  organization: "99999999-9999-4999-8999-999999999999",
};
const PERIOD_END = "2026-10-30T12:00:00.000000Z";
const ADMIN = "bernd (store admin)";
const DAY = 24 * 60 * 60 * 1000;

function jsonResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

async function bodyOf(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("ST1: a subscription by order (billed by invoice)", () => {
  let manifest: Record<string, unknown>;
  let versionId: string;
  let appliance: Appliance;
  let enrolmentCode: string;
  let tenantId: string;
  let calls: Array<{ url: string; init: RequestInit }>;
  let answers: Response[];
  const billingKeys = ed25519Pair();

  beforeEach(async () => {
    const created = createStoreDb();
    holder.pool = created.pool;
    for (const key of ["FAIVR_BILLING_PROVIDER", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) delete process.env[key];
    process.env.POLAR_ACCESS_TOKEN = "polar_oat_TESTtoken";
    process.env.POLAR_WEBHOOK_SECRET = POLAR_TEST_SECRET;
    process.env.POLAR_ENVIRONMENT = "sandbox";
    process.env.POLAR_ORGANIZATION_ID = POLAR.organization;
    process.env.FAIVR_BILLING_SIGNING_PRIVATE_KEY = billingKeys.privatePem;
    process.env.FAIVR_BILLING_SIGNING_PUBLIC_KEY = billingKeys.publicPem;
    process.env.FAIVR_BILLING_SIGNING_KEY_ID = "faivr-billing-2026-09";

    const pair = ed25519Pair();
    const keyId = keyIdFor(loadEd25519PublicKey(pair.publicPem));
    await enrolPublisher({ publicKeyPem: pair.publicPem, publisherId: "old-school", name: "Old School AG" });
    manifest = signedManifest({ modelId: MODEL_ID, version: VERSION, payload: PAYLOAD, publisherKeyId: keyId, publisherPrivatePem: pair.privatePem, permissions: PERMISSIONS });
    versionId = randomUUID();
    await holder.pool.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,'example-reviewer','Example reviewer','Reviews supplied artifacts and returns findings.','active')", [MODEL_ID]);
    await holder.pool.query(
      "INSERT INTO company_os_package_versions(id,package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,$3,'published',$4,$5,$6,$7,$8,1,NULL,'1.0.0',now())",
      [versionId, MODEL_ID, VERSION, JSON.stringify(manifest), keyId, (manifest.signature as { value: string }).value, `https://packages.faivr.test/company-os/v1/packages/${MODEL_ID}/${VERSION}/x.tar.gz`, manifest.packageDigest],
    );
    await holder.pool.query("INSERT INTO company_os_package_artifacts(version_id,artifact,artifact_bytes,artifact_sha256) VALUES($1,$2,$3,$4)", [versionId, PAYLOAD, PAYLOAD.length, manifest.packageDigest]);
    await upsertBundle({ id: BUNDLE, name: "Design review", description: "The design reviewer package, monthly.", stripePriceId: null, polarProductId: POLAR.product, monthlyPriceCents: 4900 });
    await addPackageToBundle(BUNDLE, MODEL_ID);
    const issued = await issueEnrolmentCode({ label: "Office box", createdBy: "store-admin", ownerEmail: "owner@example.test" });
    enrolmentCode = issued.code;
    tenantId = issued.tenantId;
    appliance = { tenantId, instanceId: "", keyId: "", keys: ed25519Pair() };
    calls = [];
    answers = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const next = answers.shift();
      if (!next) throw new Error(`unexpected Polar request ${init.method ?? "GET"} ${String(url)}`);
      return next;
    }));
    const response = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentCode, appliancePublicKeyPem: appliance.keys.publicPem, label: "Office box" }) }));
    const body = await bodyOf(response);
    expect(response.status, JSON.stringify(body)).toBe(201);
    appliance.instanceId = body.instanceId as string;
    appliance.keyId = body.keyId as string;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const name of ["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_ENVIRONMENT", "POLAR_ORGANIZATION_ID", "FAIVR_BILLING_SIGNING_PRIVATE_KEY", "FAIVR_BILLING_SIGNING_PUBLIC_KEY", "FAIVR_BILLING_SIGNING_KEY_ID"]) delete process.env[name];
    await holder.pool.end();
  });

  const today = () => new Date().toISOString().slice(0, 10);

  async function grant(extra: { endsOn?: string; now?: Date } = {}) {
    return grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: BUNDLE, startsOn: today(), administrator: ADMIN, note: "Office order 2026-11", ...extra });
  }

  async function catalogBundle() {
    const response = await storeCatalog(signedRequest(appliance, "GET", "/api/company-os/v1/store/catalog"));
    const body = await bodyOf(response);
    expect(response.status, JSON.stringify(body)).toBe(200);
    return (body.bundles as Array<Record<string, unknown>>).find((bundle) => bundle.bundleId === BUNDLE)!;
  }

  async function poll(query: string) {
    return (await bodyOf(await storeSubscriptions(signedRequest(appliance, "GET", `/api/company-os/v1/store/subscriptions?${query}`)))).subscription as Record<string, unknown>;
  }

  async function install() {
    const installBody = envelope(appliance, { bundleId: BUNDLE, faivrAgentModelId: MODEL_ID });
    return storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", installBody, { idempotencyKey: installBody.idempotencyKey as string }));
  }

  async function installAndActivate() {
    const response = await install();
    const installed = await bodyOf(response);
    expect(response.status, JSON.stringify(installed)).toBe(201);
    const installationId = installed.installationId as string;
    const ack = envelope(appliance, { messageType: "installation.acknowledged", installationId, modelId: MODEL_ID, version: VERSION, localAgentDefinitionId: "agdef_example_reviewer", packageDigest: manifest.packageDigest, activationResult: "active", compatibilityVerified: true, publisherSignatureVerified: true, packageChecksPassed: true, activatedAt: new Date().toISOString() });
    expect((await activationReceipts(signedRequest(appliance, "POST", "/api/company-os/v1/activation-receipts", ack, { idempotencyKey: ack.idempotencyKey as string }))).status).toBe(200);
    return { installed, installationId };
  }

  function values(extra: Record<string, string> = {}) {
    return { POLAR_SUBSCRIPTION_ID: POLAR.subscription, POLAR_CHECKOUT_ID: POLAR.checkout, POLAR_CUSTOMER_ID: POLAR.customer, POLAR_PRODUCT_ID: POLAR.product, POLAR_ORGANIZATION_ID: POLAR.organization, TENANT_ID: tenantId, INSTANCE_ID: appliance.instanceId, BUNDLE_ID: BUNDLE, PERIOD_END, POLAR_ORDER_ID: randomUUID(), BILLING_REASON: "subscription_create", ...extra };
  }

  async function deliver(fixture: string, extra: Record<string, string> = {}) {
    const body = polarFixture(`webhooks/${fixture}`, values(extra));
    const response = await polarWebhook(new NextRequest("https://store.faivr.test/api/company-os/v1/billing/polar/webhook", { method: "POST", headers: signPolarWebhook(body, { id: `msg_${randomUUID()}` }), body }));
    return { status: response.status, body: await bodyOf(response) };
  }

  async function row(subscriptionId: string) {
    return (await holder.pool.query("SELECT subscription_state,billing_provider,provider_checkout_id,provider_subscription_id,provider_customer_id,cancel_effective_at,stopped_at,admin_ended_by FROM company_os_bundle_subscriptions WHERE id=$1", [subscriptionId])).rows[0] as Record<string, unknown>;
  }

  async function uninstallLast(installationId: string, subscriptionId: string) {
    const uninstallRequestId = randomUUID();
    const request = envelope(appliance, { requestId: uninstallRequestId, installationId, faivrAgentModelId: MODEL_ID, faivrPackageVersionId: versionId, reason: "operator uninstall" });
    expect((await uninstallRequests(signedRequest(appliance, "POST", "/api/company-os/v1/uninstall-requests", request, { idempotencyKey: request.idempotencyKey as string }))).status).toBe(200);
    const receiptUnsigned = envelope(appliance, {
      messageType: "package.uninstalled", installationId, modelId: MODEL_ID, version: VERSION, receiptId: randomUUID(), uninstallRequestId, subscriptionId,
      localAgentDefinitionId: "agdef_example_reviewer", packageDigest: manifest.packageDigest, removedManagedPaths: [`agents/${MODEL_ID}/${VERSION}`], result: "completed",
      verifiedEffects: { agentRegistrationAbsent: true, schedulesRevoked: true, toolGrantsRevoked: true, agentSecretsRevoked: true, packagePayloadRemoved: true, historicalCompanyDataPreserved: true },
      retainedData: { customerDataPurged: false, historicalCompanyData: "retained_read_only", backupDisposition: "retention_policy", userCopies: "not_verified", thirdPartyCopies: "not_verified" },
      completedAt: new Date().toISOString(), nonce: randomUUID(),
    });
    const signature = edSign(null, Buffer.from(canonicalSignedMessage({ ...receiptUnsigned, signature: undefined })), createPrivateKey(appliance.keys.privatePem)).toString("base64url");
    const receipt = { ...(receiptUnsigned as unknown as Record<string, unknown> & { idempotencyKey: string }), signature: { keyId: appliance.keyId, algorithm: "Ed25519", value: signature } };
    const response = await uninstallReceipts(signedRequest(appliance, "POST", "/api/company-os/v1/uninstall-receipts", receipt, { idempotencyKey: receipt.idempotencyKey }));
    return { status: response.status, body: await bodyOf(response) };
  }

  it("installs on the real store path from an invoice grant, exactly as from a paid subscription", async () => {
    const granted = await grant();
    expect(granted).toMatchObject({ bundleId: BUNDLE, copyNumber: 1, description: "Design review", billing: "invoice", subscriptionState: "active", grantedBy: ADMIN });

    // the catalog the box reads before "Install all": an active subscription, billed by invoice
    const bundle = await catalogBundle();
    expect(bundle.subscription).toMatchObject({ subscriptionId: granted.subscriptionId, state: "active", billing: "invoice", endsAt: null, cancelEffectiveAt: null });
    expect(bundle.entitlements).toEqual([expect.objectContaining({ subscriptionId: granted.subscriptionId, copyNumber: 1, state: "active" })]);

    // the box's install request (office mode: Install all, copy 1), then its activation receipt
    const { installed, installationId } = await installAndActivate();
    expect(installed).toMatchObject({ subscriptionId: granted.subscriptionId, bundleId: BUNDLE, state: "entitled", subscriptionState: "active", packageDigest: manifest.packageDigest });
    const after = await catalogBundle();
    expect((after.packages as Array<Record<string, unknown>>)[0].installation).toMatchObject({ installationId, state: "active" });
    expect(await poll(`bundleId=${BUNDLE}`)).toMatchObject({ subscriptionId: granted.subscriptionId, subscriptionState: "active", billing: "invoice" });

    // the audit line names the administrator
    const audit = await holder.pool.query("SELECT action,administrator,detail FROM company_os_subscription_audit WHERE subscription_id=$1", [granted.subscriptionId]);
    expect(audit.rows).toEqual([expect.objectContaining({ action: "granted_by_order", administrator: ADMIN })]);
    expect((audit.rows[0].detail as Record<string, unknown>).note).toBe("Office order 2026-11");
    expect(calls).toEqual([]);
  });

  it("makes no Polar call anywhere on the invoice path: portal, cancel, last uninstall, end and the sweep", async () => {
    const granted = await grant();
    const { installationId } = await installAndActivate();
    // Manage subscription: no provider portal for an invoice subscription
    const portal = await poll(`bundleId=${BUNDLE}&customerPortal=1`);
    expect(portal).toMatchObject({ billing: "invoice", customerPortalUrl: null, customerPortalExpiresAt: null });
    // the box's Cancel (once nothing is installed) is refused with "ask Old School"; first the last uninstall
    const receipt = await uninstallLast(installationId, granted.subscriptionId);
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(200);
    expect(receipt.body).toMatchObject({ state: "receipt_accepted", subscriptionState: "active", effectiveAt: null, remainingInstallations: 0, billing: "invoice" });
    expect(await row(granted.subscriptionId)).toMatchObject({ subscription_state: "active" });
    const cancelBody = envelope(appliance, { subscriptionId: granted.subscriptionId });
    const cancel = await storeSubscriptionCancel(signedRequest(appliance, "POST", "/api/company-os/v1/store/subscriptions/cancel", cancelBody, { idempotencyKey: cancelBody.idempotencyKey as string }));
    expect(cancel.status).toBe(409);
    expect(await bodyOf(cancel)).toMatchObject({ error: "subscription_by_order_ask_old_school" });
    // Old School ends it with a grace of 0 days: ended now, by the sweep, still without Polar
    const ended = await endSubscriptionByAdmin(holder.pool, { subscriptionId: granted.subscriptionId, graceDays: 0, administrator: ADMIN, reason: "order ended" });
    expect(ended).toMatchObject({ billing: "invoice", subscriptionState: "cancel_at_period_end", endedBy: ADMIN });
    expect(await poll(`subscriptionId=${granted.subscriptionId}`)).toMatchObject({ subscriptionState: "cancelled" });
    // the uninstalled agent's billing acknowledgement now says billing stopped
    const stopped = await bodyOf(await billing(signedRequest(appliance, "GET", `/api/company-os/v1/billing?installationId=${installationId}`)));
    expect(stopped).toMatchObject({ messageType: "billing.stop_acknowledged", subscriptionState: "cancelled" });
    // and a provider event addressed at the invoice provider name is ignored outright
    expect(await applyBillingEvent({ provider: "invoice" as never, kind: "subscription_ended", providerSubscriptionId: granted.subscriptionId, periodEnd: null } as never, holder.pool)).toEqual({ applied: false, action: "ignored" });
    expect(calls).toEqual([]);
  });

  it("a sandbox webhook can neither end nor change an invoice grant", async () => {
    const granted = await grant();
    const { installationId } = await installAndActivate();
    const before = await row(granted.subscriptionId);
    // every Polar subscription event, signed by Polar's sandbox secret, aimed at the grant by its store id and box
    for (const fixture of ["subscription.revoked", "subscription.canceled", "subscription.canceled.immediate", "subscription.past_due", "subscription.updated.canceled", "subscription.updated.past_due", "subscription.uncanceled", "subscription.active", "subscription.created", "order.paid"]) {
      const delivered = await deliver(fixture, { FAIVR_SUBSCRIPTION_ID: granted.subscriptionId });
      expect(delivered.status, fixture).toBe(202);
      expect(delivered.body.applied ?? false, fixture).toBe(false);
    }
    expect(await row(granted.subscriptionId)).toEqual(before);
    expect(before).toMatchObject({ subscription_state: "active", billing_provider: "invoice", provider_checkout_id: null, provider_subscription_id: null, provider_customer_id: null });
    const installation = await holder.pool.query("SELECT subscription_state,installation_state FROM company_os_installations WHERE id=$1", [installationId]);
    expect(installation.rows[0]).toEqual({ subscription_state: "active", installation_state: "active" });
    expect(calls).toEqual([]);
  });

  it("a sandbox subscription the administrator ended is no longer Polar's to change", async () => {
    // the January move: a box paid in the Polar sandbox; Old School ends it in the store with a grace
    answers.push(jsonResponse(polarFixture("api/checkout.created", values({ FAIVR_SUBSCRIPTION_ID: "pending" })), 201));
    const checkoutBody = envelope(appliance, { bundleId: BUNDLE });
    const checkout = await bodyOf(await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", checkoutBody, { idempotencyKey: checkoutBody.idempotencyKey as string })));
    const subscriptionId = checkout.subscriptionId as string;
    expect((await deliver("subscription.active", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ applied: true, action: "activated" });
    const polarCalls = calls.length;
    await expect(endSubscriptionByAdmin(holder.pool, { subscriptionId, graceDays: 14, administrator: ADMIN })).rejects.toThrow("provider_subscription_needs_confirmation_the_provider_is_not_told");
    const ended = await endSubscriptionByAdmin(holder.pool, { subscriptionId, graceDays: 14, administrator: ADMIN, confirmProviderNotTold: true, reason: "sandbox ends; January move" });
    expect(ended).toMatchObject({ billing: "polar", subscriptionState: "cancel_at_period_end" });
    const before = await row(subscriptionId);
    expect(before).toMatchObject({ subscription_state: "cancel_at_period_end", admin_ended_by: ADMIN });
    for (const fixture of ["subscription.uncanceled", "subscription.active", "subscription.updated.active", "subscription.revoked", "subscription.canceled"]) {
      expect((await deliver(fixture, { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body.applied ?? false, fixture).toBe(false);
    }
    expect(await row(subscriptionId)).toEqual(before);
    expect(calls).toHaveLength(polarCalls);
    const audit = await holder.pool.query("SELECT action,administrator,detail FROM company_os_subscription_audit WHERE subscription_id=$1", [subscriptionId]);
    expect(audit.rows).toEqual([expect.objectContaining({ action: "ended_by_admin", administrator: ADMIN, detail: expect.objectContaining({ billing: "polar", providerTold: false, graceDays: 14 }) })]);
  });

  it("ending with a grace stops new tasks only after the grace", async () => {
    const granted = await grant();
    const { installationId } = await installAndActivate();
    const endedAt = new Date();
    const ended = await endSubscriptionByAdmin(holder.pool, { subscriptionId: granted.subscriptionId, graceDays: 14, administrator: ADMIN, now: endedAt });
    const graceEnd = new Date(endedAt.getTime() + 14 * DAY).toISOString();
    expect(ended.effectiveAt).toBe(graceEnd);

    // during the grace: the installed agent keeps working (the box acts on "cancelled" only), the box shows the date, nothing new is reserved
    const during = await catalogBundle();
    expect(during.subscription).toMatchObject({ state: "cancel_at_period_end", cancelEffectiveAt: graceEnd });
    expect((during.packages as Array<Record<string, unknown>>)[0].installation).toMatchObject({ installationId, state: "active" });
    const refused = await install();
    expect(refused.status).toBe(409);
    expect(await bodyOf(refused)).toMatchObject({ error: "subscription_not_active" });
    expect(await applyDueSubscriptionDates(holder.pool, { now: new Date(endedAt.getTime() + 14 * DAY - 1000) })).toEqual({ ended: [] });
    expect(await poll(`subscriptionId=${granted.subscriptionId}`)).toMatchObject({ subscriptionState: "cancel_at_period_end" });

    // the grace is over: cancelled, stopped on the grace's last day; the box's reconcile stops the agent (no new tasks)
    const after = await applyDueSubscriptionDates(holder.pool, { now: new Date(endedAt.getTime() + 14 * DAY + 1000) });
    expect(after.ended).toEqual([{ subscriptionId: granted.subscriptionId, reason: "admin_grace_over", stoppedAt: graceEnd }]);
    expect(await poll(`subscriptionId=${granted.subscriptionId}`)).toMatchObject({ subscriptionState: "cancelled", stoppedAt: graceEnd });
    expect((await catalogBundle()).subscription).toMatchObject({ state: "cancelled" });
    const installation = await holder.pool.query("SELECT subscription_state FROM company_os_installations WHERE id=$1", [installationId]);
    expect(installation.rows[0].subscription_state).toBe("cancelled");
    // a second sweep changes nothing; the audit trail has the admin's end and the store's
    expect(await applyDueSubscriptionDates(holder.pool, { now: new Date(endedAt.getTime() + 20 * DAY) })).toEqual({ ended: [] });
    const audit = await holder.pool.query("SELECT action,administrator FROM company_os_subscription_audit WHERE subscription_id=$1 ORDER BY created_at", [granted.subscriptionId]);
    expect(audit.rows).toEqual([{ action: "granted_by_order", administrator: ADMIN }, { action: "ended_by_admin", administrator: ADMIN }, { action: "ended", administrator: "store" }]);
    expect(calls).toEqual([]);
  });

  it("grants ahead of the start day: the box installs at once, billing starts on the start date", async () => {
    const start = new Date(Date.now() + 4 * DAY).toISOString().slice(0, 10);
    const granted = await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: BUNDLE, startsOn: start, administrator: ADMIN });
    expect(granted).toMatchObject({ subscriptionState: "active", startsAt: `${start}T00:00:00.000Z` });
    expect((await install()).status).toBe(201);
    expect(calls).toEqual([]);
  });

  it("ends an order on its end date, and the store applies passed dates before it answers the box", async () => {
    // granted 40 days ago for 30 days: the end date has passed; the next catalog read applies it
    const granted = await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: BUNDLE, startsOn: new Date(Date.now() - 40 * DAY).toISOString().slice(0, 10), endsOn: new Date(Date.now() - 10 * DAY).toISOString(), administrator: ADMIN, now: new Date(Date.now() - 40 * DAY) });
    expect((await catalogBundle()).subscription).toMatchObject({ subscriptionId: granted.subscriptionId, state: "cancelled", billing: "invoice" });
    expect((await install()).status).toBe(409);
    // an end date still ahead keeps the grant active and is shown to the box
    const second = await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: BUNDLE, startsOn: today(), endsOn: "2099-12-31", administrator: ADMIN });
    expect((await catalogBundle()).subscription).toMatchObject({ subscriptionId: second.subscriptionId, state: "active", endsAt: "2099-12-31T00:00:00.000Z" });
    expect(calls).toEqual([]);
  });

  async function sandboxSubscription() {
    answers.push(jsonResponse(polarFixture("api/checkout.created", values({ FAIVR_SUBSCRIPTION_ID: "pending" })), 201));
    const checkoutBody = envelope(appliance, { bundleId: BUNDLE });
    const checkout = await bodyOf(await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", checkoutBody, { idempotencyKey: checkoutBody.idempotencyKey as string })));
    return checkout.subscriptionId as string;
  }

  it("Codex P1: an administrator's end committed while a Polar refresh is in flight is not overwritten", async () => {
    const subscriptionId = await sandboxSubscription();
    expect((await deliver("subscription.active", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ action: "activated" });
    expect((await deliver("subscription.canceled", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ action: "cancel_scheduled" });
    // the refresh reads the row, then the administrator's end commits, then the refresh writes
    const adminEnd = new Date(Date.now() + 3 * DAY).toISOString();
    const racing = {
      query: async (sql: string, params?: unknown[]) => {
        const result = await holder.pool.query(sql, params);
        if (sql.startsWith("SELECT id,subscription_state FROM company_os_bundle_subscriptions")) {
          await holder.pool.query("UPDATE company_os_bundle_subscriptions SET admin_ended_at=now(),admin_ended_by=$2,cancel_effective_at=$3 WHERE id=$1", [subscriptionId, ADMIN, adminEnd]);
        }
        return result;
      },
    };
    await refreshBundleSubscription("polar", POLAR.subscription, { state: "active", periodEnd: "2030-01-01T00:00:00.000Z", providerCustomerId: null }, racing as never);
    expect(new Date((await row(subscriptionId)).cancel_effective_at as string).toISOString()).toBe(adminEnd);
  });

  it("Codex P2: a Polar event does not record a customer on a subscription the administrator ended", async () => {
    const subscriptionId = await sandboxSubscription();
    expect((await deliver("subscription.active", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ action: "activated" });
    await holder.pool.query("UPDATE company_os_bundle_subscriptions SET provider_customer_id=NULL WHERE id=$1", [subscriptionId]);
    await endSubscriptionByAdmin(holder.pool, { subscriptionId, graceDays: 7, administrator: ADMIN, confirmProviderNotTold: true });
    await deliver("subscription.active", { FAIVR_SUBSCRIPTION_ID: subscriptionId });
    expect((await row(subscriptionId)).provider_customer_id).toBeNull();
  });

  it("Codex P2: the earlier of an order end date and an administrator's grace is the stop date", async () => {
    const start = new Date();
    const granted = await grant({ endsOn: new Date(start.getTime() + 30 * DAY).toISOString(), now: start });
    await endSubscriptionByAdmin(holder.pool, { subscriptionId: granted.subscriptionId, graceDays: 10, administrator: ADMIN, now: start });
    // the store first runs after both dates
    const swept = await applyDueSubscriptionDates(holder.pool, { now: new Date(start.getTime() + 40 * DAY) });
    expect(swept.ended).toEqual([{ subscriptionId: granted.subscriptionId, reason: "admin_grace_over", stoppedAt: new Date(start.getTime() + 10 * DAY).toISOString() }]);
  });

  it("Codex P1: an agent uninstalled after its order ended gets the end on its mirror and a billing acknowledgement", async () => {
    const granted = await grant();
    const { installationId } = await installAndActivate();
    await endSubscriptionByAdmin(holder.pool, { subscriptionId: granted.subscriptionId, graceDays: 0, administrator: ADMIN });
    const stoppedAt = new Date((await row(granted.subscriptionId)).stopped_at as string).toISOString();
    const receipt = await uninstallLast(installationId, granted.subscriptionId);
    expect(receipt.status, JSON.stringify(receipt.body)).toBe(200);
    expect(receipt.body).toMatchObject({ subscriptionState: "cancelled", effectiveAt: stoppedAt });
    const installation = await holder.pool.query("SELECT subscription_state,billing_stopped_at FROM company_os_installations WHERE id=$1", [installationId]);
    expect(installation.rows[0].subscription_state).toBe("cancelled");
    expect(new Date(installation.rows[0].billing_stopped_at).toISOString()).toBe(stoppedAt);
    const acknowledgement = await bodyOf(await billing(signedRequest(appliance, "GET", `/api/company-os/v1/billing?installationId=${installationId}`)));
    expect(acknowledgement).toMatchObject({ messageType: "billing.stop_acknowledged", subscriptionState: "cancelled", effectiveAt: stoppedAt });
    expect(calls).toEqual([]);
  });

  it("refuses a grant that would be wrong, with a reason", async () => {
    const refuse = (input: Partial<Parameters<typeof grantSubscriptionByOrder>[1]>) => grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: BUNDLE, startsOn: today(), administrator: ADMIN, ...input });
    await expect(refuse({ administrator: " " })).rejects.toThrow("administrator_required");
    await expect(refuse({ startsOn: "2099-01-01" })).rejects.toThrow("start_more_than_a_year_away");
    await expect(refuse({ startsOn: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10), endsOn: new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10) })).rejects.toThrow("end_not_after_start");
    await expect(refuse({ endsOn: "2020-01-01" })).rejects.toThrow("end_not_in_future");
    await expect(refuse({ instanceId: randomUUID() })).rejects.toThrow("box_not_enrolled");
    await expect(refuse({ bundleId: "no-such-function" })).rejects.toThrow("bundle_not_found");
    const granted = await refuse({});
    await expect(refuse({})).rejects.toThrow(`subscription_exists:${granted.subscriptionId}:active:invoice`);
    await expect(refuse({})).rejects.toBeInstanceOf(OrderError);
    // a revoked box key is no enrolled box
    await holder.pool.query("UPDATE company_os_instance_keys SET revoked_at=now() WHERE instance_id=$1", [appliance.instanceId]);
    await expect(refuse({ copyNumber: 2 })).rejects.toThrow("box_not_enrolled");
    await expect(endSubscriptionByAdmin(holder.pool, { subscriptionId: granted.subscriptionId, graceDays: -1, administrator: ADMIN })).rejects.toThrow("grace_days_invalid");
    await endSubscriptionByAdmin(holder.pool, { subscriptionId: granted.subscriptionId, graceDays: 7, administrator: ADMIN });
    await expect(endSubscriptionByAdmin(holder.pool, { subscriptionId: granted.subscriptionId, graceDays: 7, administrator: ADMIN })).rejects.toThrow("subscription_already_ended_by_admin");
  });

  it("tells the box when a function has no buyable price, and refuses a checkout of a function sold by order", async () => {
    expect(await catalogBundle()).toMatchObject({ priceConfigured: true, buyable: true, purchase: "checkout" });
    // no Polar product: listed, not buyable ("Ask Old School")
    await holder.pool.query("UPDATE company_os_function_bundles SET polar_product_id=NULL WHERE id=$1", [BUNDLE]);
    expect(await catalogBundle()).toMatchObject({ priceConfigured: false, buyable: false, purchase: "order" });
    // a Polar product, but Old School sells it only by order
    await holder.pool.query("UPDATE company_os_function_bundles SET polar_product_id=$2,sold_by_order=true WHERE id=$1", [BUNDLE, POLAR.product]);
    expect(await catalogBundle()).toMatchObject({ priceConfigured: false, buyable: false, purchase: "order" });
    const checkoutBody = envelope(appliance, { bundleId: BUNDLE });
    const checkout = await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", checkoutBody, { idempotencyKey: checkoutBody.idempotencyKey as string }));
    expect(checkout.status).toBe(409);
    expect(await bodyOf(checkout)).toMatchObject({ error: "bundle_sold_by_order_ask_old_school" });
    // and the order still installs
    await grant();
    expect((await install()).status).toBe(201);
    expect(calls).toEqual([]);
  });

  it("ships a migration the store's migration runner accepts", () => {
    const sql = readFileSync(new URL("../sql/migrations/20261126_st1_subscription_by_order.sql", import.meta.url), "utf8");
    expect(() => assertSafeMigration("20261126_st1_subscription_by_order.sql", sql)).not.toThrow();
    for (const column of ["billing_starts_at", "billing_ends_at", "granted_by", "admin_ended_at", "admin_ended_by", "sold_by_order", "company_os_subscription_audit"]) expect(sql).toContain(column);
  });
});
