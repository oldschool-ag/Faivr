import "server-only";
import { randomUUID } from "node:crypto";
import { getPgPool } from "@/lib/postgres";
import type { PoolClient } from "pg";
import type { UninstallReceipt } from "./schemas";

export class IdempotencyConflict extends Error {}
export class IdempotencyInProgress extends Error {}

export async function idempotent<T>(
  tenantId: string,
  key: string,
  operation: string,
  bodyHash: string,
  fn: () => Promise<T>,
): Promise<T> {
  const pool = getPgPool();
  const reserved = await pool.query(
    "INSERT INTO company_os_idempotency(tenant_id,idempotency_key,operation,request_hash,status,expires_at) VALUES($1,$2,$3,$4,'processing',now()+interval '30 days') ON CONFLICT DO NOTHING RETURNING idempotency_key",
    [tenantId, key, operation, bodyHash],
  );
  if (!reserved.rowCount) {
    const prior = await pool.query(
      "SELECT request_hash,status,response_body FROM company_os_idempotency WHERE tenant_id=$1 AND idempotency_key=$2 AND operation=$3",
      [tenantId, key, operation],
    );
    const row = prior.rows[0];
    if (!row || row.request_hash !== bodyHash)
      throw new IdempotencyConflict(
        "idempotency_key_reused_with_different_body",
      );
    if (row.status === "completed") return row.response_body as T;
    throw new IdempotencyInProgress("idempotency_request_in_progress");
  }
  try {
    const value = await fn();
    await pool.query(
      "UPDATE company_os_idempotency SET status='completed',response_body=$4,completed_at=now() WHERE tenant_id=$1 AND idempotency_key=$2 AND operation=$3",
      [tenantId, key, operation, JSON.stringify(value)],
    );
    return value;
  } catch (error) {
    await pool.query(
      "DELETE FROM company_os_idempotency WHERE tenant_id=$1 AND idempotency_key=$2 AND operation=$3 AND status='processing'",
      [tenantId, key, operation],
    );
    throw error;
  }
}

export async function selectPackage(
  tenantId: string,
  modelId: string,
  versionId?: string,
) {
  const pool = getPgPool();
  const found = await pool.query(
    "SELECT p.id AS faivr_agent_model_id,v.id AS faivr_package_version_id,v.version,v.monthly_price_cents,v.stripe_price_id,v.artifact_sha256 FROM company_os_packages p JOIN company_os_package_versions v ON v.package_id=p.id WHERE p.id=$1 AND v.status='published' AND ($2::uuid IS NULL OR v.id=$2::uuid) ORDER BY v.published_at DESC LIMIT 1",
    [modelId, versionId ?? null],
  );
  if (!found.rowCount) throw new Error("package_not_found");
  const installationId = randomUUID(),
    subscriptionId = randomUUID();
  await pool.query(
    "INSERT INTO company_os_installations(id,tenant_id,package_id,desired_version_id,subscription_id,installation_state,subscription_state) VALUES($1,$2,$3,$4,$5,'selected','checkout_pending')",
    [
      installationId,
      tenantId,
      found.rows[0].faivr_agent_model_id,
      found.rows[0].faivr_package_version_id,
      subscriptionId,
    ],
  );
  return {
    installationId,
    subscriptionId,
    package: found.rows[0],
    state: "checkout_pending" as const,
  };
}
export async function recordCheckout(
  installationId: string,
  checkoutSessionId: string,
  providerCheckoutSessionId: string,
) {
  const result = await getPgPool().query(
    "UPDATE company_os_installations SET checkout_session_id=$2,stripe_checkout_session_id=$3,installation_state='payment_pending',updated_at=now() WHERE id=$1 AND installation_state='selected' AND subscription_state='checkout_pending' RETURNING *",
    [installationId, checkoutSessionId, providerCheckoutSessionId],
  );
  return result.rows[0] ?? null;
}
export async function markCheckoutFailed(
  tenantId: string,
  installationId: string,
) {
  const result = await getPgPool().query(
    "UPDATE company_os_installations SET installation_state='failed',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND installation_state IN ('selected','payment_pending') AND subscription_state='checkout_pending' RETURNING id",
    [installationId, tenantId],
  );
  return Boolean(result.rowCount);
}
export async function markEntitled(
  installationId: string,
  tenantId: string,
  stripeCheckoutSessionId: string,
  stripeSubscriptionId: string,
  client?: PoolClient,
) {
  const result=await (client ?? getPgPool()).query(
    "UPDATE company_os_installations SET installation_state='entitled',subscription_state='active',stripe_subscription_id=$4,entitled_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND stripe_checkout_session_id=$3 AND installation_state IN ('payment_pending','entitled') RETURNING id",
    [installationId, tenantId, stripeCheckoutSessionId, stripeSubscriptionId],
  );
  return Boolean(result.rowCount);
}
export async function installationForTenant(
  tenantId: string,
  installationId: string,
) {
  const r = await getPgPool().query(
    "SELECT i.*,p.id AS faivr_agent_model_id,p.slug,v.id AS faivr_package_version_id,v.version,v.manifest,v.publisher_key_id,v.publisher_signature,v.artifact_url,v.artifact_sha256,v.min_company_os_version FROM company_os_installations i JOIN company_os_packages p ON p.id=i.package_id JOIN company_os_package_versions v ON v.id=COALESCE(i.installed_version_id,i.desired_version_id) WHERE i.id=$1 AND i.tenant_id=$2",
    [installationId, tenantId],
  );
  return r.rows[0] ?? null;
}
export async function acknowledgeInstall(
  tenantId: string,
  ack: {
    installationId: string;
    modelId: string;
    version: string;
    packageDigest: string;
    localAgentDefinitionId: string;
    activationResult: string;
    compatibilityVerified: boolean;
    publisherSignatureVerified: boolean;
    packageChecksPassed: boolean;
  },
) {
  if (
    ack.activationResult !== "active" ||
    !ack.compatibilityVerified ||
    !ack.publisherSignatureVerified ||
    !ack.packageChecksPassed
  )
    return null;
  const r = await getPgPool().query(
    "UPDATE company_os_installations SET installation_state='active',installed_version_id=(SELECT v.id FROM company_os_package_versions v WHERE v.package_id=$3 AND v.version=$4 AND v.artifact_sha256=$5 LIMIT 1),local_agent_definition_id=$6,installed_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND package_id=$3 AND installation_state IN ('entitled','downloading','installing','active') AND EXISTS (SELECT 1 FROM company_os_package_versions v WHERE v.package_id=$3 AND v.version=$4 AND v.artifact_sha256=$5) RETURNING *",
    [
      ack.installationId,
      tenantId,
      ack.modelId,
      ack.version,
      ack.packageDigest,
      ack.localAgentDefinitionId,
    ],
  );
  return r.rows[0] ?? null;
}
export async function requestUninstall(
  tenantId: string,
  installationId: string,
  requestId: string,
  modelId: string,
  versionId: string,
) {
  const r = await getPgPool().query(
    "UPDATE company_os_installations SET installation_state='uninstall_pending',subscription_state='cancellation_pending_uninstall',uninstall_request_id=$3,uninstall_requested_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND package_id=$4 AND COALESCE(installed_version_id,desired_version_id)=$5::uuid AND installation_state IN ('active','disabled','uninstall_pending') RETURNING *",
    [installationId, tenantId, requestId, modelId, versionId],
  );
  return r.rows[0] ?? null;
}
export async function archiveInstallation(
  tenantId: string,
  installationId: string,
) {
  const r = await getPgPool().query(
    "UPDATE company_os_installations SET installation_state='disabled',updated_at=now() WHERE id=$1 AND tenant_id=$2 AND installation_state IN ('active','disabled') RETURNING *",
    [installationId, tenantId],
  );
  return r.rows[0] ?? null;
}
export async function acceptUninstallReceipt(
  receipt: UninstallReceipt,
  signature: string,
) {
  const pool = getPgPool(),
    client = await pool.connect();
  try {
    await client.query("BEGIN");
    const byId = await client.query(
      "SELECT payload=$2::jsonb AS same FROM company_os_uninstall_receipts WHERE receipt_id=$1",
      [receipt.receiptId, JSON.stringify(receipt)],
    );
    if (byId.rowCount) {
      if (!byId.rows[0].same)
        throw new IdempotencyConflict("receipt_id_reused_with_different_body");
      const existing = await client.query(
        "SELECT stripe_subscription_id FROM company_os_installations WHERE id=$1 AND tenant_id=$2",
        [receipt.installationId, receipt.tenantId],
      );
      await client.query("COMMIT");
      return {
        installationId: receipt.installationId,
        subscriptionId: receipt.subscriptionId,
        receiptId: receipt.receiptId,
        state: "receipt_accepted" as const,
        stripeSubscriptionId: existing.rows[0]?.stripe_subscription_id as
          string | null,
      };
    }
    const replay = await client.query(
      "SELECT receipt_id FROM company_os_uninstall_receipts WHERE tenant_id=$1 AND instance_id=$2 AND nonce=$3",
      [receipt.tenantId, receipt.instanceId, receipt.nonce],
    );
    if (replay.rowCount)
      throw new IdempotencyConflict("receipt_nonce_replayed");
    const updated = await client.query(
      "UPDATE company_os_installations SET installation_state='removed',receipt_accepted_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2 AND subscription_id=$3 AND uninstall_request_id=$4 AND package_id=$5 AND local_agent_definition_id::text=$8 AND installation_state='uninstall_pending' AND COALESCE(installed_version_id,desired_version_id)=(SELECT v.id FROM company_os_package_versions v WHERE v.package_id=$5 AND v.version=$6 AND v.artifact_sha256=$7 LIMIT 1) RETURNING stripe_subscription_id,subscription_id",
      [
        receipt.installationId,
        receipt.tenantId,
        receipt.subscriptionId,
        receipt.uninstallRequestId,
        receipt.modelId,
        receipt.version,
        receipt.packageDigest,
        receipt.localAgentDefinitionId,
      ],
    );
    if (!updated.rowCount) throw new Error("receipt_scope_mismatch");
    await client.query(
      "INSERT INTO company_os_uninstall_receipts(receipt_id,tenant_id,instance_id,installation_id,uninstall_request_id,subscription_id,nonce,payload,signature) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [
        receipt.receiptId,
        receipt.tenantId,
        receipt.instanceId,
        receipt.installationId,
        receipt.uninstallRequestId,
        receipt.subscriptionId,
        receipt.nonce,
        JSON.stringify(receipt),
        signature,
      ],
    );
    await client.query("COMMIT");
    return {
      installationId: receipt.installationId,
      subscriptionId: receipt.subscriptionId,
      receiptId: receipt.receiptId,
      state: "receipt_accepted" as const,
      stripeSubscriptionId: updated.rows[0].stripe_subscription_id as
        string | null,
    };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function markCancellationPending(
  tenantId: string,
  installationId: string,
  effectiveAt: string,
) {
  await getPgPool().query(
    "UPDATE company_os_installations SET subscription_state='cancel_at_period_end',billing_cancel_effective_at=$3,updated_at=now() WHERE id=$1 AND tenant_id=$2 AND installation_state='removed' AND subscription_state='cancellation_pending_uninstall'",
    [installationId, tenantId, effectiveAt],
  );
}
export async function confirmBillingStoppedByStripe(
  stripeSubscriptionId: string,
  effectiveAt: string,
  client?: PoolClient,
) {
  const result=await (client ?? getPgPool()).query(
    "UPDATE company_os_installations SET subscription_state='cancelled',billing_stopped_at=$2,updated_at=now() WHERE stripe_subscription_id=$1 AND installation_state='removed' AND subscription_state IN ('cancellation_pending_uninstall','cancel_at_period_end')",
    [stripeSubscriptionId, effectiveAt],
  );
  return Boolean(result.rowCount);
}
