export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export function hasOperatorAuthConfig(): boolean {
  return Boolean(
    process.env.OPERATOR_AUTH_USERNAME?.trim() &&
      process.env.OPERATOR_AUTH_PASSWORD?.trim(),
  );
}

export function getRuntimeEnvReport() {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!hasOperatorAuthConfig() && !process.env.QUOTE_REQUEST_OPERATOR_KEY?.trim()) {
    errors.push("Operator auth is not configured");
  }

  if (isProductionRuntime() && !process.env.DATABASE_URL?.trim()) {
    errors.push("DATABASE_URL is required in production for durable quote-request storage");
  }

  if (!process.env.OPENAI_API_KEY?.trim()) {
    warnings.push("OPENAI_API_KEY is missing; support chat will use rule-based fallback responses");
  }

  if (process.env.QUOTE_REQUEST_OPERATOR_KEY?.trim()) {
    warnings.push("QUOTE_REQUEST_OPERATOR_KEY is a legacy fallback; prefer OPERATOR_AUTH_USERNAME and OPERATOR_AUTH_PASSWORD");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
