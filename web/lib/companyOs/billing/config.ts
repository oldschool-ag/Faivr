import { BILLING_PROVIDER_NAMES, type BillingProviderName } from "./provider";

/**
 * Provider selection and configuration (T6b.1).
 *
 * `FAIVR_BILLING_PROVIDER` is `polar` (default) or `stripe`. The store refuses to run with a
 * provider whose credentials are missing: `requireBillingConfiguration` throws
 * `billing_provider_not_configured:<provider>:<missing variables>` (the store routes answer
 * 503 with it) and `logBillingProviderStartup` writes one clear line at server start.
 */

export const POLAR_ENVIRONMENTS = ["sandbox", "production"] as const;
export type PolarEnvironment = (typeof POLAR_ENVIRONMENTS)[number];

/** The Polar API version this integration is pinned to (requests and webhook endpoints alike). */
export const POLAR_API_VERSION = "2026-10";

export const POLAR_API_ORIGINS: Record<PolarEnvironment, string> = {
  sandbox: "https://sandbox-api.polar.sh",
  production: "https://api.polar.sh",
};

export type PolarConfig = {
  accessToken: string;
  webhookSecret: string;
  environment: PolarEnvironment;
  organizationId: string;
  apiOrigin: string;
};

export type StripeConfig = {
  secretKey: string;
  webhookSecret: string;
};

export function billingProviderName(env: NodeJS.ProcessEnv = process.env): BillingProviderName {
  const configured = env.FAIVR_BILLING_PROVIDER?.trim().toLowerCase() || "polar";
  if (!(BILLING_PROVIDER_NAMES as readonly string[]).includes(configured)) throw new Error(`billing_provider_unknown:${configured}`);
  return configured as BillingProviderName;
}

export function polarEnvironment(env: NodeJS.ProcessEnv = process.env): PolarEnvironment {
  const configured = env.POLAR_ENVIRONMENT?.trim().toLowerCase() || "sandbox";
  if (!(POLAR_ENVIRONMENTS as readonly string[]).includes(configured)) throw new Error(`polar_environment_unknown:${configured}`);
  return configured as PolarEnvironment;
}

/** The variables a provider needs; the ones that are missing are named in the refusal. */
export function missingBillingConfiguration(name: BillingProviderName, env: NodeJS.ProcessEnv = process.env): string[] {
  const required = name === "polar" ? ["POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET", "POLAR_ORGANIZATION_ID"] : ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"];
  return required.filter((variable) => !env[variable]?.trim());
}

export function requireBillingConfiguration(name: BillingProviderName, env: NodeJS.ProcessEnv = process.env): void {
  const missing = missingBillingConfiguration(name, env);
  if (missing.length) throw new Error(`billing_provider_not_configured:${name}:${missing.join(",")}`);
}

export function polarConfig(env: NodeJS.ProcessEnv = process.env): PolarConfig {
  requireBillingConfiguration("polar", env);
  const environment = polarEnvironment(env);
  return {
    accessToken: env.POLAR_ACCESS_TOKEN!.trim(),
    webhookSecret: env.POLAR_WEBHOOK_SECRET!.trim(),
    environment,
    organizationId: env.POLAR_ORGANIZATION_ID!.trim(),
    apiOrigin: POLAR_API_ORIGINS[environment],
  };
}

export function stripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  requireBillingConfiguration("stripe", env);
  return { secretKey: env.STRIPE_SECRET_KEY!.trim(), webhookSecret: env.STRIPE_WEBHOOK_SECRET!.trim() };
}

/** The one line at server start: which provider, which environment, and whether the store can run. */
export function billingStartupLine(env: NodeJS.ProcessEnv = process.env): { ok: boolean; line: string } {
  let name: BillingProviderName;
  try {
    name = billingProviderName(env);
  } catch (error) {
    return { ok: false, line: `[faivr-store] billing provider refused: ${error instanceof Error ? error.message : String(error)}; set FAIVR_BILLING_PROVIDER to polar or stripe` };
  }
  const missing = missingBillingConfiguration(name, env);
  if (missing.length) return { ok: false, line: `[faivr-store] billing provider ${name} is not configured: ${missing.join(", ")} missing; the store routes answer 503 until they are set` };
  if (name === "polar") {
    try {
      const environment = polarEnvironment(env);
      return { ok: true, line: `[faivr-store] billing provider polar (${environment}, API ${POLAR_API_VERSION}, ${POLAR_API_ORIGINS[environment]})` };
    } catch (error) {
      return { ok: false, line: `[faivr-store] billing provider polar refused: ${error instanceof Error ? error.message : String(error)}; set POLAR_ENVIRONMENT to sandbox or production` };
    }
  }
  return { ok: true, line: "[faivr-store] billing provider stripe" };
}

export function logBillingProviderStartup(env: NodeJS.ProcessEnv = process.env, log: (line: string) => void = console.error): boolean {
  const result = billingStartupLine(env);
  log(result.line);
  return result.ok;
}
