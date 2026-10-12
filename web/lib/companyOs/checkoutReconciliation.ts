import { getPgPool } from "@/lib/postgres";
import { billingProviderFor } from "@/lib/companyOs/billing";
import { markBundleCheckoutChecked, pendingBundleCheckouts, reconcileBundleCheckout } from "@/lib/companyOs/privateStore";

export type CheckoutReconcileResult = { checked: number; activated: number; abandoned: number; pending: number; providerErrors: number };

async function within<T>(request: (signal: AbortSignal) => Promise<T>, milliseconds: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await request(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("checkout_provider_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Reconciles only aged pending checkouts in an explicit box scope, or a bounded cron batch. */
export async function reconcilePendingCheckouts(scope: { tenantId?: string; instanceId?: string; limit?: number; deadlineMs?: number }): Promise<CheckoutReconcileResult> {
  const pending = await pendingBundleCheckouts(scope);
  const result: CheckoutReconcileResult = { checked: pending.length, activated: 0, abandoned: 0, pending: 0, providerErrors: 0 };
  const deadline = Date.now() + Math.max(1_000, scope.deadlineMs ?? 45_000);
  for (const checkout of pending) {
    if (Date.now() >= deadline) break;
    try {
      const view = await within((signal) => billingProviderFor(checkout.provider).readCheckout(checkout.providerCheckoutId, { signal }), Math.min(5_000, Math.max(1_000, deadline - Date.now())));
      if (view.state === "pending") {
        result.pending++;
        await markBundleCheckoutChecked(checkout);
        continue;
      }
      const client = await getPgPool().connect();
      try {
        await client.query("BEGIN");
        const changed = view.state === "active"
          ? await reconcileBundleCheckout({ ...checkout, state: "active", providerSubscriptionId: view.providerSubscriptionId, providerCustomerId: view.providerCustomerId, cancelAtPeriodEnd: view.cancelAtPeriodEnd, cancelEffectiveAt: view.cancelEffectiveAt }, client)
          : await reconcileBundleCheckout({ ...checkout, state: "abandoned", providerCustomerId: view.providerCustomerId }, client);
        await client.query("COMMIT");
        if (changed) {
          if (view.state === "active") result.activated++;
          else result.abandoned++;
          console.info(`[faivr-store] checkout_reconciled subscription=${checkout.id} box=${checkout.instanceId} outcome=${view.state}`);
        }
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch {
      result.providerErrors++;
      await markBundleCheckoutChecked(checkout);
      console.error(`[faivr-store] checkout_reconcile_failed subscription=${checkout.id} box=${checkout.instanceId}`);
    }
  }
  return result;
}
