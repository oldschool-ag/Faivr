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
export function administrator(value) {
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

/** The plan a box holds at a moment (ST1 plans): the newest one not ended by then. */
export async function liveBoxPlan(client, tenantId, instanceId, at) {
  const r = await client.query(
    "SELECT * FROM company_os_box_plans WHERE tenant_id=$1 AND instance_id=$2 AND (ends_at IS NULL OR ends_at>$3) ORDER BY created_at DESC LIMIT 1",
    [tenantId, instanceId, at.toISOString()],
  );
  return r.rows[0] ?? null;
}

// ST1 (Codex security sweep): what a box may do on a subscription at `now`, read inside a
// transaction that holds the box's lock. It ends exactly what the date sweep
// (applyDueSubscriptionDates) would end, whether or not the sweep has run yet: an order's end date,
// an administrator's end after its grace, the end of the plan an invoice subscription rides on.
// "new" may install, update and grant on it; "keep" may keep and re-fetch what it has (a grace, a
// provider's past-due period); null may do nothing.
const KEEP_STATES = ["active", "past_due", "suspended", "cancel_at_period_end", "cancellation_pending_uninstall"];

export function subscriptionAccess(row, now = new Date()) {
  if (!row) return null;
  const at = now.getTime();
  const passed = (value) => value !== null && value !== undefined && new Date(value).getTime() <= at;
  const invoice = row.billing_provider === INVOICE;
  if (invoice && passed(row.billing_ends_at)) return null;
  if (row.admin_ended_at && passed(row.cancel_effective_at)) return null;
  if (invoice && passed(row.plan_ends_at)) return null;
  if (row.subscription_state === "active" && !row.admin_ended_at && !row.plan_ended_by) return "new";
  return KEEP_STATES.includes(row.subscription_state) ? "keep" : null;
}

/** The box's lock first (the lock order of assign, grant and both ends), then the subscription and its plan. */
export async function lockedSubscriptionAccess(client, { tenantId, instanceId, subscriptionId, now = new Date() }) {
  await client.query("SELECT 1 FROM company_os_instance_keys WHERE tenant_id=$1 AND instance_id=$2 FOR UPDATE", [tenantId, instanceId]);
  const found = await client.query(
    "SELECT s.*,p.ended_by AS plan_ended_by,p.ends_at AS plan_ends_at FROM company_os_bundle_subscriptions s LEFT JOIN company_os_box_plans p ON p.id=s.box_plan_id WHERE s.id=$1 AND s.tenant_id=$2 AND s.instance_id=$3",
    [subscriptionId, tenantId, instanceId],
  );
  const row = found.rows[0] ?? null;
  return { row, access: subscriptionAccess(row, now) };
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

  // the box's row is locked: grants and plan assignments on one box run one after the other, so
  // their checks (one live copy, one currency, the box's plan) see each other's work
  const box = await client.query("SELECT 1 FROM company_os_instance_keys WHERE tenant_id=$1 AND instance_id=$2 AND revoked_at IS NULL FOR UPDATE", [input.tenantId, input.instanceId]);
  if (!box.rowCount) throw new OrderError("box_not_enrolled", 404);
  const bundle = await client.query("SELECT id,name,status,monthly_price_cents,currency,kind,ai_allowance_usd_cents FROM company_os_function_bundles WHERE id=$1", [input.bundleId]);
  if (!bundle.rowCount) throw new OrderError("bundle_not_found", 404);
  if (bundle.rows[0].status !== "active") throw new OrderError("bundle_not_active");
  const live = await client.query(
    "SELECT id,subscription_state,billing_provider FROM company_os_bundle_subscriptions WHERE tenant_id=$1 AND instance_id=$2 AND bundle_id=$3 AND copy_number=$4 AND subscription_state<>'cancelled'",
    [input.tenantId, input.instanceId, input.bundleId, copyNumber],
  );
  if (live.rowCount) throw new OrderError(`subscription_exists:${live.rows[0].id}:${live.rows[0].subscription_state}:${live.rows[0].billing_provider ?? "none"}`);

  // ST1 plans: every workflow is billed at its list price (the catalog entry's monthly price),
  // kept with the grant; a grant on a box with a plan rides on that plan
  const plan = await liveBoxPlan(client, input.tenantId, input.instanceId, now);
  // a plan an administrator is ending installs nothing new during its grace: no grant rides on it
  if (plan && plan.ended_by) throw new OrderError(`box_plan_is_ending:${plan.id}:${new Date(plan.ends_at).toISOString()}`, 409);
  if (plan && String(bundle.rows[0].currency) !== String(plan.currency)) throw new OrderError(`workflow_currency_differs_from_plan:${bundle.rows[0].currency}:${plan.currency}`);
  // one currency per box, also without a plan
  const otherCurrency = await client.query("SELECT COALESCE(s.invoice_currency,b.currency) AS currency FROM company_os_bundle_subscriptions s JOIN company_os_function_bundles b ON b.id=s.bundle_id WHERE s.tenant_id=$1 AND s.instance_id=$2 AND s.billing_provider=$3 AND COALESCE(s.invoice_currency,b.currency)<>$4 LIMIT 1", [input.tenantId, input.instanceId, INVOICE, bundle.rows[0].currency]);
  if (otherCurrency.rowCount) throw new OrderError(`box_currency_differs:${otherCurrency.rows[0].currency}:${bundle.rows[0].currency}`);
  const monthlyCents = Number(bundle.rows[0].monthly_price_cents);
  // ST1 final structure: a workflow brings its USD AI allowance; a single agent has none (it uses the
  // box's pool), never costs more than a workflow, and rides on a workflow the box holds
  const kind = bundle.rows[0].kind === "agent" ? "agent" : "workflow";
  const allowanceUsd = kind === "agent" ? 0 : Number(bundle.rows[0].ai_allowance_usd_cents ?? 0);
  if (kind === "agent") {
    const cheapest = await client.query("SELECT min(monthly_price_cents) AS cents FROM company_os_function_bundles WHERE kind='workflow' AND status='active' AND currency=$1", [bundle.rows[0].currency]);
    if (cheapest.rows[0]?.cents !== null && cheapest.rows[0]?.cents !== undefined && monthlyCents > Number(cheapest.rows[0].cents)) throw new OrderError(`agent_price_above_workflow_price:${input.bundleId}:${monthlyCents}:${cheapest.rows[0].cents}`);
    // the sweep's rule, under the box lock: a workflow whose end date, grace or plan has passed (swept
    // or not) or that an administrator is ending carries no new agent
    const workflows = await client.query("SELECT s.*,p.ended_by AS plan_ended_by,p.ends_at AS plan_ends_at FROM company_os_bundle_subscriptions s JOIN company_os_function_bundles b ON b.id=s.bundle_id LEFT JOIN company_os_box_plans p ON p.id=s.box_plan_id WHERE s.tenant_id=$1 AND s.instance_id=$2 AND s.billing_provider=$3 AND s.subscription_state='active' AND COALESCE(s.invoice_kind,b.kind)='workflow'", [input.tenantId, input.instanceId, INVOICE]);
    if (!workflows.rows.some((row) => subscriptionAccess(row, now) === "new")) throw new OrderError("agent_needs_a_workflow_on_the_box");
  }
  // a workflow on a plan with an end date ends with the plan unless it was given an earlier end
  const planEnd = plan?.ends_at ? new Date(plan.ends_at) : null;
  const ends = endsAt && planEnd ? (endsAt.getTime() < planEnd.getTime() ? endsAt : planEnd) : (endsAt ?? planEnd);

  const id = randomUUID();
  const description = copyDescription(String(bundle.rows[0].name), copyNumber);
  await client.query(
    "INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,copy_number,billing_description,billing_provider,subscription_state,entitled_at,billing_starts_at,billing_ends_at,granted_by,box_plan_id,invoice_monthly_cents,included_in_plan,invoice_currency,invoice_kind,invoice_allowance_usd_cents,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$8,$8)",
    [id, input.tenantId, input.instanceId, input.bundleId, copyNumber, description, INVOICE, now.toISOString(), startsAt.toISOString(), ends ? ends.toISOString() : null, admin, plan?.id ?? null, monthlyCents, false, String(bundle.rows[0].currency).toLowerCase(), kind, allowanceUsd],
  );
  await audit(client, id, "granted_by_order", admin, { bundleId: input.bundleId, copyNumber, startsAt: startsAt.toISOString(), endsAt: ends ? ends.toISOString() : null, boxPlanId: plan?.id ?? null, kind, monthlyCents, allowanceUsdCents: allowanceUsd, note }, now);
  return { subscriptionId: id, tenantId: input.tenantId, instanceId: input.instanceId, bundleId: input.bundleId, copyNumber, description, billing: INVOICE, subscriptionState: "active", startsAt: startsAt.toISOString(), endsAt: ends ? ends.toISOString() : null, grantedBy: admin, boxPlanId: plan?.id ?? null, kind, monthlyPriceCents: monthlyCents, allowanceUsdCents: allowanceUsd };
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
 * @param {{ subscriptionId: string; graceDays: number; administrator: string; reason?: string | null; confirmProviderNotTold?: boolean; effectiveAt?: Date | null; now?: Date }} input
 */
/**
 * ST1: the invoice workflows on a box's plan that run for as long as the plan does: active, not
 * ended by an administrator, and with no end of their own before the plan's end (an open plan
 * needs a workflow with no end). A box always has at least one.
 */
export async function workflowsCoveringPlan(client, boxPlanId, planEndsAt, exceptId = null) {
  const rows = (await client.query("SELECT s.id,s.billing_ends_at,COALESCE(s.invoice_kind,b.kind) AS kind FROM company_os_bundle_subscriptions s JOIN company_os_function_bundles b ON b.id=s.bundle_id WHERE s.box_plan_id=$1 AND s.billing_provider=$2 AND s.subscription_state='active' AND s.admin_ended_at IS NULL", [boxPlanId, INVOICE])).rows;
  const planEnd = planEndsAt ? new Date(planEndsAt).getTime() : null;
  return rows.filter((row) => row.id !== exceptId && row.kind === "workflow" && (row.billing_ends_at === null || (planEnd !== null && new Date(row.billing_ends_at).getTime() >= planEnd)));
}

export async function endSubscriptionByAdmin(client, input) {
  const now = input.now ?? new Date();
  const admin = administrator(input.administrator);
  if (!UUID.test(String(input.subscriptionId ?? ""))) throw new OrderError("subscription_id_invalid", 400);
  const graceDays = Number(input.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 366) throw new OrderError("grace_days_invalid", 400);
  // the row is locked: a provider event in flight waits, then finds the administrator's end
  // ST1: the box's row first (the lock order of assign-plan and grant-by-order), so two ends on one
  // box run one after the other and the last-workflow check below sees the other's end
  const owner = await client.query("SELECT tenant_id,instance_id FROM company_os_bundle_subscriptions WHERE id=$1", [input.subscriptionId]);
  if (owner.rowCount) await client.query("SELECT 1 FROM company_os_instance_keys WHERE tenant_id=$1 AND instance_id=$2 FOR UPDATE", [owner.rows[0].tenant_id, owner.rows[0].instance_id]);
  const found = await client.query("SELECT id,subscription_state,billing_provider,billing_ends_at,admin_ended_at,cancel_effective_at,box_plan_id,bundle_id,invoice_kind FROM company_os_bundle_subscriptions WHERE id=$1 FOR UPDATE", [input.subscriptionId]);
  const row = found.rows[0];
  if (!row) throw new OrderError("subscription_not_found", 404);
  row.kind = row.invoice_kind ?? (await client.query("SELECT kind FROM company_os_function_bundles WHERE id=$1", [row.bundle_id])).rows[0]?.kind ?? "workflow";
  // ST1: a box always has at least one workflow; its last one ends with its plan (end-plan)
  if (!input.withPlan && row.billing_provider === INVOICE && row.kind === "workflow" && row.box_plan_id) {
    const plan = await client.query("SELECT ends_at FROM company_os_box_plans WHERE id=$1", [row.box_plan_id]);
    const planRuns = plan.rows[0] && (!plan.rows[0].ends_at || new Date(plan.rows[0].ends_at).getTime() > now.getTime());
    // another workflow must run as long as the plan does, not only until its own earlier end
    if (planRuns && !(await workflowsCoveringPlan(client, row.box_plan_id, plan.rows[0].ends_at, row.id)).length) throw new OrderError("last_workflow_end_the_plan_instead");
  }
  if (row.admin_ended_at) throw new OrderError(`subscription_already_ended_by_admin:${new Date(row.cancel_effective_at).toISOString()}`);
  if (row.billing_provider === "stripe") throw new OrderError("stripe_subscription_end_at_stripe");
  if (row.billing_provider !== INVOICE && !input.confirmProviderNotTold) throw new OrderError("provider_subscription_needs_confirmation_the_provider_is_not_told");
  if (!["active", "past_due", "suspended", "cancel_at_period_end"].includes(row.subscription_state)) throw new OrderError(`subscription_state_mismatch:${row.subscription_state}`);
  // an exact deadline (a plan's end passed on to its subscriptions) wins over whole grace days
  if (input.effectiveAt && (!(input.effectiveAt instanceof Date) || Number.isNaN(input.effectiveAt.getTime()) || input.effectiveAt.getTime() < now.getTime())) throw new OrderError("effective_at_invalid", 400);
  let effective = input.effectiveAt ? new Date(input.effectiveAt.getTime()) : new Date(now.getTime() + graceDays * DAY_MS);
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
  const at = scope.now ?? new Date();
  const now = at.toISOString();
  const tenantId = scope.tenantId ?? null;
  const instanceId = scope.instanceId ?? null;
  const ended = [];
  // both dates a row may carry are weighed together: the earliest one that has passed is the stop
  const due = await client.query(
    "SELECT s.id,s.billing_provider,s.billing_ends_at,s.admin_ended_at,s.cancel_effective_at,s.subscription_state,p.ends_at AS plan_ends_at FROM company_os_bundle_subscriptions s LEFT JOIN company_os_box_plans p ON p.id=s.box_plan_id WHERE s.subscription_state<>'cancelled' AND ((s.billing_provider='invoice' AND s.billing_ends_at IS NOT NULL AND s.billing_ends_at<=$1) OR (s.admin_ended_at IS NOT NULL AND s.subscription_state='cancel_at_period_end' AND s.cancel_effective_at<=$1) OR (s.billing_provider='invoice' AND p.ends_at IS NOT NULL AND p.ends_at<=$1)) AND ($2::uuid IS NULL OR s.tenant_id=$2::uuid) AND ($3::uuid IS NULL OR s.instance_id=$3::uuid)",
    [now, tenantId, instanceId],
  );
  for (const row of due.rows) {
    const candidates = [];
    if (row.billing_provider === INVOICE && row.billing_ends_at) candidates.push({ reason: "order_end_date", at: new Date(row.billing_ends_at) });
    if (row.admin_ended_at && row.subscription_state === "cancel_at_period_end" && row.cancel_effective_at) candidates.push({ reason: "admin_grace_over", at: new Date(row.cancel_effective_at) });
    // an invoice subscription on a plan ends when its plan ends, whatever later date of its own it has
    if (row.billing_provider === INVOICE && row.plan_ends_at) candidates.push({ reason: "plan_ended", at: new Date(row.plan_ends_at) });
    const first = candidates.filter((item) => item.at.getTime() <= at.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime())[0];
    if (!first) continue;
    const stoppedAt = first.at.toISOString();
    const changed = await client.query("UPDATE company_os_bundle_subscriptions SET subscription_state='cancelled',stopped_at=$2,updated_at=$3 WHERE id=$1 AND subscription_state<>'cancelled' RETURNING id", [row.id, stoppedAt, now]);
    if (!changed.rowCount) continue;
    await client.query("UPDATE company_os_installations SET subscription_state='cancelled',updated_at=$2 WHERE bundle_subscription_id=$1", [row.id, now]);
    await client.query("UPDATE company_os_installations SET billing_stopped_at=COALESCE(billing_stopped_at,$2),updated_at=$3 WHERE bundle_subscription_id=$1 AND installation_state='removed'", [row.id, stoppedAt, now]);
    await audit(client, row.id, "ended", STORE_ACTOR, { reason: first.reason, stoppedAt }, at);
    ended.push({ subscriptionId: row.id, reason: first.reason, stoppedAt });
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
