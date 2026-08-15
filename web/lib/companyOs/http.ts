import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getPgPool } from "@/lib/postgres";
import { sha256, verifyCompanyOsRequest, type RequestIdentity } from "./auth";

export type AuthenticatedRequest = { body: string; json: unknown; principal: RequestIdentity; bodyHash: string };

function requiredHeader(req: NextRequest, name: string): string | null {
  const value = req.headers.get(name)?.trim();
  return value && value.length <= 512 ? value : null;
}

export async function authenticatedJson(req: NextRequest): Promise<AuthenticatedRequest | NextResponse> {
  const identity: RequestIdentity = {
    tenantId: requiredHeader(req, "x-faivr-tenant-id") ?? "",
    instanceId: requiredHeader(req, "x-faivr-instance-id") ?? "",
    keyId: requiredHeader(req, "x-faivr-key-id") ?? "",
    timestamp: requiredHeader(req, "x-faivr-timestamp") ?? "",
    nonce: requiredHeader(req, "x-faivr-nonce") ?? "",
    idempotencyKey: requiredHeader(req, "idempotency-key") ?? "",
  };
  if (req.method !== "GET" && !identity.idempotencyKey)
    return NextResponse.json({ error: "Idempotency-Key is required for mutations" }, { status: 400 });
  if (!identity.tenantId || !identity.instanceId || !identity.keyId || !identity.timestamp || !identity.nonce) return NextResponse.json({ error: "Missing signed identity headers" }, { status: 400 });
  const body = await req.text();
  const pool = getPgPool();
  const key = await pool.query(
    "SELECT public_key FROM company_os_instance_keys WHERE tenant_id=$1 AND instance_id=$2 AND key_id=$3 AND revoked_at IS NULL AND not_before<=now() AND (not_after IS NULL OR not_after>now())",
    [identity.tenantId, identity.instanceId, identity.keyId],
  );
  if (!key.rowCount || !verifyCompanyOsRequest({ publicKey: key.rows[0].public_key, identity, signature: req.headers.get("x-faivr-signature"), method: req.method, exactPathAndQuery: `${req.nextUrl.pathname}${req.nextUrl.search}`, body })) {
    return NextResponse.json({ error: "Invalid Company OS signature" }, { status: 401 });
  }
  const nonce = await pool.query(
    "INSERT INTO company_os_request_nonces(tenant_id,instance_id,nonce,expires_at) VALUES($1,$2,$3,now()+interval '24 hours') ON CONFLICT DO NOTHING RETURNING nonce",
    [identity.tenantId, identity.instanceId, identity.nonce],
  );
  if (!nonce.rowCount) return NextResponse.json({ error: "Request replay rejected" }, { status: 409 });
  try { return { body, json: body ? JSON.parse(body) : {}, principal: identity, bodyHash: sha256(body) }; }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
}

export function requirePrincipalTenant(auth: AuthenticatedRequest, tenantId: unknown): NextResponse | null {
  return tenantId === auth.principal.tenantId ? null : NextResponse.json({ error: "Tenant principal mismatch" }, { status: 403 });
}
