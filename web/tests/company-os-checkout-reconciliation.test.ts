import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as unknown as import("pg").Pool }));
vi.mock("@/lib/postgres", () => ({ getPgPool: () => holder.pool }));

import { activateBundleSubscription, catalogForAppliance, liveSubscription, pendingBundleCheckouts, reconcileBundleCheckout } from "@/lib/companyOs/privateStore";
import { createStoreDb } from "./helpers/companyOsStoreDb";

const tenantId = "11111111-1111-4111-8111-111111111111";
const firstBox = "22222222-2222-4222-8222-222222222222";
const secondBox = "33333333-3333-4333-8333-333333333333";
const bundleId = "website-care";

describe("checkout reconciliation and box scoping", () => {
  beforeEach(() => {
    holder.pool = createStoreDb().pool;
  });

  afterEach(async () => {
    await holder.pool.end();
  });

  async function pending(instanceId: string, createdAt = "2026-10-09T15:00:00.000Z") {
    const id = randomUUID();
    await holder.pool.query(
      "INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,billing_provider,provider_checkout_id,subscription_state,created_at) VALUES($1,$2,$3,$4,'polar',$5,'checkout_pending',$6)",
      [id, tenantId, instanceId, bundleId, `checkout-${id}`, createdAt],
    );
    return id;
  }

  it("keeps checkout reuse and status polling scoped to the requesting box", async () => {
    const first = await pending(firstBox);
    const second = await pending(secondBox);
    expect((await liveSubscription(tenantId, firstBox, bundleId))?.id).toBe(first);
    expect((await liveSubscription(tenantId, secondBox, bundleId))?.id).toBe(second);
  });

  it("reconciles a paid pending checkout only for its reserved box", async () => {
    const id = await pending(firstBox, "2000-01-01T00:00:00.000Z");
    const checkout = (await pendingBundleCheckouts()).find((row) => row.id === id)!;
    expect(await reconcileBundleCheckout({ ...checkout, state: "active", providerSubscriptionId: "polar-subscription", providerCustomerId: "polar-customer" })).toBe(true);
    const row = await holder.pool.query("SELECT subscription_state,provider_subscription_id,instance_id FROM company_os_bundle_subscriptions WHERE id=$1", [id]);
    expect(row.rows[0]).toMatchObject({ subscription_state: "active", provider_subscription_id: "polar-subscription", instance_id: firstBox });
    expect(await reconcileBundleCheckout({ ...checkout, state: "active", providerSubscriptionId: "polar-subscription" })).toBe(false);
  });

  it("preserves a provider scheduled cancellation when reconciling a paid checkout", async () => {
    const id = await pending(firstBox, "2000-01-01T00:00:00.000Z");
    const checkout = (await pendingBundleCheckouts()).find((row) => row.id === id)!;
    await reconcileBundleCheckout({ ...checkout, state: "active", providerSubscriptionId: "polar-subscription", cancelAtPeriodEnd: true, cancelEffectiveAt: "2026-12-01T00:00:00.000Z" });
    const row = await holder.pool.query("SELECT subscription_state,cancel_effective_at FROM company_os_bundle_subscriptions WHERE id=$1", [id]);
    expect(row.rows[0].subscription_state).toBe("cancel_at_period_end");
    expect(new Date(row.rows[0].cancel_effective_at).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("marks an aged uncompleted checkout as abandoned for the catalog", async () => {
    const id = await pending(firstBox, "2000-01-01T00:00:00.000Z");
    const checkout = (await pendingBundleCheckouts()).find((row) => row.id === id)!;
    expect(await reconcileBundleCheckout({ ...checkout, state: "abandoned" })).toBe(true);
    const row = await holder.pool.query("SELECT subscription_state,checkout_abandoned_at FROM company_os_bundle_subscriptions WHERE id=$1", [id]);
    expect(row.rows[0].subscription_state).toBe("cancelled");
    expect(row.rows[0].checkout_abandoned_at).toBeTruthy();
    await holder.pool.query("INSERT INTO company_os_function_bundles(id,name,description,monthly_price_cents,currency,status) VALUES($1,'Website care','Care',14900,'chf','active')", [bundleId]);
    expect((await catalogForAppliance(tenantId, firstBox))[0].subscription).toMatchObject({ state: "cancelled", checkoutState: "abandoned", message: "Checkout not finished. Subscribe again" });
  });

  it("recovers only a locally abandoned checkout when a late paid webhook matches the same box", async () => {
    const id = await pending(firstBox, "2000-01-01T00:00:00.000Z");
    const checkout = (await pendingBundleCheckouts()).find((row) => row.id === id)!;
    await reconcileBundleCheckout({ ...checkout, state: "abandoned" });
    expect(await activateBundleSubscription({ provider: "polar", providerCheckoutId: checkout.providerCheckoutId, providerSubscriptionId: "late-paid", tenantId, instanceId: firstBox, subscriptionId: id })).toBe(true);
    const row = await holder.pool.query("SELECT subscription_state,checkout_abandoned_at,stopped_at FROM company_os_bundle_subscriptions WHERE id=$1", [id]);
    expect(row.rows[0]).toMatchObject({ subscription_state: "active", checkout_abandoned_at: null, stopped_at: null });
  });

  it("keeps a late paid checkout entitled when a newer retry remains unpaid", async () => {
    const oldId = await pending(firstBox, "2000-01-01T00:00:00.000Z");
    const oldCheckout = (await pendingBundleCheckouts()).find((row) => row.id === oldId)!;
    await reconcileBundleCheckout({ ...oldCheckout, state: "abandoned" });
    const retryId = await pending(firstBox, "2026-10-12T00:00:00.000Z");
    expect(await activateBundleSubscription({ provider: "polar", providerCheckoutId: oldCheckout.providerCheckoutId, providerSubscriptionId: "late-paid", tenantId, instanceId: firstBox, subscriptionId: oldId })).toBe(true);
    await holder.pool.query("INSERT INTO company_os_function_bundles(id,name,description,monthly_price_cents,currency,status) VALUES($1,'Website care','Care',14900,'chf','active')", [bundleId]);
    const subscription = (await catalogForAppliance(tenantId, firstBox))[0].subscription;
    expect(subscription).toMatchObject({ subscriptionId: oldId, state: "active" });
    expect(subscription?.subscriptionId).not.toBe(retryId);
    expect((await liveSubscription(tenantId, firstBox, bundleId))?.id).toBe(oldId);
  });

  it("does not give a second box a first box subscription in its catalog", async () => {
    const id = await pending(firstBox);
    await holder.pool.query("UPDATE company_os_bundle_subscriptions SET subscription_state='active' WHERE id=$1", [id]);
    await holder.pool.query("INSERT INTO company_os_function_bundles(id,name,description,monthly_price_cents,currency,status) VALUES($1,'Website care','Care',14900,'chf','active')", [bundleId]);
    const catalog = await catalogForAppliance(tenantId, secondBox);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].subscription).toBeNull();
  });
});
