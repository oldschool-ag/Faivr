import { createPrivateKey, randomUUID, sign as edSign } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as unknown as import("pg").Pool }));
vi.mock("@/lib/postgres", () => ({ getPgPool: () => holder.pool }));

import { canonicalSignedMessage, verifyMessageSignature } from "@/lib/companyOs/auth";
import { addPackageToBundle, enrolPublisher, issueEnrolmentCode, upsertBundle } from "@/lib/companyOs/privateStore";
import { keyIdFor, loadEd25519PublicKey } from "@/lib/companyOs/publisherKeys";
import { enrol, storeCatalog, storeCheckoutSessions, storeInstallations, storeSubscriptionCancel, storeSubscriptions } from "@/app/api/company-os/v1/storeHandlers";
import { activationReceipts, billing, uninstallReceipts, uninstallRequests } from "@/app/api/company-os/v1/handlers";
import { POST as polarWebhook } from "@/app/api/company-os/v1/billing/polar/webhook/route";
import { createStoreDb, ed25519Pair, envelope, signedManifest, signedRequest, type Appliance } from "./helpers/companyOsStoreDb";
import { POLAR_TEST_SECRET, polarFixture, signPolarWebhook, type PolarSigningForm } from "./helpers/polarWebhook";

/**
 * The private store with Polar as the billing provider (T6b.1): the T6b flow end to end
 * against pg-mem, with Polar's API answers recorded and Polar's webhooks signed the way Polar
 * signs them. No Stripe variable is set anywhere in this suite.
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
const PERIOD_END_ISO = new Date(PERIOD_END).toISOString();

function jsonResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

async function bodyOf(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("the private Truchsess store billed through Polar", () => {
  let publisher: { privatePem: string; publicPem: string; keyId: string };
  let versionId: string;
  let manifest: Record<string, unknown>;
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
    publisher = { ...pair, keyId };
    await enrolPublisher({ publicKeyPem: pair.publicPem, publisherId: "old-school", name: "Old School AG" });
    manifest = signedManifest({ modelId: MODEL_ID, version: VERSION, payload: PAYLOAD, publisherKeyId: keyId, publisherPrivatePem: pair.privatePem, permissions: PERMISSIONS });
    versionId = randomUUID();
    await holder.pool.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,'example-reviewer','Example reviewer','Reviews supplied artifacts and returns findings.','active')", [MODEL_ID]);
    await holder.pool.query(
      "INSERT INTO company_os_package_versions(id,package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,$3,'published',$4,$5,$6,$7,$8,1,NULL,'1.0.0',now())",
      [versionId, MODEL_ID, VERSION, JSON.stringify(manifest), keyId, (manifest.signature as { value: string }).value, `https://packages.faivr.test/company-os/v1/packages/${MODEL_ID}/${VERSION}/x.tar.gz`, manifest.packageDigest],
    );
    await holder.pool.query("INSERT INTO company_os_package_artifacts(version_id,artifact,artifact_bytes,artifact_sha256) VALUES($1,$2,$3,$4)", [versionId, PAYLOAD, PAYLOAD.length, manifest.packageDigest]);
    // one function bundle: the Polar product the CEO created in the sandbox dashboard, no Stripe price
    await upsertBundle({ id: BUNDLE, name: "Design review", description: "The design reviewer package, monthly.", stripePriceId: null, polarProductId: POLAR.product, monthlyPriceCents: 4900 });
    await addPackageToBundle(BUNDLE, MODEL_ID);
    const issued = await issueEnrolmentCode({ label: "CEO appliance", createdBy: "store-admin", ownerEmail: "owner@example.test" });
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
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const name of ["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_ENVIRONMENT", "POLAR_ORGANIZATION_ID", "FAIVR_BILLING_SIGNING_PRIVATE_KEY", "FAIVR_BILLING_SIGNING_PUBLIC_KEY", "FAIVR_BILLING_SIGNING_KEY_ID"]) delete process.env[name];
    await holder.pool.end();
  });

  function values(extra: Record<string, string> = {}) {
    return { POLAR_SUBSCRIPTION_ID: POLAR.subscription, POLAR_CHECKOUT_ID: POLAR.checkout, POLAR_CUSTOMER_ID: POLAR.customer, POLAR_PRODUCT_ID: POLAR.product, POLAR_ORGANIZATION_ID: POLAR.organization, TENANT_ID: tenantId, INSTANCE_ID: appliance.instanceId, BUNDLE_ID: BUNDLE, PERIOD_END, POLAR_ORDER_ID: randomUUID(), BILLING_REASON: "subscription_create", ...extra };
  }

  async function enrolAppliance() {
    const response = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentCode, appliancePublicKeyPem: appliance.keys.publicPem, label: "Bernd's box" }) }));
    const body = await bodyOf(response);
    expect(response.status, JSON.stringify(body)).toBe(201);
    appliance.instanceId = body.instanceId as string;
    appliance.keyId = body.keyId as string;
  }

  async function deliver(fixture: string, extra: Record<string, string> = {}, options: { id?: string; form?: PolarSigningForm } = {}) {
    const body = polarFixture(`webhooks/${fixture}`, values(extra));
    const response = await polarWebhook(new NextRequest("https://store.faivr.test/api/company-os/v1/billing/polar/webhook", { method: "POST", headers: signPolarWebhook(body, { id: options.id, form: options.form }), body }));
    return { status: response.status, body: await bodyOf(response) };
  }

  async function subscribe() {
    answers.push(jsonResponse(polarFixture("api/checkout.created", values({ FAIVR_SUBSCRIPTION_ID: "pending" })), 201));
    const checkoutBody = envelope(appliance, { bundleId: BUNDLE });
    const response = await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", checkoutBody, { idempotencyKey: checkoutBody.idempotencyKey as string }));
    const result = await bodyOf(response);
    expect(response.status, JSON.stringify(result)).toBe(201);
    return { subscriptionId: result.subscriptionId as string, result, checkoutBody };
  }

  async function poll(query: string) {
    return (await bodyOf(await storeSubscriptions(signedRequest(appliance, "GET", `/api/company-os/v1/store/subscriptions?${query}`)))).subscription as Record<string, unknown>;
  }

  it("runs subscribe, Polar's activation, install, uninstall with receipt, cancellation and the end of billing in order", async () => {
    await enrolAppliance();

    // 1. subscribe: the store asks Polar for one checkout of the bundle's product for this owner; the appliance sees checkout_pending
    const { subscriptionId, result, checkoutBody } = await subscribe();
    expect(result).toMatchObject({ bundleId: BUNDLE, hostedUrl: "https://sandbox.polar.sh/checkout/polar_c_secret_TEST", subscriptionState: "checkout_pending", billingProvider: "polar" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://sandbox-api.polar.sh/v1/checkouts/");
    const asked = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(asked.products).toEqual([POLAR.product]);
    expect(asked.external_customer_id).toBe(tenantId);
    expect(asked.customer_email).toBe("owner@example.test");
    expect(asked.metadata).toEqual({ faivr_subscription_id: subscriptionId, faivr_tenant_id: tenantId, faivr_instance_id: appliance.instanceId, faivr_bundle_id: BUNDLE });
    expect(asked.success_url).toBe("https://store.faivr.test/store/checkout/success");
    // the same idempotency key replays the same answer without a second Polar call
    const replay = await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", checkoutBody, { idempotencyKey: checkoutBody.idempotencyKey as string }));
    expect(await bodyOf(replay)).toMatchObject({ subscriptionId });
    expect(calls).toHaveLength(1);
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "checkout_pending" });
    // the catalog names the provider and marks the bundle subscribable
    const catalog = await bodyOf(await storeCatalog(signedRequest(appliance, "GET", "/api/company-os/v1/store/catalog")));
    expect(catalog.billingProvider).toBe("polar");
    expect((catalog.bundles as Array<Record<string, unknown>>)[0]).toMatchObject({ priceConfigured: true });
    // installing before the payment is refused
    const early = await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", envelope(appliance, { bundleId: BUNDLE, faivrAgentModelId: MODEL_ID })));
    expect(early.status).toBe(409);

    // 2. Polar's events for the paid checkout: created (a refresh, nothing yet), active (the activation), order.paid (already active)
    const created = await deliver("subscription.created", { FAIVR_SUBSCRIPTION_ID: subscriptionId });
    expect(created).toMatchObject({ status: 202, body: { received: true, applied: false, action: "unknown_subscription" } });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "checkout_pending" });
    const active = await deliver("subscription.active", { FAIVR_SUBSCRIPTION_ID: subscriptionId });
    expect(active).toMatchObject({ status: 202, body: { received: true, applied: true, action: "activated" } });
    expect(await poll(`bundleId=${BUNDLE}`)).toMatchObject({ subscriptionId, subscriptionState: "active" });
    const paid = await deliver("order.paid", { FAIVR_SUBSCRIPTION_ID: subscriptionId });
    expect(paid.status).toBe(202);
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "active" });
    const stored = await holder.pool.query("SELECT billing_provider,provider_checkout_id,provider_subscription_id,provider_customer_id FROM company_os_bundle_subscriptions WHERE id=$1", [subscriptionId]);
    expect(stored.rows[0]).toEqual({ billing_provider: "polar", provider_checkout_id: POLAR.checkout, provider_subscription_id: POLAR.subscription, provider_customer_id: POLAR.customer });

    // 3. install, activation acknowledged (the T6b path, unchanged)
    const installBody = envelope(appliance, { bundleId: BUNDLE, faivrAgentModelId: MODEL_ID });
    const installed = await bodyOf(await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", installBody, { idempotencyKey: installBody.idempotencyKey as string })));
    expect(installed).toMatchObject({ subscriptionId, bundleId: BUNDLE, state: "entitled", subscriptionState: "active" });
    const installationId = installed.installationId as string;
    const ack = envelope(appliance, { messageType: "installation.acknowledged", installationId, modelId: MODEL_ID, version: VERSION, localAgentDefinitionId: "agdef_example_reviewer", packageDigest: manifest.packageDigest, activationResult: "active", compatibilityVerified: true, publisherSignatureVerified: true, packageChecksPassed: true, activatedAt: new Date().toISOString() });
    expect((await activationReceipts(signedRequest(appliance, "POST", "/api/company-os/v1/activation-receipts", ack, { idempotencyKey: ack.idempotencyKey as string }))).status).toBe(200);

    // 4. the Manage-subscription link: a fresh Polar customer session for the owner, only when asked for
    answers.push(jsonResponse(polarFixture("api/customer-session", values()), 201));
    const withPortal = await poll(`bundleId=${BUNDLE}&customerPortal=1`);
    expect(withPortal).toMatchObject({ subscriptionState: "active", customerPortalUrl: "https://sandbox.polar.sh/old-school/portal?customer_session_token=polar_cst_TESTtoken", customerPortalExpiresAt: "2026-09-30T13:30:00.000Z" });
    expect(calls.at(-1)?.url).toBe("https://sandbox-api.polar.sh/v1/customer-sessions/");
    expect(JSON.parse(String(calls.at(-1)?.init.body))).toEqual({ customer_id: POLAR.customer });
    expect(await poll(`bundleId=${BUNDLE}`)).not.toHaveProperty("customerPortalUrl");

    // 5. uninstall request and signed receipt: the last package of the bundle makes the store cancel at Polar at the period end
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
    const receipt = { ...(receiptUnsigned as unknown as Record<string, unknown> & { idempotencyKey: string; receiptId: string }), signature: { keyId: appliance.keyId, algorithm: "Ed25519", value: signature } };
    answers.push(jsonResponse(polarFixture("api/subscription.active", values())), jsonResponse(polarFixture("api/subscription.cancel_at_period_end", values())));
    const accepted = await bodyOf(await uninstallReceipts(signedRequest(appliance, "POST", "/api/company-os/v1/uninstall-receipts", receipt, { idempotencyKey: receipt.idempotencyKey as string })));
    expect(accepted).toMatchObject({ state: "receipt_accepted", subscriptionState: "cancel_at_period_end", remainingInstallations: 0, effectiveAt: PERIOD_END_ISO });
    const patch = calls.at(-1)!;
    expect(patch.init.method).toBe("PATCH");
    expect(patch.url).toBe(`https://sandbox-api.polar.sh/v1/subscriptions/${POLAR.subscription}`);
    expect(JSON.parse(String(patch.init.body))).toEqual({ cancel_at_period_end: true });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "cancel_at_period_end", cancelEffectiveAt: PERIOD_END_ISO });

    // 6. the signed billing acknowledgement: cancellation scheduled
    const scheduled = await bodyOf(await billing(signedRequest(appliance, "GET", `/api/company-os/v1/billing?installationId=${installationId}`)));
    expect(scheduled).toMatchObject({ messageType: "billing.stop_acknowledged", receiptState: "accepted", subscriptionState: "cancel_at_period_end", subscriptionId, receiptId: receipt.receiptId });
    expect(verifyMessageSignature(scheduled as Record<string, unknown> & { signature: { value: string } }, billingKeys.publicPem)).toBe(true);

    // 7. Polar confirms the cancellation (canceled, then updated: both leave the state as it is), then revokes at the period end
    expect((await deliver("subscription.canceled", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ applied: true, action: "cancel_scheduled" });
    expect((await deliver("subscription.updated.canceled", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ applied: true, action: "refreshed" });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "cancel_at_period_end" });
    const revoked = await deliver("subscription.revoked", { FAIVR_SUBSCRIPTION_ID: subscriptionId }, { id: "msg_revoked_once" });
    expect(revoked.body).toMatchObject({ applied: true, action: "ended" });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "cancelled", stoppedAt: PERIOD_END_ISO });
    const stopped = await bodyOf(await billing(signedRequest(appliance, "GET", `/api/company-os/v1/billing?installationId=${installationId}`)));
    expect(stopped).toMatchObject({ subscriptionState: "cancelled", receiptState: "accepted" });
    // a redelivery of the same webhook id is acknowledged and changes nothing
    const again = await deliver("subscription.revoked", { FAIVR_SUBSCRIPTION_ID: subscriptionId }, { id: "msg_revoked_once" });
    expect(again).toEqual({ status: 202, body: { received: true, replayed: true } });
    const events = await holder.pool.query("SELECT count(*)::int AS n FROM company_os_webhook_events WHERE provider='polar'");
    expect(events.rows[0].n).toBe(6);
  });

  it("brings an uncancelled bundle back to active and a past-due bundle back when Polar says so", async () => {
    await enrolAppliance();
    const { subscriptionId } = await subscribe();
    await deliver("subscription.active", { FAIVR_SUBSCRIPTION_ID: subscriptionId });
    // the CEO cancels a bundle nothing is installed from
    answers.push(jsonResponse(polarFixture("api/subscription.active", values())), jsonResponse(polarFixture("api/subscription.cancel_at_period_end", values())));
    const cancelBody = envelope(appliance, { subscriptionId });
    expect(await bodyOf(await storeSubscriptionCancel(signedRequest(appliance, "POST", "/api/company-os/v1/store/subscriptions/cancel", cancelBody, { idempotencyKey: cancelBody.idempotencyKey as string })))).toMatchObject({ subscriptionState: "cancel_at_period_end", effectiveAt: PERIOD_END_ISO });
    // then reverts it in Polar's customer portal
    expect((await deliver("subscription.uncanceled", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ applied: true, action: "uncancelled" });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "active", cancelEffectiveAt: null });
    // a payment fails: past due refuses new installations; the recovery through updated (a refresh) or active brings it back
    expect((await deliver("subscription.past_due", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ applied: true, action: "past_due" });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "past_due" });
    const refused = await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", envelope(appliance, { bundleId: BUNDLE, faivrAgentModelId: MODEL_ID })));
    expect(refused.status).toBe(409);
    expect((await deliver("subscription.updated.active", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ applied: true, action: "refreshed" });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "active" });
    // an immediate revocation by Old School (canceled with status canceled) ends billing at once
    expect((await deliver("subscription.canceled.immediate", { FAIVR_SUBSCRIPTION_ID: subscriptionId })).body).toMatchObject({ applied: true, action: "ended" });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "cancelled" });
  });

  it("never activates a pending checkout from a catch-all update, and shrugs at subscriptions it does not know", async () => {
    await enrolAppliance();
    const { subscriptionId } = await subscribe();
    const updated = await deliver("subscription.updated.active", { FAIVR_SUBSCRIPTION_ID: subscriptionId });
    expect(updated).toMatchObject({ status: 202, body: { applied: false, action: "unknown_subscription" } });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "checkout_pending" });
    // an event about another organization's subscription is recorded and answered 202: Polar must not retry it
    const stranger = await deliver("subscription.revoked", { FAIVR_SUBSCRIPTION_ID: randomUUID(), POLAR_SUBSCRIPTION_ID: randomUUID(), POLAR_CHECKOUT_ID: randomUUID() });
    expect(stranger).toMatchObject({ status: 202, body: { applied: false, action: "unknown_subscription" } });
    // an activation whose checkout id the store never issued activates nothing
    const forged = await deliver("subscription.active", { FAIVR_SUBSCRIPTION_ID: subscriptionId, POLAR_CHECKOUT_ID: randomUUID() });
    expect(forged.body).toMatchObject({ applied: false, action: "unknown_subscription" });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "checkout_pending" });
    // no portal link while nothing was bought
    expect(await poll(`subscriptionId=${subscriptionId}&customerPortal=1`)).not.toHaveProperty("customerPortalUrl");
  });

  it("accepts both of Polar's signing keys, refuses bad signatures with 403 and unreadable payloads with 400", async () => {
    await enrolAppliance();
    const { subscriptionId } = await subscribe();
    const body = polarFixture("webhooks/subscription.created", values({ FAIVR_SUBSCRIPTION_ID: subscriptionId }));
    const post = (headers: Record<string, string>, payload = body) => polarWebhook(new NextRequest("https://store.faivr.test/api/company-os/v1/billing/polar/webhook", { method: "POST", headers, body: payload }));
    expect((await post(signPolarWebhook(body, { form: "standard" }))).status).toBe(202);
    expect((await post(signPolarWebhook(body, { form: "hmac" }))).status).toBe(202);
    expect((await post(signPolarWebhook(body, { secret: "whsec_c29tZW9uZSBlbHNlJ3Mgc2VjcmV0IGtleQ==" }))).status).toBe(403);
    expect((await post(signPolarWebhook(body, { timestamp: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(403);
    expect((await post({ "Content-Type": "application/json" })).status).toBe(403);
    const tampered = body.replace("subscription.created", "subscription.revoked");
    expect((await post(signPolarWebhook(body), tampered)).status).toBe(403);
    expect((await post(signPolarWebhook("not json"), "not json")).status).toBe(400);
    const unknown = JSON.stringify({ type: "benefit_grant.created", timestamp: "2026-09-30T12:00:00Z", api_version: "2026-10", data: { id: randomUUID() } });
    expect(await bodyOf(await post(signPolarWebhook(unknown), unknown))).toMatchObject({ received: true, action: "ignored" });
    expect(await poll(`subscriptionId=${subscriptionId}`)).toMatchObject({ subscriptionState: "checkout_pending" });
  });

  it("refuses to run the store when Polar's credentials are missing, and needs no Stripe account", async () => {
    await enrolAppliance();
    expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
    delete process.env.POLAR_ACCESS_TOKEN;
    const checkout = await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", envelope(appliance, { bundleId: BUNDLE })));
    expect(checkout.status).toBe(503);
    expect((await bodyOf(checkout)).error).toBe("billing_provider_not_configured:polar:POLAR_ACCESS_TOKEN");
    const webhook = await polarWebhook(new NextRequest("https://store.faivr.test/api/company-os/v1/billing/polar/webhook", { method: "POST", headers: signPolarWebhook("{}"), body: "{}" }));
    expect(webhook.status).toBe(503);
    expect(calls).toHaveLength(0);
    // a bundle without a Polar product is listed but not subscribable
    process.env.POLAR_ACCESS_TOKEN = "polar_oat_TESTtoken";
    await upsertBundle({ id: "unpriced", name: "Unpriced", description: "no product yet", stripePriceId: "price_onlyStripe", polarProductId: null, monthlyPriceCents: 0 });
    const catalog = await bodyOf(await storeCatalog(signedRequest(appliance, "GET", "/api/company-os/v1/store/catalog")));
    expect((catalog.bundles as Array<Record<string, unknown>>).find((b) => b.bundleId === "unpriced")).toMatchObject({ priceConfigured: false });
    const unpriced = await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", envelope(appliance, { bundleId: "unpriced" })));
    expect(unpriced.status).toBe(503);
    expect((await bodyOf(unpriced)).error).toBe("polar_product_not_configured");
    expect(calls).toHaveLength(0);
  });
});
