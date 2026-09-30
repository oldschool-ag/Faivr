import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPgPool } from "@/lib/postgres";
import { confirmBillingStoppedByStripe, markEntitled } from "@/lib/companyOs/store";
import { billingProvider, BillingWebhookPayloadError, BillingWebhookSignatureError } from "@/lib/companyOs/billing";
import { applyBillingEvent } from "@/lib/companyOs/billing/events";

/**
 * Stripe's webhook endpoint: the second billing provider of the store (T6b.1; the T6b
 * behaviour, unchanged). Events are verified with the webhook secret, deduplicated by event
 * id, and applied inside one transaction through the provider-neutral state machine:
 *
 * - checkout.session.completed: a function-bundle checkout (metadata.bundle_subscription_id)
 *   activates the bundle subscription; a legacy per-installation checkout entitles the
 *   installation.
 * - customer.subscription.deleted, or updated with status canceled: billing stopped.
 * - customer.subscription.updated with status past_due / unpaid: the bundle is past due;
 *   back to active when Stripe reports active again.
 * - invoice.payment_failed: the bundle subscription is past due.
 */
export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  let provider;
  try {
    provider = billingProvider("stripe");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "billing_provider_not_configured" }, { status: 503 });
  }
  const body = await req.text();
  let event;
  try {
    event = await provider.parseWebhook({ body, headers: req.headers });
  } catch (error) {
    if (error instanceof BillingWebhookSignatureError) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    if (error instanceof BillingWebhookPayloadError) return NextResponse.json({ error: error.message.includes("json") ? "Invalid JSON" : "Invalid event" }, { status: 400 });
    throw error;
  }
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query("INSERT INTO company_os_webhook_events(provider,event_id,payload) VALUES('stripe',$1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING event_id", [event.eventId, body]);
    if (!inserted.rowCount) {
      await client.query("COMMIT");
      return NextResponse.json({ received: true, replayed: true });
    }
    if (event.kind === "checkout_completed" && event.legacyInstallationId) {
      // the legacy per-installation checkout of the V1 marketplace
      if (!event.tenantId || !event.providerCheckoutId || !event.providerSubscriptionId || !(await markEntitled(event.legacyInstallationId, event.tenantId, event.providerCheckoutId, event.providerSubscriptionId, client))) throw new Error("checkout_scope_mismatch");
    } else if (event.kind === "checkout_completed") {
      if (!event.subscriptionId || !event.tenantId) throw new Error("checkout_scope_mismatch");
      const applied = await applyBillingEvent(event, client);
      if (!applied.applied) throw new Error("checkout_scope_mismatch");
    } else if (event.kind === "subscription_ended" && event.providerSubscriptionId) {
      const bundle = await applyBillingEvent(event, client);
      const installation = await confirmBillingStoppedByStripe(event.providerSubscriptionId, event.periodEnd ?? new Date().toISOString(), client);
      if (!bundle.applied && !installation) throw new Error("subscription_scope_mismatch");
    } else {
      await applyBillingEvent(event, client);
    }
    await client.query("COMMIT");
    return NextResponse.json({ received: true });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: error instanceof Error ? error.message : "webhook_failed" }, { status: 409 });
  } finally {
    client.release();
  }
}
