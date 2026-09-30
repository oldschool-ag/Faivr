import { createHash, createHmac, createPrivateKey, createPublicKey, randomUUID, sign as edSign, verify as edVerify } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as unknown as import("pg").Pool }));
vi.mock("@/lib/postgres", () => ({ getPgPool: () => holder.pool }));

import { canonicalSignedMessage, signCompanyOsRequest, verifyMessageSignature } from "@/lib/companyOs/auth";
import { enrolPublisher, hashEnrolmentCode, issueEnrolmentCode, upsertBundle, addPackageToBundle } from "@/lib/companyOs/privateStore";
import { keyIdFor, loadEd25519PublicKey } from "@/lib/companyOs/publisherKeys";
import { enrol, storeCatalog, storeCheckoutSessions, storeInstallations, storeSubscriptionCancel, storeSubscriptions } from "@/app/api/company-os/v1/storeHandlers";
import { activationReceipts, billing, packageDownload, uninstallReceipts, uninstallRequests } from "@/app/api/company-os/v1/handlers";
import { POST as stripeWebhook } from "@/app/api/company-os/stripe/webhook/route";
import { createStoreDb, ed25519Pair, envelope, signedManifest, signedRequest, type Appliance } from "./helpers/companyOsStoreDb";

const MODEL_ID = "faivr.agent.example-reviewer";
const VERSION = "1.2.0";
const BUNDLE = "design-review";
const PAYLOAD = Buffer.from("deterministic payload bytes of the example reviewer package");
const PERMISSIONS = ["workspace.read", "workspace.write", "exec.sandbox", "net.allowlist", "knowledge.read:example", "model.lane:standard"];
const WEBHOOK_SECRET = "whsec_test_local";

function stripeSignature(payload: string, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  return `t=${timestamp},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex")}`;
}

function stripeFixture(name: string, values: Record<string, string>) {
  let text = readFileSync(new URL(`./fixtures/stripe/${name}.json`, import.meta.url), "utf8");
  for (const [key, value] of Object.entries(values)) text = text.replaceAll(`{{${key}}}`, value);
  return text;
}

async function deliverWebhook(payload: string) {
  return stripeWebhook(new NextRequest("https://store.faivr.test/api/company-os/stripe/webhook", { method: "POST", headers: { "stripe-signature": stripeSignature(payload), "Content-Type": "application/json" }, body: payload }));
}

async function bodyOf(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe("the private Truchsess store on FAIVR", () => {
  let publisher: { privatePem: string; publicPem: string; keyId: string };
  let versionId: string;
  let manifest: Record<string, unknown>;
  let appliance: Appliance;
  let enrolmentCode: string;
  let tenantId: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  const billingKeys = ed25519Pair();

  beforeEach(async () => {
    const created = createStoreDb();
    holder.pool = created.pool;
    process.env.STRIPE_SECRET_KEY = "sk_test_local";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.FAIVR_BILLING_SIGNING_PRIVATE_KEY = billingKeys.privatePem;
    process.env.FAIVR_BILLING_SIGNING_PUBLIC_KEY = billingKeys.publicPem;
    process.env.FAIVR_BILLING_SIGNING_KEY_ID = "faivr-billing-2026-09";
    process.env.FAIVR_PACKAGE_ORIGIN = "https://packages.faivr.test";
    delete process.env.FAIVR_STRIPE_API_ORIGIN;

    // Old School, the only publisher: key enrolled under its derived id
    const pair = ed25519Pair();
    const keyId = keyIdFor(loadEd25519PublicKey(pair.publicPem));
    publisher = { ...pair, keyId };
    expect((await enrolPublisher({ publicKeyPem: pair.publicPem, publisherId: "old-school", name: "Old School AG" })).keyId).toBe(keyId);

    // one catalog entry from a signed export, with the payload bytes stored in the store itself
    manifest = signedManifest({ modelId: MODEL_ID, version: VERSION, payload: PAYLOAD, publisherKeyId: keyId, publisherPrivatePem: pair.privatePem, permissions: PERMISSIONS });
    versionId = randomUUID();
    await holder.pool.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,'example-reviewer','Example reviewer','Reviews supplied artifacts and returns findings.','active')", [MODEL_ID]);
    await holder.pool.query(
      "INSERT INTO company_os_package_versions(id,package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,$3,'published',$4,$5,$6,$7,$8,1,NULL,'1.0.0',now())",
      [versionId, MODEL_ID, VERSION, JSON.stringify(manifest), keyId, (manifest.signature as { value: string }).value, `https://packages.faivr.test/company-os/v1/packages/${MODEL_ID}/${VERSION}/x.tar.gz`, manifest.packageDigest],
    );
    await holder.pool.query("INSERT INTO company_os_package_artifacts(version_id,artifact,artifact_bytes,artifact_sha256) VALUES($1,$2,$3,$4)", [versionId, PAYLOAD, PAYLOAD.length, manifest.packageDigest]);

    // one function bundle with the CEO's Stripe test price
    await upsertBundle({ id: BUNDLE, name: "Design review", description: "The design reviewer package, monthly.", stripePriceId: "price_TESTdesignreview", monthlyPriceCents: 4900 });
    await addPackageToBundle(BUNDLE, MODEL_ID);

    // an enrolment code issued for the CEO's appliance
    const issued = await issueEnrolmentCode({ label: "CEO appliance", createdBy: "store-admin" });
    enrolmentCode = issued.code;
    tenantId = issued.tenantId;
    appliance = { tenantId, instanceId: "", keyId: "", keys: ed25519Pair() };
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "FAIVR_BILLING_SIGNING_PRIVATE_KEY", "FAIVR_BILLING_SIGNING_PUBLIC_KEY", "FAIVR_BILLING_SIGNING_KEY_ID", "FAIVR_PACKAGE_ORIGIN"]) delete process.env[name];
    await holder.pool.end();
  });

  async function enrolAppliance() {
    const response = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentCode, appliancePublicKeyPem: appliance.keys.publicPem, label: "Bernd's box" }) }));
    const body = await bodyOf(response);
    expect(response.status, JSON.stringify(body)).toBe(201);
    appliance.instanceId = body.instanceId as string;
    appliance.keyId = body.keyId as string;
    return body;
  }

  it("enrols an appliance once with a one-time code and derives its key id", async () => {
    const body = await enrolAppliance();
    expect(body.tenantId).toBe(tenantId);
    expect(body.keyId).toBe(keyIdFor(loadEd25519PublicKey(appliance.keys.publicPem)));
    expect(body.serviceKey).toEqual({ keyId: "faivr-billing-2026-09", publicKeyPem: billingKeys.publicPem });
    expect((body.publishers as Array<{ keyId: string; publisherId: string }>).map((p) => [p.keyId, p.publisherId])).toEqual([[publisher.keyId, "old-school"]]);
    // the code is spent
    const again = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", body: JSON.stringify({ enrolmentCode, appliancePublicKeyPem: ed25519Pair().publicPem }) }));
    expect(again.status).toBe(403);
    expect((await bodyOf(again)).error).toBe("enrolment_code_refused");
    // only the hash is stored
    const rows = await holder.pool.query("SELECT code_hash,used_at,key_id FROM company_os_enrolment_codes");
    expect(rows.rows[0].code_hash).toBe(hashEnrolmentCode(enrolmentCode));
    expect(rows.rows[0].key_id).toBe(body.keyId);
    expect(JSON.stringify(rows.rows)).not.toContain(enrolmentCode);
  });

  it("refuses a wrong, expired or non-Ed25519 enrolment", async () => {
    const wrong = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", body: JSON.stringify({ enrolmentCode: "TRS-WRONG-WRONG-WRONG-WRONG", appliancePublicKeyPem: appliance.keys.publicPem }) }));
    expect(wrong.status).toBe(403);
    await holder.pool.query("UPDATE company_os_enrolment_codes SET expires_at=now()-interval '1 day'");
    const expired = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", body: JSON.stringify({ enrolmentCode, appliancePublicKeyPem: appliance.keys.publicPem }) }));
    expect(expired.status).toBe(403);
    await holder.pool.query("UPDATE company_os_enrolment_codes SET expires_at=now()+interval '1 day'");
    const rsa = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", body: JSON.stringify({ enrolmentCode, appliancePublicKeyPem: "-----BEGIN PUBLIC KEY-----\nMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE\n-----END PUBLIC KEY-----\n" }) }));
    expect(rsa.status).toBe(400);
    const privateKey = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", body: JSON.stringify({ enrolmentCode, appliancePublicKeyPem: appliance.keys.privatePem }) }));
    expect(privateKey.status).toBe(400);
  });

  it("shows the catalog to enrolled appliances only, with the permission strings verbatim", async () => {
    const unenrolled = await storeCatalog(signedRequest({ ...appliance, instanceId: randomUUID(), keyId: "ed25519-0000000000000000" }, "GET", "/api/company-os/v1/store/catalog"));
    expect(unenrolled.status).toBe(401);
    await enrolAppliance();
    const anonymous = await storeCatalog(new NextRequest("https://store.faivr.test/api/company-os/v1/store/catalog"));
    expect(anonymous.status).toBe(400);
    const response = await storeCatalog(signedRequest(appliance, "GET", "/api/company-os/v1/store/catalog"));
    const body = await bodyOf(response);
    expect(response.status, JSON.stringify(body)).toBe(200);
    const bundles = body.bundles as Array<Record<string, unknown>>;
    expect(bundles).toHaveLength(1);
    expect(bundles[0]).toMatchObject({ bundleId: BUNDLE, monthlyPriceCents: 4900, currency: "chf", priceConfigured: true, subscription: null });
    const pkg = (bundles[0].packages as Array<Record<string, unknown>>)[0];
    expect(pkg).toMatchObject({ modelId: MODEL_ID, version: VERSION, versionId, packageDigest: manifest.packageDigest, publisherKeyId: publisher.keyId, publisherId: "old-school", publisherName: "Old School AG", permissions: PERMISSIONS, installation: null });
    // last contact is recorded for the Store tab
    const key = await holder.pool.query("SELECT last_contact_at FROM company_os_instance_keys WHERE key_id=$1", [appliance.keyId]);
    expect(key.rows[0].last_contact_at).toBeTruthy();
    // replaying the same signed request is refused
    const request = signedRequest(appliance, "GET", "/api/company-os/v1/store/catalog");
    expect((await storeCatalog(request)).status).toBe(200);
    const replay = new NextRequest(request.url, { headers: request.headers });
    expect((await storeCatalog(replay)).status).toBe(409);
  });

  it("runs subscribe, webhook, install, signed download, activation, uninstall with receipt, cancellation and billing stop in order", async () => {
    await enrolAppliance();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "cs_test_bundle", url: "https://checkout.stripe.test/bundle" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "sub_test_bundle", cancel_at_period_end: true, current_period_end: 1_800_000_000 }), { status: 200 }));

    // 1. subscribe: the appliance owner gets the hosted Stripe URL, the appliance sees checkout_pending
    const checkoutBody = envelope(appliance, { bundleId: BUNDLE });
    const checkout = await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", checkoutBody, { idempotencyKey: checkoutBody.idempotencyKey as string }));
    const checkoutResult = await bodyOf(checkout);
    expect(checkout.status, JSON.stringify(checkoutResult)).toBe(201);
    expect(checkoutResult).toMatchObject({ bundleId: BUNDLE, hostedUrl: "https://checkout.stripe.test/bundle", subscriptionState: "checkout_pending" });
    const subscriptionId = checkoutResult.subscriptionId as string;
    const stripeInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(String(stripeInit.body)).toContain("line_items%5B0%5D%5Bprice%5D=price_TESTdesignreview");
    expect(String(stripeInit.body)).toContain(`metadata%5Bbundle_subscription_id%5D=${subscriptionId}`);
    expect(String(stripeInit.body)).toContain("success_url=https%3A%2F%2Fstore.faivr.test%2Fstore%2Fcheckout%2Fsuccess");
    // the same idempotency key replays the same answer without a second Stripe call
    const replay = await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", checkoutBody, { idempotencyKey: checkoutBody.idempotencyKey as string }));
    expect(await bodyOf(replay)).toMatchObject({ subscriptionId });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // installing before payment is refused
    const early = await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", envelope(appliance, { bundleId: BUNDLE, faivrAgentModelId: MODEL_ID })));
    expect(early.status).toBe(409);
    expect((await bodyOf(early)).error).toBe("subscription_not_active");
    let poll = await bodyOf(await storeSubscriptions(signedRequest(appliance, "GET", `/api/company-os/v1/store/subscriptions?subscriptionId=${subscriptionId}`)));
    expect(poll.subscription).toMatchObject({ subscriptionId, bundleId: BUNDLE, subscriptionState: "checkout_pending" });

    // 2. Stripe's webhook (its checkout.session.completed fixture) activates the bundle subscription
    const completed = await deliverWebhook(stripeFixture("checkout.session.completed", { STRIPE_CHECKOUT_SESSION_ID: "cs_test_bundle", STRIPE_SUBSCRIPTION_ID: "sub_test_bundle", TENANT_ID: tenantId, BUNDLE_SUBSCRIPTION_ID: subscriptionId }));
    expect(completed.status, JSON.stringify(await completed.clone().json())).toBe(200);
    poll = await bodyOf(await storeSubscriptions(signedRequest(appliance, "GET", `/api/company-os/v1/store/subscriptions?bundleId=${BUNDLE}`)));
    expect(poll.subscription).toMatchObject({ subscriptionState: "active" });
    const catalog = await bodyOf(await storeCatalog(signedRequest(appliance, "GET", "/api/company-os/v1/store/catalog")));
    expect((catalog.bundles as Array<Record<string, unknown>>)[0].subscription).toMatchObject({ subscriptionId, state: "active" });

    // 3. install: an entitled installation of the package, sharing the bundle subscription's identity
    const installBody = envelope(appliance, { bundleId: BUNDLE, faivrAgentModelId: MODEL_ID });
    const installation = await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", installBody, { idempotencyKey: installBody.idempotencyKey as string }));
    const installed = await bodyOf(installation);
    expect(installation.status, JSON.stringify(installed)).toBe(201);
    expect(installed).toMatchObject({ subscriptionId, bundleId: BUNDLE, modelId: MODEL_ID, versionId, version: VERSION, packageDigest: manifest.packageDigest, publisherKeyId: publisher.keyId, state: "entitled", subscriptionState: "active" });
    const installationId = installed.installationId as string;
    const twice = await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", envelope(appliance, { bundleId: BUNDLE, faivrAgentModelId: MODEL_ID })));
    expect(twice.status).toBe(409);

    // 4. signed download from the store's own artifact table: digest, publisher key id and signature travel with the bytes
    const download = await packageDownload(signedRequest(appliance, "GET", `/api/company-os/v1/installations/${installationId}/package`), { params: Promise.resolve({ id: installationId }) });
    expect(download.status, await download.clone().text()).toBe(200);
    const bytes = Buffer.from(await download.arrayBuffer());
    expect(bytes.equals(PAYLOAD)).toBe(true);
    expect(download.headers.get("X-FAIVR-Package-Digest")).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
    expect(download.headers.get("X-FAIVR-Publisher-Key-Id")).toBe(publisher.keyId);
    const served = JSON.parse(Buffer.from(download.headers.get("X-FAIVR-Package-Manifest") ?? "", "base64url").toString("utf8")) as Record<string, unknown> & { signature: { value: string } };
    expect(served.packageDigest).toBe(manifest.packageDigest);
    expect(download.headers.get("X-FAIVR-Publisher-Signature")).toBe(served.signature.value);
    // the appliance verifies exactly this: the publisher's Ed25519 signature over the canonical manifest without `signature`
    expect(verifyMessageSignature(served, publisher.publicPem)).toBe(true);
    expect(edVerify(null, Buffer.from(canonicalSignedMessage(served)), createPublicKey(publisher.publicPem), Buffer.from(served.signature.value, "base64url"))).toBe(true);
    const afterDownload = await holder.pool.query("SELECT installation_state FROM company_os_installations WHERE id=$1", [installationId]);
    expect(afterDownload.rows[0].installation_state).toBe("downloading");
    // no stranger downloads it
    const stranger = { ...appliance, keys: ed25519Pair() };
    expect((await packageDownload(signedRequest(stranger, "GET", `/api/company-os/v1/installations/${installationId}/package`), { params: Promise.resolve({ id: installationId }) })).status).toBe(401);

    // 5. activation acknowledged
    const ack = envelope(appliance, { messageType: "installation.acknowledged", installationId, modelId: MODEL_ID, version: VERSION, localAgentDefinitionId: "agdef_example_reviewer", packageDigest: manifest.packageDigest, activationResult: "active", compatibilityVerified: true, publisherSignatureVerified: true, packageChecksPassed: true, activatedAt: new Date().toISOString() });
    const acknowledged = await activationReceipts(signedRequest(appliance, "POST", "/api/company-os/v1/activation-receipts", ack, { idempotencyKey: ack.idempotencyKey as string }));
    expect(acknowledged.status, await acknowledged.clone().text()).toBe(200);
    const catalogAfterInstall = await bodyOf(await storeCatalog(signedRequest(appliance, "GET", "/api/company-os/v1/store/catalog")));
    expect(((catalogAfterInstall.bundles as Array<Record<string, unknown>>)[0].packages as Array<Record<string, unknown>>)[0].installation).toMatchObject({ installationId, state: "active", localAgentDefinitionId: "agdef_example_reviewer" });

    // a subscribed bundle with an active installation cannot be cancelled directly
    const cancelEarly = await storeSubscriptionCancel(signedRequest(appliance, "POST", "/api/company-os/v1/store/subscriptions/cancel", envelope(appliance, { subscriptionId })));
    expect(cancelEarly.status).toBe(409);
    expect((await bodyOf(cancelEarly)).error).toBe("installations_still_active_uninstall_first");

    // 6. uninstall request, then the appliance's signed receipt; the last package of the bundle schedules the Stripe cancellation
    const uninstallRequestId = randomUUID();
    const request = envelope(appliance, { requestId: uninstallRequestId, installationId, faivrAgentModelId: MODEL_ID, faivrPackageVersionId: versionId, reason: "operator uninstall" });
    const requested = await uninstallRequests(signedRequest(appliance, "POST", "/api/company-os/v1/uninstall-requests", request, { idempotencyKey: request.idempotencyKey as string }));
    expect(requested.status, await requested.clone().text()).toBe(200);
    expect(await bodyOf(requested)).toMatchObject({ uninstallRequestId, state: "uninstall_pending" });
    const receiptUnsigned = envelope(appliance, {
      messageType: "package.uninstalled", installationId, modelId: MODEL_ID, version: VERSION, receiptId: randomUUID(), uninstallRequestId, subscriptionId,
      localAgentDefinitionId: "agdef_example_reviewer", packageDigest: manifest.packageDigest, removedManagedPaths: [`agents/${MODEL_ID}/${VERSION}`], result: "completed",
      verifiedEffects: { agentRegistrationAbsent: true, schedulesRevoked: true, toolGrantsRevoked: true, agentSecretsRevoked: true, packagePayloadRemoved: true, historicalCompanyDataPreserved: true },
      retainedData: { customerDataPurged: false, historicalCompanyData: "retained_read_only", backupDisposition: "retention_policy", userCopies: "not_verified", thirdPartyCopies: "not_verified" },
      completedAt: new Date().toISOString(), nonce: randomUUID(),
    });
    const receiptSignature = signReceipt(receiptUnsigned, appliance.keys.privatePem);
    const receipt = { ...(receiptUnsigned as unknown as Record<string, unknown> & { idempotencyKey: string; receiptId: string }), signature: { keyId: appliance.keyId, algorithm: "Ed25519", value: receiptSignature } };
    const accepted = await uninstallReceipts(signedRequest(appliance, "POST", "/api/company-os/v1/uninstall-receipts", receipt, { idempotencyKey: receipt.idempotencyKey as string }));
    const acceptedBody = await bodyOf(accepted);
    expect(accepted.status, JSON.stringify(acceptedBody)).toBe(200);
    expect(acceptedBody).toMatchObject({ state: "receipt_accepted", subscriptionState: "cancel_at_period_end", remainingInstallations: 0, effectiveAt: new Date(1_800_000_000 * 1000).toISOString() });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((fetchMock.mock.calls[1][0] as string))).toContain("/v1/subscriptions/sub_test_bundle");
    poll = await bodyOf(await storeSubscriptions(signedRequest(appliance, "GET", `/api/company-os/v1/store/subscriptions?subscriptionId=${subscriptionId}`)));
    expect(poll.subscription).toMatchObject({ subscriptionState: "cancel_at_period_end" });

    // 7. the signed billing acknowledgement: cancellation scheduled, not yet stopped
    const scheduled = await bodyOf(await billing(signedRequest(appliance, "GET", `/api/company-os/v1/billing?installationId=${installationId}`)));
    expect(scheduled).toMatchObject({ messageType: "billing.stop_acknowledged", receiptState: "accepted", subscriptionState: "cancel_at_period_end", subscriptionId, receiptId: receipt.receiptId, modelId: MODEL_ID, version: VERSION });
    expect(verifyMessageSignature(scheduled as Record<string, unknown> & { signature: { value: string } }, billingKeys.publicPem)).toBe(true);

    // 8. Stripe's customer.subscription.deleted fixture ends billing
    const deleted = await deliverWebhook(stripeFixture("customer.subscription.deleted", { STRIPE_SUBSCRIPTION_ID: "sub_test_bundle", TENANT_ID: tenantId, BUNDLE_SUBSCRIPTION_ID: subscriptionId }));
    expect(deleted.status, JSON.stringify(await deleted.clone().json())).toBe(200);
    const stopped = await bodyOf(await billing(signedRequest(appliance, "GET", `/api/company-os/v1/billing?installationId=${installationId}`)));
    expect(stopped).toMatchObject({ subscriptionState: "cancelled", receiptState: "accepted" });
    expect(verifyMessageSignature(stopped as Record<string, unknown> & { signature: { value: string } }, billingKeys.publicPem)).toBe(true);
    poll = await bodyOf(await storeSubscriptions(signedRequest(appliance, "GET", `/api/company-os/v1/store/subscriptions?subscriptionId=${subscriptionId}`)));
    expect(poll.subscription).toMatchObject({ subscriptionState: "cancelled" });
    // a replayed event is acknowledged and changes nothing
    const replayed = await deliverWebhook(stripeFixture("customer.subscription.deleted", { STRIPE_SUBSCRIPTION_ID: "sub_test_bundle", TENANT_ID: tenantId, BUNDLE_SUBSCRIPTION_ID: subscriptionId }));
    expect(await bodyOf(replayed)).toEqual({ received: true, replayed: true });
  });

  it("mirrors Stripe payment failures and recoveries on the bundle subscription", async () => {
    await enrolAppliance();
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "cs_test_pd", url: "https://checkout.stripe.test/pd" }), { status: 200 }));
    const checkoutBody = envelope(appliance, { bundleId: BUNDLE });
    const subscriptionId = (await bodyOf(await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", checkoutBody, { idempotencyKey: checkoutBody.idempotencyKey as string })))).subscriptionId as string;
    expect((await deliverWebhook(stripeFixture("checkout.session.completed", { STRIPE_CHECKOUT_SESSION_ID: "cs_test_pd", STRIPE_SUBSCRIPTION_ID: "sub_test_pd", TENANT_ID: tenantId, BUNDLE_SUBSCRIPTION_ID: subscriptionId }))).status).toBe(200);
    expect((await deliverWebhook(stripeFixture("invoice.payment_failed", { STRIPE_SUBSCRIPTION_ID: "sub_test_pd" }))).status).toBe(200);
    let poll = await bodyOf(await storeSubscriptions(signedRequest(appliance, "GET", `/api/company-os/v1/store/subscriptions?subscriptionId=${subscriptionId}`)));
    expect(poll.subscription).toMatchObject({ subscriptionState: "past_due" });
    // past due: no new installation of the bundle
    const refused = await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", envelope(appliance, { bundleId: BUNDLE, faivrAgentModelId: MODEL_ID })));
    expect(refused.status).toBe(409);
    expect((await deliverWebhook(stripeFixture("customer.subscription.updated.active", { STRIPE_SUBSCRIPTION_ID: "sub_test_pd", TENANT_ID: tenantId, BUNDLE_SUBSCRIPTION_ID: subscriptionId }))).status).toBe(200);
    poll = await bodyOf(await storeSubscriptions(signedRequest(appliance, "GET", `/api/company-os/v1/store/subscriptions?subscriptionId=${subscriptionId}`)));
    expect(poll.subscription).toMatchObject({ subscriptionState: "active" });
    // an unsigned or badly signed webhook never reaches the store
    const forged = await stripeWebhook(new NextRequest("https://store.faivr.test/api/company-os/stripe/webhook", { method: "POST", headers: { "stripe-signature": "t=1,v1=00" }, body: stripeFixture("invoice.payment_failed", { STRIPE_SUBSCRIPTION_ID: "sub_test_pd" }) }));
    expect(forged.status).toBe(401);
  });

  it("cancels a subscribed bundle nothing is installed from, and refuses a checkout without a Stripe price", async () => {
    await enrolAppliance();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "cs_test_c", url: "https://checkout.stripe.test/c" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "sub_test_c", cancel_at_period_end: true, current_period_end: 1_800_000_000 }), { status: 200 }));
    const checkoutBody = envelope(appliance, { bundleId: BUNDLE });
    const subscriptionId = (await bodyOf(await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", checkoutBody, { idempotencyKey: checkoutBody.idempotencyKey as string })))).subscriptionId as string;
    await deliverWebhook(stripeFixture("checkout.session.completed", { STRIPE_CHECKOUT_SESSION_ID: "cs_test_c", STRIPE_SUBSCRIPTION_ID: "sub_test_c", TENANT_ID: tenantId, BUNDLE_SUBSCRIPTION_ID: subscriptionId }));
    const cancelBody = envelope(appliance, { subscriptionId });
    const cancelled = await storeSubscriptionCancel(signedRequest(appliance, "POST", "/api/company-os/v1/store/subscriptions/cancel", cancelBody, { idempotencyKey: cancelBody.idempotencyKey as string }));
    const cancelledBody = await bodyOf(cancelled);
    expect(cancelled.status, JSON.stringify(cancelledBody)).toBe(200);
    expect(cancelledBody).toMatchObject({ subscriptionId, bundleId: BUNDLE, subscriptionState: "cancel_at_period_end" });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/v1/subscriptions/sub_test_c");
    // another tenant's appliance sees nothing of it
    const other = { tenantId: randomUUID(), instanceId: randomUUID(), keyId: "", keys: ed25519Pair() };
    other.keyId = keyIdFor(loadEd25519PublicKey(other.keys.publicPem));
    await holder.pool.query("INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key) VALUES($1,$2,$3,$4)", [other.tenantId, other.instanceId, other.keyId, other.keys.publicPem]);
    const foreign = await bodyOf(await storeSubscriptions(signedRequest(other, "GET", `/api/company-os/v1/store/subscriptions?subscriptionId=${subscriptionId}`)));
    expect(foreign.error).toBe("subscription_not_found");
    // a bundle without a price is listed but not subscribable
    await upsertBundle({ id: "unpriced", name: "Unpriced", description: "no Stripe price yet", stripePriceId: null, monthlyPriceCents: 0 });
    const unpriced = await storeCheckoutSessions(signedRequest(appliance, "POST", "/api/company-os/v1/store/checkout-sessions", envelope(appliance, { bundleId: "unpriced" })));
    expect(unpriced.status).toBe(503);
    expect((await bodyOf(unpriced)).error).toBe("stripe_price_not_configured");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function signReceipt(message: Record<string, unknown>, privatePem: string): string {
  // the appliance's embedded receipt signature: RFC 8785 of the object without `signature`
  return edSign(null, Buffer.from(canonicalSignedMessage({ ...message, signature: undefined })), createPrivateKey(privatePem)).toString("base64url");
}
