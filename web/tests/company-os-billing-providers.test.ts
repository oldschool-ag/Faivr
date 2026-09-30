import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { billingProvider, billingProviderName, billingStartupLine, BillingWebhookSignatureError, missingBillingConfiguration, type BillingBundle, type BillingProvider } from "@/lib/companyOs/billing";
import { POLAR_API_VERSION } from "@/lib/companyOs/billing/config";
import { POLAR_METADATA_KEYS, polarEventView, polarSubscriptionState } from "@/lib/companyOs/billing/polar";
import { stripeSubscriptionState } from "@/lib/companyOs/billing/stripe";
import { POLAR_TEST_SECRET, polarFixture, signPolarWebhook, stripeApiFixture } from "./helpers/polarWebhook";

/**
 * The billing-provider contract (T6b.1): the same five operations, run against both
 * implementations with recorded provider answers. What each provider is asked for is pinned
 * against its API reference (Polar: OpenAPI 2026-10; Stripe: the T6b requests, unchanged).
 */

const IDS = {
  tenant: "11111111-1111-4111-8111-111111111111",
  instance: "22222222-2222-4222-8222-222222222222",
  subscription: "44444444-4444-4444-8444-444444444444",
  polarProduct: "55555555-5555-4555-8555-555555555555",
  polarCheckout: "66666666-6666-4666-8666-666666666666",
  polarSubscription: "77777777-7777-4777-8777-777777777777",
  polarCustomer: "88888888-8888-4888-8888-888888888888",
  polarOrganization: "99999999-9999-4999-8999-999999999999",
};
const PERIOD_END = "2026-10-30T12:00:00.000000Z";
const BUNDLE: BillingBundle = { id: "design-review", name: "Design review", polarProductId: IDS.polarProduct, stripePriceId: "price_TESTdesignreview", monthlyPriceCents: 4900, currency: "chf" };
const POLAR_VALUES = { POLAR_SUBSCRIPTION_ID: IDS.polarSubscription, POLAR_CHECKOUT_ID: IDS.polarCheckout, POLAR_CUSTOMER_ID: IDS.polarCustomer, POLAR_PRODUCT_ID: IDS.polarProduct, POLAR_ORGANIZATION_ID: IDS.polarOrganization, FAIVR_SUBSCRIPTION_ID: IDS.subscription, TENANT_ID: IDS.tenant, INSTANCE_ID: IDS.instance, BUNDLE_ID: BUNDLE.id, PERIOD_END, POLAR_ORDER_ID: randomUUID(), BILLING_REASON: "subscription_create" };
const STRIPE_VALUES = { STRIPE_CHECKOUT_SESSION_ID: "cs_test_contract", STRIPE_SUBSCRIPTION_ID: "sub_test_contract", STRIPE_CUSTOMER_ID: "cus_test_contract", FAIVR_SUBSCRIPTION_ID: IDS.subscription, TENANT_ID: IDS.tenant };

type Recorded = { url: string; init: RequestInit };

function jsonResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

const ENV_KEYS = ["FAIVR_BILLING_PROVIDER", "POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_ENVIRONMENT", "POLAR_ORGANIZATION_ID", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "FAIVR_STRIPE_API_ORIGIN"];

function configure(name: "polar" | "stripe") {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.FAIVR_BILLING_PROVIDER = name;
  if (name === "polar") {
    process.env.POLAR_ACCESS_TOKEN = "polar_oat_TESTtoken";
    process.env.POLAR_WEBHOOK_SECRET = POLAR_TEST_SECRET;
    process.env.POLAR_ENVIRONMENT = "sandbox";
    process.env.POLAR_ORGANIZATION_ID = IDS.polarOrganization;
  } else {
    process.env.STRIPE_SECRET_KEY = "sk_test_local";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_local";
  }
}

type Scenario = {
  name: "polar" | "stripe";
  checkoutAnswer: () => Response;
  subscriptionAnswer: () => Response;
  cancelAnswers: () => Response[];
  portalAnswer: () => Response;
  webhook: () => { body: string; headers: Record<string, string> };
  expectedCheckoutId: string;
  expectedSubscriptionId: string;
  expectedCustomerId: string;
};

const stripeWebhookSecret = "whsec_test_local";
function stripeSignedFixture(): { body: string; headers: Record<string, string> } {
  const body = readFileSync(new URL("./fixtures/stripe/checkout.session.completed.json", import.meta.url), "utf8")
    .replaceAll("{{STRIPE_CHECKOUT_SESSION_ID}}", "cs_test_contract")
    .replaceAll("{{STRIPE_SUBSCRIPTION_ID}}", "sub_test_contract")
    .replaceAll("{{TENANT_ID}}", IDS.tenant)
    .replaceAll("{{BUNDLE_SUBSCRIPTION_ID}}", IDS.subscription);
  const timestamp = Math.floor(Date.now() / 1000);
  const { createHmac } = require("node:crypto") as typeof import("node:crypto");
  return { body, headers: { "stripe-signature": `t=${timestamp},v1=${createHmac("sha256", stripeWebhookSecret).update(`${timestamp}.${body}`).digest("hex")}` } };
}

const SCENARIOS: Scenario[] = [
  {
    name: "polar",
    checkoutAnswer: () => jsonResponse(polarFixture("api/checkout.created", POLAR_VALUES), 201),
    subscriptionAnswer: () => jsonResponse(polarFixture("api/subscription.active", POLAR_VALUES)),
    cancelAnswers: () => [jsonResponse(polarFixture("api/subscription.active", POLAR_VALUES)), jsonResponse(polarFixture("api/subscription.cancel_at_period_end", POLAR_VALUES))],
    portalAnswer: () => jsonResponse(polarFixture("api/customer-session", POLAR_VALUES), 201),
    webhook: () => {
      const body = polarFixture("webhooks/subscription.active", POLAR_VALUES);
      return { body, headers: signPolarWebhook(body) };
    },
    expectedCheckoutId: IDS.polarCheckout,
    expectedSubscriptionId: IDS.polarSubscription,
    expectedCustomerId: IDS.polarCustomer,
  },
  {
    name: "stripe",
    checkoutAnswer: () => jsonResponse(stripeApiFixture("checkout.session", STRIPE_VALUES)),
    subscriptionAnswer: () => jsonResponse(stripeApiFixture("subscription.active", STRIPE_VALUES)),
    cancelAnswers: () => [jsonResponse(stripeApiFixture("subscription.cancel_at_period_end", STRIPE_VALUES))],
    portalAnswer: () => jsonResponse(stripeApiFixture("billing_portal.session", STRIPE_VALUES)),
    webhook: stripeSignedFixture,
    expectedCheckoutId: "cs_test_contract",
    expectedSubscriptionId: "sub_test_contract",
    expectedCustomerId: "cus_test_contract",
  },
];

describe.each(SCENARIOS)("billing provider contract: $name", (scenario) => {
  let provider: BillingProvider;
  let calls: Recorded[];
  let answers: Response[];

  beforeEach(() => {
    configure(scenario.name);
    calls = [];
    answers = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const next = answers.shift();
      if (!next) throw new Error(`unexpected provider request ${init.method ?? "GET"} ${String(url)}`);
      return next;
    }));
    provider = billingProvider();
    expect(provider.name).toBe(scenario.name);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("creates one checkout for one bundle and one appliance and returns the URL for the browser", async () => {
    answers.push(scenario.checkoutAnswer());
    const created = await provider.createCheckout({ bundle: BUNDLE, subscriptionId: IDS.subscription, tenantId: IDS.tenant, instanceId: IDS.instance, ownerAccountId: IDS.tenant, ownerEmail: "owner@example.test", successUrl: "https://store.faivr.test/store/checkout/success", cancelUrl: "https://store.faivr.test/store/checkout/cancel" });
    expect(created.checkoutId).toBe(scenario.expectedCheckoutId);
    expect(created.url).toMatch(/^https:\/\//);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    const headers = call.init.headers as Record<string, string>;
    if (scenario.name === "polar") {
      expect(call.url).toBe("https://sandbox-api.polar.sh/v1/checkouts/");
      expect(call.init.method).toBe("POST");
      expect(headers["Polar-Version"]).toBe(POLAR_API_VERSION);
      expect(headers.Authorization).toBe("Bearer polar_oat_TESTtoken");
      expect(headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
      expect(body).toEqual({
        products: [IDS.polarProduct],
        external_customer_id: IDS.tenant,
        customer_email: "owner@example.test",
        metadata: { [POLAR_METADATA_KEYS.subscriptionId]: IDS.subscription, [POLAR_METADATA_KEYS.tenantId]: IDS.tenant, [POLAR_METADATA_KEYS.instanceId]: IDS.instance, [POLAR_METADATA_KEYS.bundleId]: BUNDLE.id },
        success_url: "https://store.faivr.test/store/checkout/success",
        return_url: "https://store.faivr.test/store/checkout/cancel",
      });
      // every key within Polar's metadata limits (40-character keys, 500-character string values)
      for (const [key, value] of Object.entries(body.metadata as Record<string, string>)) {
        expect(key.length).toBeLessThanOrEqual(40);
        expect(value.length).toBeLessThanOrEqual(500);
      }
    } else {
      expect(call.url).toBe("https://api.stripe.com/v1/checkout/sessions");
      expect(headers.Authorization).toBe("Bearer sk_test_local");
      const body = String(call.init.body);
      expect(body).toContain("mode=subscription");
      expect(body).toContain("line_items%5B0%5D%5Bprice%5D=price_TESTdesignreview");
      expect(body).toContain(`metadata%5Bbundle_subscription_id%5D=${IDS.subscription}`);
      expect(body).toContain(`metadata%5Btenant_id%5D=${IDS.tenant}`);
    }
  });

  it("refuses a bundle without this provider's reference before any request", async () => {
    const unpriced = { ...BUNDLE, polarProductId: null, stripePriceId: null };
    expect(provider.productReference(unpriced)).toEqual({ error: scenario.name === "polar" ? "polar_product_not_configured" : "stripe_price_not_configured" });
    await expect(provider.createCheckout({ bundle: unpriced, subscriptionId: IDS.subscription, tenantId: IDS.tenant, instanceId: IDS.instance, ownerAccountId: IDS.tenant, ownerEmail: null, successUrl: "https://s", cancelUrl: "https://c" })).rejects.toThrow("_not_configured");
    expect(calls).toHaveLength(0);
  });

  it("reads one subscription into the store's states", async () => {
    answers.push(scenario.subscriptionAnswer());
    const view = await provider.readSubscription(scenario.expectedSubscriptionId);
    expect(view).toMatchObject({ providerSubscriptionId: scenario.expectedSubscriptionId, providerCustomerId: scenario.expectedCustomerId, state: "active", cancelAtPeriodEnd: false, endedAt: null });
    expect(view.currentPeriodEnd).toMatch(/^2026-10-30T12:00:00\.000Z$|^2027-/);
    expect(calls[0].init.method ?? "GET").toBe("GET");
    expect(calls[0].url).toContain(scenario.expectedSubscriptionId);
  });

  it("cancels at the period end, never immediately", async () => {
    answers.push(...scenario.cancelAnswers());
    const scheduled = await provider.cancelAtPeriodEnd(scenario.expectedSubscriptionId, "cancel-1");
    if (scenario.name === "polar") {
      expect(scheduled.effectiveAt).toBe(new Date(PERIOD_END).toISOString());
      expect(calls.map((c) => c.init.method ?? "GET")).toEqual(["GET", "PATCH"]);
      expect(calls[1].url).toBe(`https://sandbox-api.polar.sh/v1/subscriptions/${IDS.polarSubscription}`);
      expect(JSON.parse(String(calls[1].init.body))).toEqual({ cancel_at_period_end: true });
    } else {
      expect(scheduled.effectiveAt).toBe(new Date(1_800_000_000 * 1000).toISOString());
      expect(calls[0].url).toBe("https://api.stripe.com/v1/subscriptions/sub_test_contract");
      expect(String(calls[0].init.body)).toBe("cancel_at_period_end=true");
      expect((calls[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("cancel-1");
    }
    for (const call of calls) expect(call.init.method ?? "GET").not.toBe("DELETE");
  });

  it("verifies and parses a webhook into the provider-neutral event", async () => {
    const delivery = scenario.webhook();
    const event = await provider.parseWebhook({ body: delivery.body, headers: new Headers(delivery.headers) });
    expect(event.provider).toBe(scenario.name);
    expect(event.eventId).toBeTruthy();
    expect(event.providerSubscriptionId).toBe(scenario.expectedSubscriptionId);
    expect(event.providerCheckoutId).toBe(scenario.expectedCheckoutId);
    expect(event.subscriptionId).toBe(IDS.subscription);
    expect(event.tenantId).toBe(IDS.tenant);
    expect(event.state).toBe("active");
    expect(["subscription_active", "checkout_completed"]).toContain(event.kind);
    if (scenario.name === "polar") expect(event).toMatchObject({ instanceId: IDS.instance, bundleId: BUNDLE.id, providerCustomerId: IDS.polarCustomer, periodEnd: new Date(PERIOD_END).toISOString() });
    // a tampered body never parses
    const tampered = delivery.body.replace(IDS.subscription, randomUUID());
    await expect(provider.parseWebhook({ body: tampered, headers: new Headers(delivery.headers) })).rejects.toBeInstanceOf(BillingWebhookSignatureError);
  });

  it("builds the customer-portal link for the owner", async () => {
    answers.push(scenario.portalAnswer());
    const portal = await provider.customerPortalUrl({ ownerAccountId: IDS.tenant, providerCustomerId: scenario.name === "stripe" ? "cus_test_contract" : null, returnUrl: null });
    expect(portal?.url).toMatch(/^https:\/\//);
    if (scenario.name === "polar") {
      expect(calls[0].url).toBe("https://sandbox-api.polar.sh/v1/customer-sessions/");
      expect(JSON.parse(String(calls[0].init.body))).toEqual({ external_customer_id: IDS.tenant });
      expect(portal?.expiresAt).toBe("2026-09-30T13:30:00.000Z");
    } else {
      expect(calls[0].url).toBe("https://api.stripe.com/v1/billing_portal/sessions");
      expect(String(calls[0].init.body)).toBe("customer=cus_test_contract");
    }
  });
});

describe("Polar specifics", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("maps Polar's subscription statuses on the store's states", () => {
    expect(polarSubscriptionState("active", false, null)).toBe("active");
    expect(polarSubscriptionState("trialing", false, null)).toBe("active");
    expect(polarSubscriptionState("active", true, null)).toBe("cancel_at_period_end");
    expect(polarSubscriptionState("past_due", false, null)).toBe("past_due");
    expect(polarSubscriptionState("unpaid", false, null)).toBe("past_due");
    expect(polarSubscriptionState("paused", false, null)).toBe("past_due");
    expect(polarSubscriptionState("canceled", false, "2026-10-30T12:00:00Z")).toBe("cancelled");
    expect(polarSubscriptionState("incomplete_expired", false, null)).toBe("cancelled");
    expect(polarSubscriptionState("incomplete", false, null)).toBe("checkout_pending");
    expect(stripeSubscriptionState("active", true)).toBe("cancel_at_period_end");
    expect(stripeSubscriptionState("canceled", false)).toBe("cancelled");
  });

  it("maps Polar's events on the T6b states", () => {
    const parse = (name: string, extra: Record<string, string> = {}) => {
      const payload = JSON.parse(polarFixture(`webhooks/${name}`, { ...POLAR_VALUES, ...extra })) as { type: string; data: Record<string, unknown> };
      return polarEventView("msg_1", payload.type, payload.data);
    };
    const periodEnd = new Date(PERIOD_END).toISOString();
    expect(parse("subscription.active")).toMatchObject({ kind: "subscription_active", state: "active", providerSubscriptionId: IDS.polarSubscription, providerCheckoutId: IDS.polarCheckout, subscriptionId: IDS.subscription, tenantId: IDS.tenant, instanceId: IDS.instance, bundleId: BUNDLE.id });
    expect(parse("order.paid")).toMatchObject({ kind: "subscription_active", state: "active", providerSubscriptionId: IDS.polarSubscription, providerCheckoutId: IDS.polarCheckout, providerCustomerId: IDS.polarCustomer, subscriptionId: IDS.subscription });
    expect(parse("subscription.canceled")).toMatchObject({ kind: "subscription_cancel_scheduled", state: "cancel_at_period_end", periodEnd });
    expect(parse("subscription.canceled.immediate")).toMatchObject({ kind: "subscription_ended", state: "cancelled", periodEnd: "2026-10-02T09:00:00.000Z" });
    expect(parse("subscription.revoked")).toMatchObject({ kind: "subscription_ended", state: "cancelled", periodEnd });
    expect(parse("subscription.uncanceled")).toMatchObject({ kind: "subscription_uncancelled", state: "active" });
    expect(parse("subscription.past_due")).toMatchObject({ kind: "subscription_past_due", state: "past_due" });
    expect(parse("subscription.updated.active")).toMatchObject({ kind: "subscription_refresh", state: "active", periodEnd });
    expect(parse("subscription.updated.canceled")).toMatchObject({ kind: "subscription_refresh", state: "cancel_at_period_end", periodEnd });
    expect(parse("subscription.updated.past_due")).toMatchObject({ kind: "subscription_refresh", state: "past_due" });
    expect(parse("subscription.created")).toMatchObject({ kind: "subscription_refresh", state: "checkout_pending" });
    expect(parse("benefit_grant.created")).toMatchObject({ kind: "ignored" });
  });

  it("verifies both the Standard Webhooks key and the earlier Polar HMAC key, and refuses the rest", async () => {
    configure("polar");
    const provider = billingProvider();
    const body = polarFixture("webhooks/subscription.active", POLAR_VALUES);
    for (const form of ["standard", "hmac"] as const) {
      const event = await provider.parseWebhook({ body, headers: new Headers(signPolarWebhook(body, { form })) });
      expect(event.kind).toBe("subscription_active");
    }
    await expect(provider.parseWebhook({ body, headers: new Headers(signPolarWebhook(body, { secret: "whsec_c29tZW9uZSBlbHNlJ3Mgc2VjcmV0IGtleQ==" })) })).rejects.toBeInstanceOf(BillingWebhookSignatureError);
    await expect(provider.parseWebhook({ body, headers: new Headers(signPolarWebhook(body, { timestamp: Math.floor(Date.now() / 1000) - 600 })) })).rejects.toBeInstanceOf(BillingWebhookSignatureError);
    await expect(provider.parseWebhook({ body, headers: new Headers({ "Content-Type": "application/json" }) })).rejects.toBeInstanceOf(BillingWebhookSignatureError);
    // an unknown event type of this API version is verified and ignored, not refused
    const unknown = JSON.stringify({ type: "something.new", timestamp: "2026-09-30T12:00:00Z", api_version: "2026-10", data: {} });
    expect((await provider.parseWebhook({ body: unknown, headers: new Headers(signPolarWebhook(unknown)) })).kind).toBe("ignored");
  });

  it("returns no portal link before the owner exists at Polar", async () => {
    configure("polar");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(polarFixture("api/customer-session.not_found", {}), 404)));
    expect(await billingProvider().customerPortalUrl({ ownerAccountId: IDS.tenant, providerCustomerId: null, returnUrl: null })).toBeNull();
  });

  it("uses the production origin only when asked", () => {
    configure("polar");
    process.env.POLAR_ENVIRONMENT = "production";
    expect(billingStartupLine().line).toContain("https://api.polar.sh");
    process.env.POLAR_ENVIRONMENT = "staging";
    expect(billingStartupLine()).toMatchObject({ ok: false });
  });
});

describe("provider selection and configuration", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("defaults to Polar and knows only polar and stripe", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(billingProviderName()).toBe("polar");
    process.env.FAIVR_BILLING_PROVIDER = "Stripe";
    expect(billingProviderName()).toBe("stripe");
    process.env.FAIVR_BILLING_PROVIDER = "paddle";
    expect(() => billingProviderName()).toThrow("billing_provider_unknown:paddle");
  });

  it("refuses to run the store with a provider whose credentials are missing, naming them", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    expect(missingBillingConfiguration("polar")).toEqual(["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_ORGANIZATION_ID"]);
    expect(() => billingProvider()).toThrow("billing_provider_not_configured:polar:POLAR_ACCESS_TOKEN,POLAR_WEBHOOK_SECRET,POLAR_ORGANIZATION_ID");
    const startup = billingStartupLine();
    expect(startup.ok).toBe(false);
    expect(startup.line).toContain("billing provider polar is not configured");
    expect(startup.line).toContain("POLAR_ACCESS_TOKEN");
    process.env.FAIVR_BILLING_PROVIDER = "stripe";
    expect(() => billingProvider()).toThrow("billing_provider_not_configured:stripe:STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET");
    configure("polar");
    expect(billingStartupLine()).toEqual({ ok: true, line: `[faivr-store] billing provider polar (sandbox, API ${POLAR_API_VERSION}, https://sandbox-api.polar.sh)` });
    // Polar configured means no Stripe account is needed anywhere
    expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
    expect(billingProvider().name).toBe("polar");
  });
});
