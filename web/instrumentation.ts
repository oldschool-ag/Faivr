/**
 * Next.js instrumentation: runs once when the server starts. The private store logs which
 * billing provider it runs with and refuses to run the store (its routes answer 503) when
 * that provider's credentials are missing (T6b.1). Nothing else of the site depends on it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logBillingProviderStartup } = await import("./lib/companyOs/billing/config");
    logBillingProviderStartup();
  }
}
