import { billingProviderName, requireBillingConfiguration } from "./config";
import { PolarBillingProvider } from "./polar";
import type { BillingProvider, BillingProviderName } from "./provider";
import { StripeBillingProvider } from "./stripe";

export * from "./provider";
export { billingProviderName, billingStartupLine, logBillingProviderStartup, missingBillingConfiguration, POLAR_API_VERSION, requireBillingConfiguration } from "./config";

/**
 * The configured billing provider (T6b.1): `FAIVR_BILLING_PROVIDER`, `polar` by default.
 * Throws `billing_provider_not_configured:<provider>:<missing>` when its credentials are
 * missing; the store routes turn that into 503 and the server logs it at start.
 */
export function billingProvider(name: BillingProviderName = billingProviderName()): BillingProvider {
  requireBillingConfiguration(name);
  return name === "stripe" ? new StripeBillingProvider() : new PolarBillingProvider();
}

/** The provider of a stored subscription row: events and cancellations go to the provider that sold it. */
export function billingProviderFor(name: string | null | undefined): BillingProvider {
  if (name === "stripe" || name === "polar") return billingProvider(name);
  return billingProvider();
}
