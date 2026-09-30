import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPgPool } from "@/lib/postgres";
import { billingProvider, BillingWebhookPayloadError, BillingWebhookSignatureError } from "@/lib/companyOs/billing";
import { applyBillingEvent } from "@/lib/companyOs/billing/events";

/**
 * Polar's webhook endpoint of the private store (T6b.1).
 *
 * - the signature is verified with the SDK helper (Polar HMAC and Standard Webhooks keys alike);
 *   a bad signature answers 403, an unreadable payload 400, a verified event 202
 * - idempotent on redelivery: the `webhook-id` of every verified event is recorded
 *   (company_os_webhook_events, provider `polar`); a redelivered id changes nothing
 * - the event is mapped to the T6b states inside one transaction (lib/companyOs/billing/events.ts);
 *   an event about a subscription the store does not know is recorded and answered 202, so
 *   Polar never retries it or disables the endpoint over it
 *
 * The appliance never talks to Polar: it polls the lifecycle API exactly as in T6b.
 */
export async function POST(req: NextRequest) {
  let provider;
  try {
    provider = billingProvider("polar");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "billing_provider_not_configured" }, { status: 503 });
  }
  const body = await req.text();
  let event;
  try {
    event = await provider.parseWebhook({ body, headers: req.headers });
  } catch (error) {
    if (error instanceof BillingWebhookSignatureError) return NextResponse.json({ error: "invalid_signature" }, { status: 403 });
    if (error instanceof BillingWebhookPayloadError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  const pool = getPgPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query("INSERT INTO company_os_webhook_events(provider,event_id,payload) VALUES('polar',$1,$2::jsonb) ON CONFLICT DO NOTHING RETURNING event_id", [event.eventId, body]);
    if (!inserted.rowCount) {
      await client.query("COMMIT");
      return NextResponse.json({ received: true, replayed: true }, { status: 202 });
    }
    const applied = await applyBillingEvent(event, client);
    await client.query("COMMIT");
    return NextResponse.json({ received: true, type: event.type, ...applied }, { status: 202 });
  } catch (error) {
    await client.query("ROLLBACK");
    // a store-side failure: not recorded, so Polar's retry gets another chance
    return NextResponse.json({ error: error instanceof Error ? error.message : "webhook_failed" }, { status: 500 });
  } finally {
    client.release();
  }
}
