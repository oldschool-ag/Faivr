import type { Queryable } from "../privateStore";
import { activateBundleSubscription, markBundleSubscriptionState, refreshBundleSubscription, rememberProviderCustomer } from "../privateStore";
import type { BillingEvent } from "./provider";

/**
 * One provider-neutral event on the store's state machine (T6b.1). Both webhook routes call
 * this after verifying and recording the event; the provider is only a name here.
 *
 * Returns what happened, so a route can answer the provider truthfully and a test can pin it.
 */
export type AppliedBillingEvent = { applied: boolean; action: string };

export async function applyBillingEvent(event: BillingEvent, client: Queryable): Promise<AppliedBillingEvent> {
  const provider = event.provider;
  switch (event.kind) {
    case "checkout_completed":
    case "subscription_active": {
      if (event.providerCheckoutId && event.providerSubscriptionId) {
        const activated = await activateBundleSubscription({ provider, providerCheckoutId: event.providerCheckoutId, providerSubscriptionId: event.providerSubscriptionId, providerCustomerId: event.providerCustomerId, subscriptionId: event.subscriptionId, tenantId: event.tenantId }, client);
        if (activated) return { applied: true, action: "activated" };
      }
      if (!event.providerSubscriptionId) return { applied: false, action: "no_subscription" };
      const recovered = await markBundleSubscriptionState(provider, event.providerSubscriptionId, "active", null, client);
      if (event.providerCustomerId) await rememberProviderCustomer(provider, event.providerSubscriptionId, event.providerCustomerId, client);
      return { applied: recovered, action: recovered ? "active" : "unknown_subscription" };
    }
    case "subscription_uncancelled": {
      if (!event.providerSubscriptionId) return { applied: false, action: "no_subscription" };
      const back = await markBundleSubscriptionState(provider, event.providerSubscriptionId, "uncancelled", null, client);
      return { applied: back, action: back ? "uncancelled" : "unknown_subscription" };
    }
    case "subscription_cancel_scheduled": {
      if (!event.providerSubscriptionId) return { applied: false, action: "no_subscription" };
      const scheduled = await markBundleSubscriptionState(provider, event.providerSubscriptionId, "cancel_at_period_end", event.periodEnd, client);
      return { applied: scheduled, action: scheduled ? "cancel_scheduled" : "unknown_subscription" };
    }
    case "subscription_ended": {
      if (!event.providerSubscriptionId) return { applied: false, action: "no_subscription" };
      const ended = await markBundleSubscriptionState(provider, event.providerSubscriptionId, "cancelled", event.periodEnd, client);
      return { applied: ended, action: ended ? "ended" : "unknown_subscription" };
    }
    case "subscription_past_due": {
      if (!event.providerSubscriptionId) return { applied: false, action: "no_subscription" };
      const pastDue = await markBundleSubscriptionState(provider, event.providerSubscriptionId, "past_due", null, client);
      return { applied: pastDue, action: pastDue ? "past_due" : "unknown_subscription" };
    }
    case "subscription_refresh": {
      if (!event.providerSubscriptionId) return { applied: false, action: "no_subscription" };
      const refreshed = await refreshBundleSubscription(provider, event.providerSubscriptionId, { state: event.state, periodEnd: event.periodEnd, providerCustomerId: event.providerCustomerId }, client);
      return { applied: refreshed, action: refreshed ? "refreshed" : "unknown_subscription" };
    }
    case "ignored":
    default:
      return { applied: false, action: "ignored" };
  }
}
