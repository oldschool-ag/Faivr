/**
 * The billing-provider interface of the private Truchsess store (T6b.1).
 *
 * Decision of 2026-09-30: billing goes through Polar (merchant of record), Stripe stays as
 * the second implementation. Exactly the operations the T6b flow needs live here; the
 * provider-neutral subscription state machine in `../privateStore.ts` stays the single
 * source of truth, provider objects are stored only as opaque ids next to it.
 *
 * Nothing here reaches the chain, the fee module or the router (tests/company-os-frozen-boundaries).
 */

export type BillingProviderName = "polar" | "stripe";

export const BILLING_PROVIDER_NAMES: readonly BillingProviderName[] = ["polar", "stripe"];

/** The T6b subscription states a provider event can express. */
export type BillingSubscriptionState = "checkout_pending" | "active" | "past_due" | "cancel_at_period_end" | "cancelled";

export type BillingBundle = {
  id: string;
  name: string;
  /** Polar: the product id of the bundle's recurring product. */
  polarProductId: string | null;
  /** Stripe: the price id of the bundle's monthly price. */
  stripePriceId: string | null;
  monthlyPriceCents: number;
  currency: string;
};

export type CreateCheckoutInput = {
  bundle: BillingBundle;
  /** FAIVR's bundle subscription id (checkout_pending row); travels in the provider's metadata. */
  subscriptionId: string;
  tenantId: string;
  /** The appliance (instance) that asked for the checkout. */
  instanceId: string;
  /** The FAIVR account of the appliance owner: one provider customer per owner, any number of appliances. */
  ownerAccountId: string;
  ownerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutCreated = {
  /** The provider's checkout id (Polar checkout id, Stripe checkout session id). */
  checkoutId: string;
  /** Where the appliance owner is sent in the browser. */
  url: string;
};

export type ProviderSubscription = {
  providerSubscriptionId: string;
  providerCustomerId: string | null;
  state: BillingSubscriptionState;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  endedAt: string | null;
};

export type CancellationScheduled = {
  /** When the subscription ends (the current period end). */
  effectiveAt: string;
};

export type BillingEventKind =
  /** the checkout was paid and the provider subscription exists */
  | "checkout_completed"
  /** the subscription is (again) active: recovered payment, uncancelled, renewed */
  | "subscription_active"
  /** the customer or the merchant cancelled; active until the period end */
  | "subscription_cancel_scheduled"
  /** a scheduled cancellation was reverted before the period end */
  | "subscription_uncancelled"
  /** the provider ended the subscription: billing stopped */
  | "subscription_ended"
  /** a payment failed; the provider retries */
  | "subscription_past_due"
  /** a catch-all update: a refresh of the known fields, never a state source of its own */
  | "subscription_refresh"
  /** an event the store does not act on (recorded for idempotency, nothing else) */
  | "ignored";

/** The small provider-neutral event every webhook is parsed into. */
export type BillingEvent = {
  provider: BillingProviderName;
  /** The provider's event or message id; the redelivery key. */
  eventId: string;
  type: string;
  kind: BillingEventKind;
  providerSubscriptionId: string | null;
  providerCheckoutId: string | null;
  providerCustomerId: string | null;
  /** From the metadata the store set at checkout. */
  subscriptionId: string | null;
  tenantId: string | null;
  instanceId: string | null;
  bundleId: string | null;
  /** The state the event expresses, null for refresh and ignored events without one. */
  state: BillingSubscriptionState | null;
  /** The period end, cancellation date or end date the event carries. */
  periodEnd: string | null;
  /** Legacy Stripe only: a per-installation checkout of the V1 marketplace. */
  legacyInstallationId: string | null;
};

export class BillingWebhookSignatureError extends Error {
  constructor(message = "billing_webhook_signature_invalid") {
    super(message);
    this.name = "BillingWebhookSignatureError";
  }
}

export class BillingWebhookPayloadError extends Error {
  constructor(message = "billing_webhook_payload_invalid") {
    super(message);
    this.name = "BillingWebhookPayloadError";
  }
}

export class BillingProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "BillingProviderError";
  }
}

export interface BillingProvider {
  readonly name: BillingProviderName;
  /** The bundle's reference at this provider, or the `*_not_configured` error the store answers with. */
  productReference(bundle: BillingBundle): { reference: string } | { error: string };
  /** One checkout for one function bundle and one appliance. */
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutCreated>;
  /** The provider's view of one subscription. */
  readSubscription(providerSubscriptionId: string): Promise<ProviderSubscription>;
  /** Cancel at the period end; never immediately. */
  cancelAtPeriodEnd(providerSubscriptionId: string, idempotencyKey: string): Promise<CancellationScheduled>;
  /** Verify the signature and parse the payload; throws BillingWebhookSignatureError or BillingWebhookPayloadError. */
  parseWebhook(input: { body: string; headers: Headers }): Promise<BillingEvent>;
  /** A fresh, short-lived customer-portal link for the owner, or null when the provider has none for them yet. */
  customerPortalUrl(input: { ownerAccountId: string; providerCustomerId: string | null; returnUrl: string | null }): Promise<{ url: string; expiresAt: string | null } | null>;
}

export function isoOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  if (typeof value === "string" && value) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  return null;
}

export function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
