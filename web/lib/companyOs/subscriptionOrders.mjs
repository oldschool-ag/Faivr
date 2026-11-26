// ST1: subscriptions by order. One module for the store (the date sweep) and for Old School's
// admin command (scripts/company-os-store-admin.mjs: grant-by-order, end-subscription), so both
// run the same statements. Nothing here talks to a billing provider: an order is billed by
// invoice, and an administrator's end is the store's own decision.
//
// Plain JavaScript on purpose: the admin command runs with node and no build step.
import { randomUUID } from "node:crypto";

/** The billing_provider value of a subscription Old School bills by invoice. */
export const INVOICE = "invoice";

/** The store's name for itself in the audit lines it writes when a date is reached. */
export const STORE_ACTOR = "store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUNDLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export class OrderError extends Error {
  /** @param {string} code @param {number} [status] */
  constructor(code, status = 409) {
    super(code);
    this.name = "OrderError";
    this.code = code;
    this.status = status;
  }
}

/** The name of the administrator on an audit line: required, one line, no more than 200 characters. */
function administrator(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name || name.length > 200 || /[\r\n\t]/.test(name)) throw new OrderError("administrator_required", 400);
  return name;
}

/** A date as given on the command line (2026-11-30 or a full ISO time); a bare date is midnight UTC. */
export function parseOrderDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00.000Z` : text;
  const date = new Date(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(text) || Number.isNaN(date.getTime())) throw new OrderError(`${field}_invalid`, 400);
  return date;
}

/** The text a subscription carries for the owner, the same as a paid copy's (billing/provider.ts paidCopyDescription). */
function copyDescription(functionName, copyNumber) {
  if (copyNumber === 1) return functionName;
  return `${functionName} — ${copyNumber === 2 ? "second copy" : `copy ${copyNumber}`}`;
}

async function audit(client, subscriptionId, action, admin, detail, at) {
  await client.query(
    "INSERT INTO company_os_subscription_audit(id,subscription_id,action,administrator,detail,created_at) VALUES($1,$2,$3,$4,$5,$6)",
    [randomUUID(), subscriptionId, action, admin, JSON.stringify(detail), at.toISOString()],
  );
}

/**
 * Grant one box an active subscription to one function, billed by invoice.
 *
 * The row is the same kind of row a paid checkout leaves behind (state `active`, entitled now),
 * so the box installs from it exactly as from a paid subscription. It differs only in what the
 * store never does with it: no provider id, so no provider event or call can reach it.
 *
 * The start date is the day invoice billing starts (it may lie up to a year ahead or back). It
 * does not hold back the box: the grant is active from the moment it is made, so Old School can
 * grant before the office is prepared. An end date, when given, ends the subscription on that day
 * (the date sweep below); it lies after the start and in the future.
 *
 * @param {{ query: Function }} client
 * @param {{ tenantId: string; instanceId: string; bundleId: string; copyNumber?: number; startsOn: string; endsOn?: string | null; administrator: string; note?: string | null; now?: Date }} input
 */
export async function grantSubscriptionByOrder(client, input) {
  const now = input.now ?? new Date();
  const admin = administrator(input.administrator);
  if (!UUID.test(String(input.tenantId ?? ""))) throw new OrderError("tenant_id_invalid", 400);
  if (!UUID.test(String(input.instanceId ?? ""))) throw new OrderError("instance_id_invalid", 400);
  if (!BUNDLE_ID.test(String(input.bundleId ?? ""))) throw new OrderError("bundle_id_invalid", 400);
  const copyNumber = input.copyNumber ?? 1;
  if (!Number.isSafeInteger(copyNumber) || copyNumber < 1 || copyNumber > 99) throw new OrderError("copy_number_invalid", 400);
  const startsAt = parseOrderDate(input.startsOn, "start");
  if (!startsAt) throw new OrderError("start_required", 400);
  if (Math.abs(startsAt.getTime() - now.getTime()) > 366 * DAY_MS) throw new OrderError("start_more_than_a_year_away", 400);
  const endsAt = parseOrderDate(input.endsOn, "end");
  if (endsAt && endsAt.getTime() <= now.getTime()) throw new OrderError("end_not_in_future", 400);
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) throw new OrderError("end_not_after_start", 400);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null;

  const box = await client.query("SELECT 1 FROM company_os_instance_keys WHERE tenant_id=$1 AND instance_id=$2 AND revoked_at IS NULL", [input.tenantId, input.instanceId]);
  if (!box.rowCount) throw new OrderError("box_not_enrolled", 404);
  const bundle = await client.query("SELECT id,name,status FROM company_os_function_bundles WHERE id=$1", [input.bundleId]);
  if (!bundle.rowCount) throw new OrderError("bundle_not_found", 404);
  if (bundle.rows[0].status !== "active") throw new OrderError("bundle_not_active");
  const live = await client.query(
    "SELECT id,subscription_state,billing_provider FROM company_os_bundle_subscriptions WHERE tenant_id=$1 AND instance_id=$2 AND bundle_id=$3 AND copy_number=$4 AND subscription_state<>'cancelled'",
    [input.tenantId, input.instanceId, input.bundleId, copyNumber],
  );
  if (live.rowCount) throw new OrderError(`subscription_exists:${live.rows[0].id}:${live.rows[0].subscription_state}:${live.rows[0].billing_provider ?? "none"}`);

  const id = randomUUID();
  const description = copyDescription(String(bundle.rows[0].name), copyNumber);
  await client.query(
    "INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,copy_number,billing_description,billing_provider,subscription_state,entitled_at,billing_starts_at,billing_ends_at,granted_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$8,$8)",
    [id, input.tenantId, input.instanceId, input.bundleId, copyNumber, description, INVOICE, now.toISOString(), startsAt.toISOString(), endsAt ? endsAt.toISOString() : null, admin],
  );
  await audit(client, id, "granted_by_order", admin, { bundleId: input.bundleId, copyNumber, startsAt: startsAt.toISOString(), endsAt: endsAt ? endsAt.toISOString() : null, note }, now);
  return { subscriptionId: id, tenantId: input.tenantId, instanceId: input.instanceId, bundleId: input.bundleId, copyNumber, description, billing: INVOICE, subscriptionState: "active", startsAt: startsAt.toISOString(), endsAt: endsAt ? endsAt.toISOString() : null, grantedBy: admin };
}

/**
 * End a subscription by the administrator's decision, after a grace period.
 *
 * During the grace the subscription is `cancel_at_period_end`: what is installed keeps working
 * and the box shows the end date, the store reserves no new install. When the grace is over the
 * date sweep makes it `cancelled` and the box stops the function (no new tasks; nothing deleted).
 *
 * For an invoice subscription that is the whole end. For a provider subscription it is the
 * store's end only (the January move ends the sandbox subscriptions): the provider is not asked,
 * so `confirmProviderNotTold` must be set, and from then on provider events leave the row alone.
 *
 * @param {{ query: Function }} client
 * @param {{ subscriptionId: string; graceDays: number; administrator: string; reason?: string | null; confirmProviderNotTold?: boolean; now?: Date }} input
 */
export async function endSubscriptionByAdmin(client, input) {
  const now = input.now ?? new Date();
  const admin = administrator(input.administrator);
  if (!UUID.test(String(input.subscriptionId ?? ""))) throw new OrderError("subscription_id_invalid", 400);
  const graceDays = Number(input.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 366) throw new OrderError("grace_days_invalid", 400);
  const found = await client.query("SELECT id,subscription_state,billing_provider,billing_ends_at,admin_ended_at,cancel_effective_at FROM company_os_bundle_subscriptions WHERE id=$1", [input.subscriptionId]);
  const row = found.rows[0];
  if (!row) throw new OrderError("subscription_not_found", 404);
  if (row.admin_ended_at) throw new OrderError(`subscription_already_ended_by_admin:${new Date(row.cancel_effective_at).toISOString()}`);
  if (row.billing_provider === "stripe") throw new OrderError("stripe_subscription_end_at_stripe");
  if (row.billing_provider !== INVOICE && !input.confirmProviderNotTold) throw new OrderError("provider_subscription_needs_confirmation_the_provider_is_not_told");
  if (!["active", "past_due", "suspended", "cancel_at_period_end"].includes(row.subscription_state)) throw new OrderError(`subscription_state_mismatch:${row.subscription_state}`);
  let effective = new Date(now.getTime() + graceDays * DAY_MS);
  // an earlier end already on the row (the order's end date, the provider's period end) stays
  for (const earlier of [row.billing_ends_at, row.subscription_state === "cancel_at_period_end" ? row.cancel_effective_at : null]) {
    if (earlier && new Date(earlier).getTime() < effective.getTime()) effective = new Date(earlier);
  }
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 500) : null;
  const updated = await client.query(
    "UPDATE company_os_bundle_subscriptions SET subscription_state='cancel_at_period_end',cancel_effective_at=$2,admin_ended_at=$3,admin_ended_by=$4,updated_at=$3 WHERE id=$1 AND admin_ended_at IS NULL AND subscription_state IN ('active','past_due','suspended','cancel_at_period_end') RETURNING id",
    [row.id, effective.toISOString(), now.toISOString(), admin],
  );
  if (!updated.rowCount) throw new OrderError("subscription_changed_try_again");
  await client.query("UPDATE company_os_installations SET subscription_state='cancel_at_period_end',billing_cancel_effective_at=$2,updated_at=$3 WHERE bundle_subscription_id=$1", [row.id, effective.toISOString(), now.toISOString()]);
  await audit(client, row.id, "ended_by_admin", admin, { graceDays, effectiveAt: effective.toISOString(), billing: row.billing_provider ?? null, providerTold: false, reason }, now);
  const ended = { subscriptionId: row.id, billing: row.billing_provider ?? null, subscriptionState: "cancel_at_period_end", effectiveAt: effective.toISOString(), endedBy: admin };
  // a grace of 0 days ends it now
  if (effective.getTime() <= now.getTime()) await applyDueSubscriptionDates(client, { now });
  return ended;
}

/**
 * The dates the store keeps itself, applied when they are reached: an order's end date, and the
 * end of an administrator's grace. The row becomes `cancelled` (stopped on that date) and the
 * installations that ride it follow, the same mirror a provider's end leaves. Idempotent; the
 * store calls it before it answers a box and from the reconcile cron.
 *
 * @param {{ query: Function }} client
 * @param {{ tenantId?: string | null; instanceId?: string | null; now?: Date }} [scope]
 */
export async function applyDueSubscriptionDates(client, scope = {}) {
  const now = (scope.now ?? new Date()).toISOString();
  const tenantId = scope.tenantId ?? null;
  const instanceId = scope.instanceId ?? null;
  const ended = [];
  const statements = [
    ["order_end_date", "UPDATE company_os_bundle_subscriptions SET subscription_state='cancelled',stopped_at=billing_ends_at,updated_at=$1 WHERE billing_provider='invoice' AND subscription_state<>'cancelled' AND billing_ends_at IS NOT NULL AND billing_ends_at<=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid) AND ($3::uuid IS NULL OR instance_id=$3::uuid) RETURNING id,stopped_at"],
    ["admin_grace_over", "UPDATE company_os_bundle_subscriptions SET subscription_state='cancelled',stopped_at=cancel_effective_at,updated_at=$1 WHERE admin_ended_at IS NOT NULL AND subscription_state='cancel_at_period_end' AND cancel_effective_at<=$1 AND ($2::uuid IS NULL OR tenant_id=$2::uuid) AND ($3::uuid IS NULL OR instance_id=$3::uuid) RETURNING id,stopped_at"],
  ];
  for (const [reason, sql] of statements) {
    const result = await client.query(sql, [now, tenantId, instanceId]);
    for (const row of result.rows) {
      const stoppedAt = new Date(row.stopped_at).toISOString();
      await client.query("UPDATE company_os_installations SET subscription_state='cancelled',updated_at=$2 WHERE bundle_subscription_id=$1", [row.id, now]);
      await client.query("UPDATE company_os_installations SET billing_stopped_at=COALESCE(billing_stopped_at,$2),updated_at=$3 WHERE bundle_subscription_id=$1 AND installation_state='removed'", [row.id, stoppedAt, now]);
      await audit(client, row.id, "ended", STORE_ACTOR, { reason, stoppedAt }, new Date(now));
      ended.push({ subscriptionId: row.id, reason, stoppedAt });
    }
  }
  return { ended };
}

/** The subscriptions Old School bills by invoice or ended itself, for `list`. */
export async function orderSubscriptions(client) {
  const rows = await client.query(
    "SELECT id,tenant_id,instance_id,bundle_id,copy_number,billing_provider,subscription_state,billing_starts_at,billing_ends_at,granted_by,cancel_effective_at,admin_ended_by,stopped_at FROM company_os_bundle_subscriptions WHERE billing_provider='invoice' OR admin_ended_at IS NOT NULL ORDER BY created_at DESC LIMIT 100",
  );
  return rows.rows;
}
