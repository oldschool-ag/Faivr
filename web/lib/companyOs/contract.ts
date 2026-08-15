export const COMPANY_OS_V1_PREFIX = "/api/company-os/v1";
export const COMPANY_OS_V1_ENDPOINTS = [
  "GET /api/company-os/v1/catalog",
  "GET /api/company-os/v1/models/{modelId}",
  "GET /api/company-os/v1/models/{modelId}/versions/latest",
  "POST /api/company-os/v1/checkout-sessions",
  "GET /api/company-os/v1/checkout-sessions",
  "POST /api/company-os/v1/installations",
  "GET /api/company-os/v1/installations",
  "GET /api/company-os/v1/installations/{id}/package",
  "POST /api/company-os/v1/activation-receipts",
  "GET /api/company-os/v1/updates",
  "POST /api/company-os/v1/archive-receipts",
  "POST /api/company-os/v1/uninstall-requests",
  "POST /api/company-os/v1/uninstall-receipts",
  "GET /api/company-os/v1/billing",
] as const;

export const COMPANY_OS_HEADERS = {
  tenantId:"X-FAIVR-Tenant-Id", instanceId:"X-FAIVR-Instance-Id", keyId:"X-FAIVR-Key-Id",
  timestamp:"X-FAIVR-Timestamp", nonce:"X-FAIVR-Nonce", idempotencyKey:"Idempotency-Key", signature:"X-FAIVR-Signature",
} as const;
