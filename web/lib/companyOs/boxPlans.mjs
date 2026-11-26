// ST1 plans: what Old School invoices per box, and what the box shows on its Plan and costs
// page. A plan is data the CEO enters: its name, its workflows (the functions it includes at
// CHF 0), its monthly price by customer number (for example customers 1 to 50 one price, from
// customer 51 another), the AI allowance included in that price, free months, what it includes,
// and whether its prices are before VAT. The Swiss VAT rate is data too, by the day it applies
// from. A box keeps the price and terms it was given; only boxes an administrator has not marked
// (test boxes, Old School's own) count as customers.
//
// One function (invoiceLines) builds a month's lines; the admin command prints them as CSV and the
// store answers the box with the same lines, so both always agree.
//
// Plain JavaScript on purpose: the admin command runs with node and no build step. No billing
// provider is reached from here.
import { randomUUID } from "node:crypto";
import { administrator, endSubscriptionByAdmin, grantSubscriptionByOrder, includedInPlan, INVOICE, liveBoxPlan, OrderError, parseOrderDate } from "./subscriptionOrders.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const ITEM_KINDS = { "ai-top-up": "ai_top_up", "ai-use-above-allowance": "ai_use_above_allowance" };
const ITEM_TEXT = { ai_top_up: "AI top-up", ai_use_above_allowance: "AI use above the included allowance" };
const MARKS = { test: "test", "old-school": "old_school" };
const MARK_TEXT = { test: "test box", old_school: "Old School's own box" };

/** An amount in francs as typed ("12", "12.50") into minor units; never more than two decimals. */
export function parseChf(value, field) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) throw new OrderError(`${field}_invalid`, 400);
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** "2027-01" into the month's first instant and the next month's (UTC). */
export function parseMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new OrderError("month_invalid", 400);
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return { label: match[0], start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
}

export function currentMonth(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Calendar months from the month a date falls in to another month's start (0 = the same month). */
function monthsFrom(date, monthStart) {
  const d = new Date(date);
  return (monthStart.getUTCFullYear() - d.getUTCFullYear()) * 12 + (monthStart.getUTCMonth() - d.getUTCMonth());
}

function money(cents) {
  return (cents / 100).toFixed(2);
}

async function planAudit(client, action, admin, detail, ids = {}, at = new Date()) {
  await client.query(
    "INSERT INTO company_os_plan_audit(id,plan_id,box_plan_id,action,administrator,detail,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [randomUUID(), ids.planId ?? null, ids.boxPlanId ?? null, action, admin, JSON.stringify(detail), at.toISOString()],
  );
}

/** "1=12|51=20" (from customer 1 CHF 12, from customer 51 CHF 20) into price steps; the first starts at customer 1. */
export function parsePriceSteps(value) {
  const steps = String(value ?? "").split("|").map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = /^(\d{1,6})=(.+)$/.exec(part);
    if (!match || Number(match[1]) < 1) throw new OrderError("prices_invalid", 400);
    return { fromCustomer: Number(match[1]), monthlyPriceCents: parseChf(match[2], "prices") };
  }).sort((a, b) => a.fromCustomer - b.fromCustomer);
  if (!steps.length || steps[0].fromCustomer !== 1 || new Set(steps.map((step) => step.fromCustomer)).size !== steps.length || steps.length > 20) throw new OrderError("prices_invalid", 400);
  return steps;
}

/** The monthly price for a customer number: the last step that starts at or before it. */
function priceFor(steps, customerNumber) {
  let price = null;
  for (const step of [...steps].sort((a, b) => Number(a.from_customer) - Number(b.from_customer))) if (Number(step.from_customer) <= customerNumber) price = Number(step.monthly_price_cents);
  if (price === null) throw new OrderError("plan_has_no_price", 409);
  return price;
}

/**
 * Define a plan, or change it (for boxes that get it afterwards). Every value is given: nothing
 * is assumed by code.
 *
 * @param {{ query: Function }} client
 * @param {{ id: string; name: string; prices: string; currency?: string; pricesExcludeVat: boolean; aiAllowanceChf: string; freeMonths: number; includes: string[]; administrator: string }} input
 */
export async function definePlan(client, input) {
  const admin = administrator(input.administrator);
  if (!SLUG.test(String(input.id ?? ""))) throw new OrderError("plan_id_invalid", 400);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 120) throw new OrderError("plan_name_invalid", 400);
  const steps = parsePriceSteps(input.prices);
  const allowance = parseChf(input.aiAllowanceChf, "ai_allowance");
  const currency = String(input.currency ?? "chf").trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new OrderError("currency_invalid", 400);
  if (typeof input.pricesExcludeVat !== "boolean") throw new OrderError("prices_exclude_vat_required", 400);
  const freeMonths = Number(input.freeMonths);
  if (!Number.isInteger(freeMonths) || freeMonths < 0 || freeMonths > 24) throw new OrderError("free_months_invalid", 400);
  const includes = (input.includes ?? []).map((item) => String(item).trim()).filter(Boolean);
  if (!includes.length || includes.length > 20 || includes.some((item) => item.length > 200)) throw new OrderError("includes_invalid", 400);
  await client.query(
    "INSERT INTO company_os_plans(id,name,currency,prices_exclude_vat,ai_allowance_cents,free_months,includes,status,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,currency=EXCLUDED.currency,prices_exclude_vat=EXCLUDED.prices_exclude_vat,ai_allowance_cents=EXCLUDED.ai_allowance_cents,free_months=EXCLUDED.free_months,includes=EXCLUDED.includes,status='active',updated_by=EXCLUDED.updated_by,updated_at=now()",
    [input.id, name, currency, input.pricesExcludeVat, allowance, freeMonths, JSON.stringify(includes), admin],
  );
  await client.query("DELETE FROM company_os_plan_prices WHERE plan_id=$1", [input.id]);
  for (const step of steps) await client.query("INSERT INTO company_os_plan_prices(plan_id,from_customer,monthly_price_cents) VALUES($1,$2,$3)", [input.id, step.fromCustomer, step.monthlyPriceCents]);
  const plan = { id: input.id, name, prices: steps, currency, pricesExcludeVat: input.pricesExcludeVat, aiAllowanceCents: allowance, freeMonths, includes };
  await planAudit(client, "plan_defined", admin, plan, { planId: input.id });
  return plan;
}

/** The Swiss VAT rate (in percent, e.g. "7.7") from a day on; an invoice month uses the rate in force on its first day. */
export async function setVatRate(client, input) {
  const admin = administrator(input.administrator);
  const from = parseOrderDate(input.from, "vat_from");
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.from).trim())) throw new OrderError("vat_from_invalid", 400);
  const text = String(input.percent ?? "").trim();
  if (!/^\d{1,2}(?:\.\d{1,2})?$/.test(text)) throw new OrderError("vat_percent_invalid", 400);
  const [whole, fraction = ""] = text.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const day = from.toISOString().slice(0, 10);
  await client.query("INSERT INTO company_os_vat_rates(effective_from,rate_basis_points,set_by) VALUES($1,$2,$3) ON CONFLICT(effective_from) DO UPDATE SET rate_basis_points=EXCLUDED.rate_basis_points,set_by=EXCLUDED.set_by,created_at=now()", [day, basisPoints, admin]);
  await planAudit(client, "vat_rate_set", admin, { from: day, basisPoints });
  return { from: day, ratePercent: basisPoints / 100 };
}

/**
 * An administrator's mark on a box that never counts as a paying customer: a test box or one of
 * Old School's own boxes. Only the store admin command sets it; no box request can. "client"
 * removes the mark. Mark a box before it gets a plan: its customer number is set then.
 */
export async function markBox(client, input) {
  const admin = administrator(input.administrator);
  if (!UUID.test(String(input.tenantId ?? "")) || !UUID.test(String(input.instanceId ?? ""))) throw new OrderError("box_id_invalid", 400);
  const box = await client.query("SELECT 1 FROM company_os_instance_keys WHERE tenant_id=$1 AND instance_id=$2", [input.tenantId, input.instanceId]);
  if (!box.rowCount) throw new OrderError("box_not_enrolled", 404);
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 200) : null;
  if (input.as === "client") {
    await client.query("DELETE FROM company_os_box_marks WHERE tenant_id=$1 AND instance_id=$2", [input.tenantId, input.instanceId]);
  } else {
    const mark = MARKS[String(input.as ?? "")];
    if (!mark) throw new OrderError("mark_invalid", 400);
    await client.query("INSERT INTO company_os_box_marks(tenant_id,instance_id,mark,note,set_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,instance_id) DO UPDATE SET mark=EXCLUDED.mark,note=EXCLUDED.note,set_by=EXCLUDED.set_by,created_at=now()", [input.tenantId, input.instanceId, mark, note, admin]);
  }
  await planAudit(client, "box_marked", admin, { tenantId: input.tenantId, instanceId: input.instanceId, as: input.as, note });
  return { tenantId: input.tenantId, instanceId: input.instanceId, mark: input.as === "client" ? null : MARKS[input.as] };
}

async function boxMark(client, tenantId, instanceId) {
  const r = await client.query("SELECT mark FROM company_os_box_marks WHERE tenant_id=$1 AND instance_id=$2", [tenantId, instanceId]);
  return r.rows[0]?.mark ?? null;
}

/** The boxes that count as paying customers of a plan: every box that held it and carries no mark. */
async function countingCustomers(client, planId) {
  const held = await client.query("SELECT tenant_id,instance_id,customer_number FROM company_os_box_plans WHERE plan_id=$1 AND customer_number IS NOT NULL", [planId]);
  const marks = await client.query("SELECT tenant_id,instance_id FROM company_os_box_marks");
  const marked = new Set(marks.rows.map((row) => `${row.tenant_id}/${row.instance_id}`));
  const boxes = new Map();
  for (const row of held.rows) {
    const key = `${row.tenant_id}/${row.instance_id}`;
    if (marked.has(key)) continue;
    boxes.set(key, Math.min(boxes.get(key) ?? Infinity, Number(row.customer_number)));
  }
  return boxes;
}

/** Include a function in a plan at CHF 0, or take it out (for boxes that get the plan afterwards). */
export async function setPlanFunction(client, input) {
  const admin = administrator(input.administrator);
  const plan = await client.query("SELECT id FROM company_os_plans WHERE id=$1", [input.planId]);
  if (!plan.rowCount) throw new OrderError("plan_not_found", 404);
  const bundle = await client.query("SELECT id FROM company_os_function_bundles WHERE id=$1", [input.bundleId]);
  if (!bundle.rowCount) throw new OrderError("bundle_not_found", 404);
  if (input.included) await client.query("INSERT INTO company_os_plan_functions(plan_id,bundle_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [input.planId, input.bundleId]);
  else await client.query("DELETE FROM company_os_plan_functions WHERE plan_id=$1 AND bundle_id=$2", [input.planId, input.bundleId]);
  await planAudit(client, "plan_function_changed", admin, { bundleId: input.bundleId, included: Boolean(input.included) }, { planId: input.planId });
  return { planId: input.planId, bundleId: input.bundleId, included: Boolean(input.included) };
}

/**
 * Give a box a plan. A box that counts (no administrator's mark) gets the next customer number of
 * the plan and the price of that number, and keeps both (a box that held the plan before gets its
 * old number back). A marked box gets no number: it is shown the price the next customer would
 * pay and is never invoiced. Every function the plan includes is granted by order at CHF 0
 * ("included in your plan"); invoice subscriptions the box already has join the plan.
 */
export async function assignPlan(client, input) {
  const now = input.now ?? new Date();
  const admin = administrator(input.administrator);
  if (!UUID.test(String(input.tenantId ?? "")) || !UUID.test(String(input.instanceId ?? ""))) throw new OrderError("box_id_invalid", 400);
  const startsAt = parseOrderDate(input.startsOn, "start");
  if (!startsAt) throw new OrderError("start_required", 400);
  if (Math.abs(startsAt.getTime() - now.getTime()) > 366 * DAY_MS) throw new OrderError("start_more_than_a_year_away", 400);
  const endsAt = parseOrderDate(input.endsOn, "end");
  if (endsAt && (endsAt.getTime() <= now.getTime() || endsAt.getTime() <= startsAt.getTime())) throw new OrderError("end_not_after_start_and_now", 400);
  const box = await client.query("SELECT 1 FROM company_os_instance_keys WHERE tenant_id=$1 AND instance_id=$2 AND revoked_at IS NULL", [input.tenantId, input.instanceId]);
  if (!box.rowCount) throw new OrderError("box_not_enrolled", 404);
  // the plan row is locked while customers are counted, so two boxes cannot get the same number
  const found = await client.query("SELECT * FROM company_os_plans WHERE id=$1 FOR UPDATE", [input.planId]);
  const plan = found.rows[0];
  if (!plan) throw new OrderError("plan_not_found", 404);
  if (plan.status !== "active") throw new OrderError("plan_retired");
  const live = await liveBoxPlan(client, input.tenantId, input.instanceId, now);
  if (live) throw new OrderError(`box_has_a_plan:${live.id}:${live.plan_id}`);
  const steps = (await client.query("SELECT from_customer,monthly_price_cents FROM company_os_plan_prices WHERE plan_id=$1", [plan.id])).rows;
  const mark = await boxMark(client, input.tenantId, input.instanceId);
  const customers = await countingCustomers(client, plan.id);
  const key = `${input.tenantId}/${input.instanceId}`;
  const customerNumber = mark ? null : (customers.get(key) ?? customers.size + 1);
  // a returning customer keeps the price it had with its number; only a new number takes today's steps
  const earlier = customerNumber === null ? null : (await client.query("SELECT monthly_price_cents FROM company_os_box_plans WHERE plan_id=$1 AND tenant_id=$2 AND instance_id=$3 AND customer_number=$4 ORDER BY created_at LIMIT 1", [plan.id, input.tenantId, input.instanceId, customerNumber])).rows[0];
  const monthlyCents = earlier ? Number(earlier.monthly_price_cents) : priceFor(steps, customerNumber ?? customers.size + 1);
  const boxPlanId = randomUUID();
  await client.query(
    "INSERT INTO company_os_box_plans(id,tenant_id,instance_id,plan_id,plan_name,monthly_price_cents,currency,prices_exclude_vat,ai_allowance_cents,free_months,includes,customer_number,starts_at,ends_at,granted_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    [boxPlanId, input.tenantId, input.instanceId, plan.id, plan.name, monthlyCents, plan.currency, plan.prices_exclude_vat, plan.ai_allowance_cents, plan.free_months, JSON.stringify(plan.includes), customerNumber, startsAt.toISOString(), endsAt ? endsAt.toISOString() : null, admin, now.toISOString()],
  );
  // invoice subscriptions the box already has join the plan
  const existing = await client.query(
    "SELECT s.id,s.bundle_id,s.copy_number,s.invoice_monthly_cents,b.monthly_price_cents FROM company_os_bundle_subscriptions s JOIN company_os_function_bundles b ON b.id=s.bundle_id WHERE s.tenant_id=$1 AND s.instance_id=$2 AND s.billing_provider=$3 AND s.subscription_state<>'cancelled' AND s.box_plan_id IS NULL",
    [input.tenantId, input.instanceId, INVOICE],
  );
  const joined = [];
  for (const row of existing.rows) {
    const included = await includedInPlan(client, plan.id, row.bundle_id, Number(row.copy_number));
    const cents = included ? 0 : Number(row.invoice_monthly_cents ?? row.monthly_price_cents);
    // the price it had before stays for the months before the plan (they are not rewritten)
    const before = Number(row.invoice_monthly_cents ?? row.monthly_price_cents);
    await client.query("UPDATE company_os_bundle_subscriptions SET box_plan_id=$2,included_in_plan=$3,invoice_monthly_cents=$4,pre_plan_monthly_cents=$7,billing_ends_at=COALESCE(billing_ends_at,$5),updated_at=$6 WHERE id=$1", [row.id, boxPlanId, included, cents, endsAt ? endsAt.toISOString() : null, now.toISOString(), before]);
    joined.push({ subscriptionId: row.id, bundleId: row.bundle_id, includedInPlan: included, monthlyPriceCents: cents });
  }
  // every function the plan includes, not yet held: granted by order at CHF 0
  const functions = await client.query("SELECT bundle_id FROM company_os_plan_functions WHERE plan_id=$1 ORDER BY bundle_id", [plan.id]);
  const granted = [];
  for (const row of functions.rows) {
    if (joined.some((item) => item.bundleId === row.bundle_id && item.includedInPlan)) continue;
    granted.push(await grantSubscriptionByOrder(client, { tenantId: input.tenantId, instanceId: input.instanceId, bundleId: row.bundle_id, startsOn: input.startsOn, endsOn: input.endsOn ?? null, administrator: admin, note: `included in plan ${plan.id}`, now }));
  }
  const result = { boxPlanId, planId: plan.id, planName: plan.name, customerNumber, mark, monthlyPriceCents: monthlyCents, startsAt: startsAt.toISOString(), endsAt: endsAt ? endsAt.toISOString() : null, granted, joined, grantedBy: admin };
  await planAudit(client, "plan_assigned", admin, { tenantId: input.tenantId, instanceId: input.instanceId, planId: plan.id, customerNumber, mark, monthlyPriceCents: monthlyCents, startsAt: result.startsAt, endsAt: result.endsAt, granted: granted.map((item) => item.bundleId), joined: joined.map((item) => item.bundleId), note: input.note ?? null }, { planId: plan.id, boxPlanId }, now);
  return result;
}

/** End a box's plan after a grace, with every invoice subscription on it (the same grace). */
export async function endPlan(client, input) {
  const now = input.now ?? new Date();
  const admin = administrator(input.administrator);
  const graceDays = Number(input.graceDays);
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 366) throw new OrderError("grace_days_invalid", 400);
  const found = await client.query("SELECT * FROM company_os_box_plans WHERE id=$1", [input.boxPlanId]);
  const plan = found.rows[0];
  if (!plan) throw new OrderError("box_plan_not_found", 404);
  if (plan.ended_by) throw new OrderError("box_plan_already_ended");
  let effective = new Date(now.getTime() + graceDays * DAY_MS);
  if (plan.ends_at && new Date(plan.ends_at).getTime() < effective.getTime()) effective = new Date(plan.ends_at);
  const reason = typeof input.reason === "string" && input.reason.trim() ? input.reason.trim().slice(0, 500) : null;
  await client.query("UPDATE company_os_box_plans SET ends_at=$2,ended_by=$3,end_reason=$4 WHERE id=$1", [plan.id, effective.toISOString(), admin, reason]);
  const subscriptions = await client.query("SELECT id FROM company_os_bundle_subscriptions WHERE box_plan_id=$1 AND billing_provider=$2 AND subscription_state<>'cancelled' AND admin_ended_at IS NULL", [plan.id, INVOICE]);
  const ended = [];
  const graceForSubscriptions = Math.max(0, Math.round((effective.getTime() - now.getTime()) / DAY_MS));
  for (const row of subscriptions.rows) ended.push(await endSubscriptionByAdmin(client, { subscriptionId: row.id, graceDays: graceForSubscriptions, administrator: admin, reason: reason ?? `plan ${plan.plan_id} ended`, now }));
  await planAudit(client, "plan_ended", admin, { effectiveAt: effective.toISOString(), graceDays, reason, subscriptions: ended.map((item) => item.subscriptionId) }, { planId: plan.plan_id, boxPlanId: plan.id }, now);
  return { boxPlanId: plan.id, endsAt: effective.toISOString(), endedBy: admin, subscriptions: ended };
}

/** A one-time invoice line for one box and month: an AI top-up (or AI use above the allowance). */
export async function addInvoiceLine(client, input) {
  const now = input.now ?? new Date();
  const admin = administrator(input.administrator);
  const kind = ITEM_KINDS[String(input.kind ?? "")];
  if (!kind) throw new OrderError("invoice_line_kind_invalid", 400);
  const month = parseMonth(input.month);
  const amount = parseChf(input.amountChf, "amount");
  if (amount <= 0) throw new OrderError("amount_invalid", 400);
  const plan = await liveBoxPlan(client, input.tenantId, input.instanceId, month.start) ?? await liveBoxPlan(client, input.tenantId, input.instanceId, now);
  if (!plan) throw new OrderError("box_has_no_plan", 404);
  const description = typeof input.description === "string" && input.description.trim() ? input.description.trim().slice(0, 200) : ITEM_TEXT[kind];
  const id = randomUUID();
  await client.query(
    "INSERT INTO company_os_invoice_items(id,tenant_id,instance_id,box_plan_id,invoice_month,kind,description,amount_cents,currency,created_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
    [id, input.tenantId, input.instanceId, plan.id, month.start.toISOString().slice(0, 10), kind, description, amount, plan.currency, admin, now.toISOString()],
  );
  await planAudit(client, "invoice_line_added", admin, { month: month.label, kind, amountCents: amount, description }, { planId: plan.plan_id, boxPlanId: plan.id }, now);
  return { invoiceLineId: id, month: month.label, kind, description, amountCents: amount, currency: plan.currency };
}

/** The plans with their price steps, workflows, and how many customers count (and what the next one pays). */
export async function planList(client) {
  const plans = (await client.query("SELECT * FROM company_os_plans ORDER BY id")).rows;
  const functions = (await client.query("SELECT plan_id,bundle_id FROM company_os_plan_functions ORDER BY bundle_id")).rows;
  const prices = (await client.query("SELECT plan_id,from_customer,monthly_price_cents FROM company_os_plan_prices ORDER BY from_customer")).rows;
  const out = [];
  for (const plan of plans) {
    const steps = prices.filter((row) => row.plan_id === plan.id);
    const customers = await countingCustomers(client, plan.id);
    out.push({
      id: plan.id, name: plan.name, currency: plan.currency, pricesExcludeVat: plan.prices_exclude_vat, aiAllowanceCents: plan.ai_allowance_cents, freeMonths: plan.free_months,
      includes: plan.includes, status: plan.status, workflows: functions.filter((row) => row.plan_id === plan.id).map((row) => row.bundle_id),
      prices: steps.map((row) => ({ fromCustomer: Number(row.from_customer), monthlyPriceCents: Number(row.monthly_price_cents) })),
      payingCustomers: customers.size, nextCustomerPays: steps.length ? priceFor(steps, customers.size + 1) : null,
    });
  }
  return out;
}

async function vatRateFor(client, monthStart) {
  const r = await client.query("SELECT effective_from,rate_basis_points FROM company_os_vat_rates WHERE effective_from<=$1 ORDER BY effective_from DESC LIMIT 1", [monthStart.toISOString().slice(0, 10)]);
  return r.rows[0] ? Number(r.rows[0].rate_basis_points) : null;
}

/** VAT in cents on an amount, rounded to the cent (half up). */
function vatOn(netCents, basisPoints) {
  return Math.round((netCents * basisPoints) / 10000);
}

function vatText(plan) {
  if (!plan) return "plus VAT";
  return plan.prices_exclude_vat ? "plus VAT" : "VAT included";
}

/**
 * What to invoice for one month, per box: the plan (or CHF 0 in a free month), what it includes,
 * the AI allowance, the functions included at CHF 0, add-ons at their price, one-time lines, and
 * then the net subtotal, the VAT at the rate in force on the month's first day, and the total. A
 * plan or subscription running on any day of the month counts for the whole month (no part
 * months). Free months (if a plan has any) count from the month the plan starts and cover the
 * whole box. Subscriptions billed by a provider (Polar) are not here: the provider invoices them.
 * A box an administrator marked (test, Old School's own) is listed with `invoiced: false`.
 *
 * @param {{ query: Function }} client
 * @param {{ month: string; tenantId?: string | null; instanceId?: string | null }} input
 */
export async function invoiceLines(client, input) {
  const month = parseMonth(input.month);
  const scope = [input.tenantId ?? null, input.instanceId ?? null];
  const scoped = "($1::uuid IS NULL OR tenant_id=$1::uuid) AND ($2::uuid IS NULL OR instance_id=$2::uuid)";
  const plans = (await client.query(`SELECT * FROM company_os_box_plans WHERE ${scoped} ORDER BY created_at`, scope)).rows
    // a period counts only if it is a real one (its end after its start) and touches the month
    .filter((plan) => new Date(plan.starts_at) < month.end && (!plan.ends_at || (new Date(plan.ends_at) > month.start && new Date(plan.ends_at) > new Date(plan.starts_at))));
  const subscriptions = (await client.query(
    `SELECT s.id,s.tenant_id,s.instance_id,s.bundle_id,s.copy_number,s.billing_description,s.subscription_state,s.billing_starts_at,s.entitled_at,s.billing_ends_at,s.cancel_effective_at,s.stopped_at,s.invoice_monthly_cents,s.pre_plan_monthly_cents,s.included_in_plan,s.box_plan_id,s.created_at,b.monthly_price_cents,b.currency FROM company_os_bundle_subscriptions s JOIN company_os_function_bundles b ON b.id=s.bundle_id WHERE s.billing_provider='invoice' AND ($1::uuid IS NULL OR s.tenant_id=$1::uuid) AND ($2::uuid IS NULL OR s.instance_id=$2::uuid) ORDER BY s.created_at`,
    scope,
  )).rows.filter((row) => {
    const start = new Date(row.billing_starts_at ?? row.entitled_at ?? row.created_at);
    const stops = [row.stopped_at, row.subscription_state === "cancel_at_period_end" ? row.cancel_effective_at : null, row.billing_ends_at].filter(Boolean).map((value) => new Date(value).getTime());
    const stop = stops.length ? Math.min(...stops) : null;
    return start < month.end && (stop === null || (stop > month.start.getTime() && stop > start.getTime()));
  });
  const items = (await client.query(`SELECT * FROM company_os_invoice_items WHERE invoice_month=$3 AND ${scoped} ORDER BY created_at`, [...scope, month.start.toISOString().slice(0, 10)])).rows;
  const keys = (await client.query(`SELECT tenant_id,instance_id,label,enrolled_at FROM company_os_instance_keys WHERE ${scoped}`, scope)).rows;
  const marks = (await client.query(`SELECT tenant_id,instance_id,mark FROM company_os_box_marks WHERE ${scoped}`, scope)).rows;
  const markOf = (tenantId, instanceId) => marks.find((row) => row.tenant_id === tenantId && row.instance_id === instanceId)?.mark ?? null;
  const vatBasisPoints = await vatRateFor(client, month.start);
  const boxLabel = (tenantId, instanceId) => keys.filter((key) => key.tenant_id === tenantId && key.instance_id === instanceId && key.label).sort((a, b) => new Date(b.enrolled_at ?? 0).getTime() - new Date(a.enrolled_at ?? 0).getTime())[0]?.label ?? "";

  const boxes = new Map();
  const boxOf = (tenantId, instanceId) => {
    const key = `${tenantId}/${instanceId}`;
    if (!boxes.has(key)) boxes.set(key, { tenantId, instanceId, plans: [], subscriptions: [], items: [] });
    return boxes.get(key);
  };
  for (const plan of plans) boxOf(plan.tenant_id, plan.instance_id).plans.push(plan);
  for (const row of subscriptions) boxOf(row.tenant_id, row.instance_id).subscriptions.push(row);
  for (const item of items) boxOf(item.tenant_id, item.instance_id).items.push(item);

  const lines = [];
  for (const box of boxes.values()) {
    // every plan that ran in the month is invoiced (a change of plan bills both); free months are
    // each plan's own and cover that plan's add-ons only
    const latest = box.plans.at(-1) ?? null;
    const currency = latest?.currency ?? box.subscriptions[0]?.currency ?? box.items[0]?.currency ?? "chf";
    const mark = markOf(box.tenantId, box.instanceId);
    const base = { month: month.label, tenantId: box.tenantId, instanceId: box.instanceId, box: boxLabel(box.tenantId, box.instanceId), plan: latest?.plan_name ?? "", currency, vat: vatText(latest), invoiced: !mark };
    const add = (line, description, amountCents, note = "") => lines.push({ ...base, line, description, amountCents, note });
    const freeNoteOf = new Map();
    for (const plan of box.plans) {
      const index = monthsFrom(plan.starts_at, month.start);
      if (index < Number(plan.free_months)) freeNoteOf.set(plan.id, `free month ${index + 1} of ${plan.free_months}`);
    }
    // charges are summed by VAT basis: prices before VAT, and prices with VAT included
    const sums = { exclusive: 0, inclusive: 0 };
    const planById = new Map(box.plans.map((plan) => [plan.id, plan]));
    const charge = (cents, planId) => {
      const plan = planId ? planById.get(planId) : null;
      if (plan && plan.prices_exclude_vat === false) sums.inclusive += cents;
      else sums.exclusive += cents;
    };
    if (!box.plans.length) add("no_plan", "No plan on this box", 0, "add-ons only");
    for (const plan of box.plans) {
      const free = freeNoteOf.get(plan.id);
      const price = free ? 0 : Number(plan.monthly_price_cents);
      charge(price, plan.id);
      add("plan", `${plan.plan_name}, monthly`, price, free ?? "");
      const includes = Array.isArray(plan.includes) ? plan.includes : [];
      if (includes.length) add("plan_includes", `Includes: ${includes.join("; ")}`, 0, "included in your plan");
      if (Number(plan.ai_allowance_cents) > 0) add("ai_allowance", `AI use up to ${currency.toUpperCase()} ${money(Number(plan.ai_allowance_cents))} per month`, 0, "included in your plan");
    }
    const planIds = new Set(box.plans.map((plan) => plan.id));
    const included = [];
    const addOns = [];
    for (const row of box.subscriptions) {
      if (row.box_plan_id && planIds.has(row.box_plan_id)) {
        if (row.included_in_plan) included.push(row);
        else addOns.push({ row, cents: Number(row.invoice_monthly_cents ?? row.monthly_price_cents), free: freeNoteOf.get(row.box_plan_id), planId: row.box_plan_id });
      } else {
        // a month outside its plan: the price it had without the plan (never "included")
        const cents = row.pre_plan_monthly_cents ?? (row.included_in_plan ? row.monthly_price_cents : (row.invoice_monthly_cents ?? row.monthly_price_cents));
        addOns.push({ row, cents: Number(cents), free: undefined, planId: null });
      }
    }
    for (const row of included) add("included_function", row.billing_description, 0, "included in your plan");
    for (const { row, cents, free, planId } of addOns) {
      const price = free ? 0 : cents;
      charge(price, planId);
      add("add_on", row.billing_description, price, free ?? "add-on, list price");
    }
    for (const item of box.items) {
      // a one-time line follows the VAT basis of the plan it was added under
      charge(Number(item.amount_cents), planById.has(item.box_plan_id) ? item.box_plan_id : latest?.id ?? null);
      add(item.kind, item.description, Number(item.amount_cents), "one-time");
    }
    // net, VAT and total: prices before VAT get the VAT on top; prices with VAT have it taken out
    if (vatBasisPoints === null) throw new OrderError(`vat_rate_missing_for:${month.label}`, 409);
    const rate = `${vatBasisPoints / 100}%`;
    const vatIncluded = sums.inclusive - Math.round((sums.inclusive * 10000) / (10000 + vatBasisPoints));
    const vat = vatOn(sums.exclusive, vatBasisPoints) + vatIncluded;
    const net = sums.exclusive + sums.inclusive - vatIncluded;
    const notInvoiced = mark ? `not invoiced: ${MARK_TEXT[mark]}` : "";
    add("subtotal", `Subtotal ${month.label}, net`, net, notInvoiced);
    add("vat", `VAT ${rate}`, vat, notInvoiced);
    add("total", `Total ${month.label}`, net + vat, notInvoiced);
  }
  return lines;
}

const CSV_COLUMNS = ["month", "box", "tenant_id", "instance_id", "plan", "line", "description", "amount", "currency", "vat", "note"];

function csvCell(value) {
  const text = String(value ?? "");
  // a cell that a spreadsheet would read as a formula is kept as text
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The lines as CSV, one row per line, amounts in francs with two decimals; marked boxes only when asked. */
export function invoiceCsv(lines, options = {}) {
  const rows = [CSV_COLUMNS.join(",")];
  for (const line of lines.filter((item) => item.invoiced || options.includeNotInvoiced)) rows.push([line.month, line.box, line.tenantId, line.instanceId, line.plan, line.line, line.description, money(line.amountCents), line.currency.toUpperCase(), line.vat, line.note].map(csvCell).join(","));
  return `${rows.join("\n")}\n`;
}

/** What the box shows on its Plan and costs page: its plan's terms and the month's lines (the same ones Old School invoices). */
export async function boxPlanView(client, input) {
  const now = input.now ?? new Date();
  const month = input.month ?? currentMonth(now);
  const plan = await liveBoxPlan(client, input.tenantId, input.instanceId, now);
  const lines = (await invoiceLines(client, { month, tenantId: input.tenantId, instanceId: input.instanceId })).map(({ tenantId: _tenant, instanceId: _instance, ...line }) => line);
  const workflows = plan ? (await client.query("SELECT f.bundle_id,b.name FROM company_os_plan_functions f JOIN company_os_function_bundles b ON b.id=f.bundle_id WHERE f.plan_id=$1 ORDER BY b.name", [plan.plan_id])).rows.map((row) => ({ bundleId: row.bundle_id, name: row.name })) : [];
  return {
    month,
    plan: plan
      ? {
          planId: plan.plan_id, name: plan.plan_name, monthlyPriceCents: Number(plan.monthly_price_cents), currency: plan.currency, pricesExcludeVat: plan.prices_exclude_vat,
          aiAllowanceCents: Number(plan.ai_allowance_cents), freeMonths: Number(plan.free_months), includes: plan.includes,
          startsAt: new Date(plan.starts_at).toISOString(), endsAt: plan.ends_at ? new Date(plan.ends_at).toISOString() : null,
          workflows,
        }
      : null,
    lines,
    netCents: lines.find((line) => line.line === "subtotal")?.amountCents ?? 0,
    vatCents: lines.find((line) => line.line === "vat")?.amountCents ?? 0,
    totalCents: lines.find((line) => line.line === "total")?.amountCents ?? 0,
  };
}
