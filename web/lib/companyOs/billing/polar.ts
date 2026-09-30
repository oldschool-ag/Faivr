import { webhooks } from "@polar-sh/sdk/2026-10";
import { POLAR_API_VERSION, polarConfig, type PolarConfig } from "./config";
import {
  BillingProviderError,
  BillingWebhookPayloadError,
  BillingWebhookSignatureError,
  isoOrNull,
  stringOrNull,
  type BillingBundle,
  type BillingEvent,
  type BillingEventKind,
  type BillingProvider,
  type BillingSubscriptionState,
  type CancellationScheduled,
  type CheckoutCreated,
  type CreateCheckoutInput,
  type ProviderSubscription,
} from "./provider";

/**
 * Polar (polar.sh), merchant of record: the default billing provider of the private store.
 *
 * Requests go to the pinned API version (`Polar-Version: 2026-10`, the version that becomes
 * Current on 1 October 2026) at the sandbox or production origin; the webhook endpoint must
 * be created with the same `api_version`. Field names below are taken from Polar's OpenAPI
 * document for that version (docs/openapi/2026-10.openapi.json in polarsource/polar):
 *
 * - `POST /v1/checkouts/` with `products`, `external_customer_id`, `customer_email`,
 *   `metadata`, `success_url`, `return_url`; the answer's `id` and `url`.
 * - `GET /v1/subscriptions/{id}` and `PATCH /v1/subscriptions/{id}` with
 *   `{ "cancel_at_period_end": true }` (the `SubscriptionCancel` variant); `status`,
 *   `cancel_at_period_end`, `current_period_end`, `ends_at`, `ended_at`, `customer_id`,
 *   `checkout_id`, `metadata`.
 * - `POST /v1/customer-sessions/` with `external_customer_id` and `return_url`; the answer's
 *   `customer_portal_url` and `expires_at`.
 *
 * The appliance never talks to Polar; it polls the lifecycle API exactly as in T6b.
 */

/** The metadata keys the store sets on a checkout; Polar copies them to the subscription and the orders. */
export const POLAR_METADATA_KEYS = {
  subscriptionId: "faivr_subscription_id",
  tenantId: "faivr_tenant_id",
  instanceId: "faivr_instance_id",
  bundleId: "faivr_bundle_id",
} as const;

const POLAR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPolarProductId(value: unknown): value is string {
  return typeof value === "string" && POLAR_UUID.test(value);
}

type PolarRequestInit = { method?: string; body?: unknown };

export class PolarBillingProvider implements BillingProvider {
  readonly name = "polar" as const;
  private readonly config: PolarConfig;

  constructor(config?: PolarConfig) {
    this.config = config ?? polarConfig();
  }

  productReference(bundle: BillingBundle) {
    return bundle.polarProductId ? { reference: bundle.polarProductId } : { error: "polar_product_not_configured" };
  }

  private async request<T = Record<string, unknown>>(path: string, init: PolarRequestInit = {}): Promise<{ status: number; value: T }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Polar-Version": POLAR_API_VERSION,
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${this.config.apiOrigin}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const text = await response.text();
    let value: unknown = {};
    if (text) {
      try {
        value = JSON.parse(text);
      } catch {
        value = { raw: text.slice(0, 300) };
      }
    }
    if (!response.ok) {
      if (response.status === 429) throw new BillingProviderError("polar_rate_limited", 503);
      throw new BillingProviderError(`polar_provider_error:${response.status}:${polarErrorDetail(value)}`, response.status === 404 ? 404 : 502);
    }
    return { status: response.status, value: value as T };
  }

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutCreated> {
    const reference = this.productReference(input.bundle);
    if ("error" in reference) throw new Error(reference.error);
    const body: Record<string, unknown> = {
      products: [reference.reference],
      external_customer_id: input.ownerAccountId,
      metadata: {
        [POLAR_METADATA_KEYS.subscriptionId]: input.subscriptionId,
        [POLAR_METADATA_KEYS.tenantId]: input.tenantId,
        [POLAR_METADATA_KEYS.instanceId]: input.instanceId,
        [POLAR_METADATA_KEYS.bundleId]: input.bundle.id,
      },
      success_url: input.successUrl,
      return_url: input.cancelUrl,
    };
    if (input.ownerEmail) body.customer_email = input.ownerEmail;
    const { value } = await this.request("/v1/checkouts/", { method: "POST", body });
    if (typeof value.id !== "string" || typeof value.url !== "string") throw new BillingProviderError("polar_invalid_response");
    return { checkoutId: value.id, url: value.url };
  }

  async readSubscription(providerSubscriptionId: string): Promise<ProviderSubscription> {
    const { value } = await this.request(`/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`);
    return polarSubscriptionView(value);
  }

  async cancelAtPeriodEnd(providerSubscriptionId: string, idempotencyKey: string): Promise<CancellationScheduled> {
    void idempotencyKey; // Polar has no idempotency header; the flag below is idempotent by nature
    const current = await this.readSubscription(providerSubscriptionId);
    if (current.state === "cancelled") return { effectiveAt: current.endedAt ?? current.currentPeriodEnd ?? new Date().toISOString() };
    if (current.cancelAtPeriodEnd) return { effectiveAt: current.currentPeriodEnd ?? new Date().toISOString() };
    const { value } = await this.request(`/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { method: "PATCH", body: { cancel_at_period_end: true } });
    const view = polarSubscriptionView(value);
    return { effectiveAt: isoOrNull(value.ends_at) ?? view.currentPeriodEnd ?? new Date().toISOString() };
  }

  async parseWebhook(input: { body: string; headers: Headers }): Promise<BillingEvent> {
    const headers = {
      "webhook-id": input.headers.get("webhook-id") ?? "",
      "webhook-timestamp": input.headers.get("webhook-timestamp") ?? "",
      "webhook-signature": input.headers.get("webhook-signature") ?? "",
    };
    let event: { type: string; data: unknown };
    try {
      event = (await webhooks.validateEvent(input.body, headers, this.config.webhookSecret)) as { type: string; data: unknown };
    } catch (error) {
      if (error instanceof webhooks.PolarWebhookVerificationError) throw new BillingWebhookSignatureError(`polar_webhook_signature_invalid: ${error.message}`);
      if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
        // a type this API version does not know: verified, recorded, not acted on
        return ignoredEvent(headers["webhook-id"], error.eventType ?? "unknown");
      }
      throw new BillingWebhookPayloadError(`polar_webhook_payload_invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!headers["webhook-id"]) throw new BillingWebhookPayloadError("polar_webhook_id_missing");
    return polarEventView(headers["webhook-id"], event.type, (event.data ?? {}) as Record<string, unknown>);
  }

  async customerPortalUrl(input: { ownerAccountId: string; providerCustomerId: string | null; returnUrl: string | null }) {
    const body: Record<string, unknown> = input.providerCustomerId ? { customer_id: input.providerCustomerId } : { external_customer_id: input.ownerAccountId };
    if (input.returnUrl) body.return_url = input.returnUrl;
    try {
      const { value } = await this.request("/v1/customer-sessions/", { method: "POST", body });
      if (typeof value.customer_portal_url !== "string") throw new BillingProviderError("polar_invalid_response");
      return { url: value.customer_portal_url, expiresAt: isoOrNull(value.expires_at) };
    } catch (error) {
      // no customer yet at Polar (nothing bought): no portal link
      if (error instanceof BillingProviderError && (error.status === 404 || error.message.includes(":422:"))) return null;
      throw error;
    }
  }
}

function polarErrorDetail(value: unknown): string {
  if (typeof value !== "object" || value === null) return "error";
  const record = value as Record<string, unknown>;
  if (typeof record.detail === "string") return record.detail.slice(0, 200);
  if (typeof record.error === "string") return record.error.slice(0, 200);
  if (Array.isArray(record.detail)) return record.detail.map((item) => (typeof item === "object" && item && "msg" in item ? String((item as { msg: unknown }).msg) : JSON.stringify(item))).join("; ").slice(0, 200);
  return "error";
}

/** Polar's `SubscriptionStatus` on the store's states. */
export function polarSubscriptionState(status: unknown, cancelAtPeriodEnd: unknown, endedAt: unknown): BillingSubscriptionState {
  switch (status) {
    case "active":
    case "trialing":
      return cancelAtPeriodEnd === true ? "cancel_at_period_end" : "active";
    case "past_due":
    case "unpaid":
    case "paused":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    case "incomplete":
      return "checkout_pending";
    default:
      return endedAt ? "cancelled" : "active";
  }
}

export function polarSubscriptionView(value: Record<string, unknown>): ProviderSubscription {
  if (typeof value.id !== "string") throw new BillingProviderError("polar_invalid_response");
  return {
    providerSubscriptionId: value.id,
    providerCustomerId: stringOrNull(value.customer_id),
    state: polarSubscriptionState(value.status, value.cancel_at_period_end, value.ended_at),
    currentPeriodEnd: isoOrNull(value.current_period_end),
    cancelAtPeriodEnd: value.cancel_at_period_end === true,
    endedAt: isoOrNull(value.ended_at),
  };
}

function ignoredEvent(eventId: string, type: string): BillingEvent {
  return { provider: "polar", eventId, type, kind: "ignored", providerSubscriptionId: null, providerCheckoutId: null, providerCustomerId: null, subscriptionId: null, tenantId: null, instanceId: null, bundleId: null, state: null, periodEnd: null, legacyInstallationId: null };
}

function metadataOf(data: Record<string, unknown>) {
  const metadata = (typeof data.metadata === "object" && data.metadata ? data.metadata : {}) as Record<string, unknown>;
  return {
    subscriptionId: stringOrNull(metadata[POLAR_METADATA_KEYS.subscriptionId]),
    tenantId: stringOrNull(metadata[POLAR_METADATA_KEYS.tenantId]),
    instanceId: stringOrNull(metadata[POLAR_METADATA_KEYS.instanceId]),
    bundleId: stringOrNull(metadata[POLAR_METADATA_KEYS.bundleId]),
  };
}

/**
 * Polar's events on the T6b states:
 * - subscription.active, order.paid (of a subscription): active
 * - subscription.canceled: active until the period end with the cancellation recorded; an
 *   immediate revocation (status canceled, ended_at set) ends it
 * - subscription.revoked: ended
 * - subscription.uncanceled: back to active
 * - subscription.past_due: past due
 * - subscription.updated, subscription.created, subscription.cycled: a refresh of the known
 *   fields, never a state source of their own
 */
export function polarEventView(eventId: string, type: string, data: Record<string, unknown>): BillingEvent {
  const base = { provider: "polar" as const, eventId, type, legacyInstallationId: null };
  if (type === "order.paid") {
    const providerSubscriptionId = stringOrNull(data.subscription_id);
    if (!providerSubscriptionId) return { ...ignoredEvent(eventId, type) };
    return { ...base, kind: "subscription_active", providerSubscriptionId, providerCheckoutId: stringOrNull(data.checkout_id), providerCustomerId: stringOrNull(data.customer_id), ...metadataOf(data), state: "active", periodEnd: null };
  }
  if (!type.startsWith("subscription.")) return ignoredEvent(eventId, type);
  const view = typeof data.id === "string" ? polarSubscriptionView(data) : null;
  if (!view) throw new BillingWebhookPayloadError("polar_webhook_subscription_missing");
  const common = { ...base, providerSubscriptionId: view.providerSubscriptionId, providerCheckoutId: stringOrNull(data.checkout_id), providerCustomerId: view.providerCustomerId, ...metadataOf(data) };
  const endsAt = isoOrNull(data.ends_at) ?? view.currentPeriodEnd;
  let kind: BillingEventKind;
  let state: BillingSubscriptionState | null = view.state;
  let periodEnd: string | null = view.currentPeriodEnd;
  switch (type) {
    case "subscription.active":
      kind = "subscription_active";
      state = "active";
      break;
    case "subscription.canceled":
      if (view.state === "cancelled") {
        kind = "subscription_ended";
        periodEnd = view.endedAt ?? new Date().toISOString();
      } else {
        kind = "subscription_cancel_scheduled";
        state = "cancel_at_period_end";
        periodEnd = endsAt;
      }
      break;
    case "subscription.revoked":
      kind = "subscription_ended";
      state = "cancelled";
      periodEnd = view.endedAt ?? endsAt ?? new Date().toISOString();
      break;
    case "subscription.uncanceled":
      kind = "subscription_uncancelled";
      state = "active";
      break;
    case "subscription.past_due":
      kind = "subscription_past_due";
      state = "past_due";
      break;
    case "subscription.updated":
    case "subscription.created":
    case "subscription.cycled":
      kind = "subscription_refresh";
      periodEnd = view.state === "cancel_at_period_end" ? endsAt : view.currentPeriodEnd;
      break;
    default:
      return { ...common, kind: "ignored", state: null, periodEnd: null };
  }
  return { ...common, kind, state, periodEnd };
}
