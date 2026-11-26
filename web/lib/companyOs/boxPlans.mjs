// ST1 plans: what Old School invoices per box, and what the box shows on its Plan and costs
// page. A plan is data the CEO enters (name, monthly price, what it includes, the AI allowance,
// free months, prices with or without VAT, the functions it includes at CHF 0, and for an early-
// bird plan how many boxes may hold it). A box's plan keeps the terms it was given; a later change
// of the plan applies to boxes that get it afterwards.
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

/**
 * Define a plan, or change it (for boxes that get it afterwards). Every value is given: nothing
 * is assumed by code.
 *
 * @param {{ query: Function }} client
 * @param {{ id: string; name: string; monthlyChf: string; currency?: string; pricesExcludeVat: boolean; aiAllowanceChf: string; freeMonths: number; includes: string[]; earlyBird: boolean; boxLimit?: number | null; administrator: string }} input
 */
export async function definePlan(client, input) {
  const admin = administrator(input.administrator);
  if (!SLUG.test(String(input.id ?? ""))) throw new OrderError("plan_id_invalid", 400);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 120) throw new OrderError("plan_name_invalid", 400);
  const monthly = parseChf(input.monthlyChf, "monthly_price");
  const allowance = parseChf(input.aiAllowanceChf, "ai_allowance");
  const currency = String(input.currency ?? "chf").trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new OrderError("currency_invalid", 400);
  if (typeof input.pricesExcludeVat !== "boolean") throw new OrderError("prices_exclude_vat_required", 400);
  const freeMonths = Number(input.freeMonths);
  if (!Number.isInteger(freeMonths) || freeMonths < 0 || freeMonths > 24) throw new OrderError("free_months_invalid", 400);
  const includes = (input.includes ?? []).map((item) => String(item).trim()).filter(Boolean);
  if (!includes.length || includes.length > 20 || includes.some((item) => item.length > 200)) throw new OrderError("includes_invalid", 400);
  const boxLimit = input.boxLimit === undefined || input.boxLimit === null ? null : Number(input.boxLimit);
  if (boxLimit !== null && (!Number.isInteger(boxLimit) || boxLimit < 1)) throw new OrderError("box_limit_invalid", 400);
  if (input.earlyBird && boxLimit === null) throw new OrderError("early_bird_needs_box_limit", 400);
  await client.query(
    "INSERT INTO company_os_plans(id,name,monthly_price_cents,currency,prices_exclude_vat,ai_allowance_cents,free_months,includes,early_bird,box_limit,status,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,monthly_price_cents=EXCLUDED.monthly_price_cents,currency=EXCLUDED.currency,prices_exclude_vat=EXCLUDED.prices_exclude_vat,ai_allowance_cents=EXCLUDED.ai_allowance_cents,free_months=EXCLUDED.free_months,includes=EXCLUDED.includes,early_bird=EXCLUDED.early_bird,box_limit=EXCLUDED.box_limit,status='active',updated_by=EXCLUDED.updated_by,updated_at=now()",
    [input.id, name, monthly, currency, input.pricesExcludeVat, allowance, freeMonths, JSON.stringify(includes), Boolean(input.earlyBird), boxLimit, admin],
  );
  const plan = { id: input.id, name, monthlyPriceCents: monthly, currency, pricesExcludeVat: input.pricesExcludeVat, aiAllowanceCents: allowance, freeMonths, includes, earlyBird: Boolean(input.earlyBird), boxLimit };
  await planAudit(client, "plan_defined", admin, plan, { planId: input.id });
  return plan;
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
 * Give a box a plan: the plan's terms are kept on the box, every function the plan includes is
 * granted by order at CHF 0 ("included in your plan"), and invoice subscriptions the box already
 * has join the plan (included ones at CHF 0, others as add-ons at their price). An early-bird
 * plan is refused once as many boxes have held it as its limit allows.
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
  // the plan row is locked while boxes are counted, so two grants cannot both take the last place
  const found = await client.query("SELECT * FROM company_os_plans WHERE id=$1 FOR UPDATE", [input.planId]);
  const plan = found.rows[0];
  if (!plan) throw new OrderError("plan_not_found", 404);
  if (plan.status !== "active") throw new OrderError("plan_retired");
  const live = await liveBoxPlan(client, input.tenantId, input.instanceId, now);
  if (live) throw new OrderError(`box_has_a_plan:${live.id}:${live.plan_id}`);
  if (plan.box_limit !== null && plan.box_limit !== undefined) {
    const held = await client.query("SELECT tenant_id,instance_id FROM company_os_box_plans WHERE plan_id=$1", [plan.id]);
    const boxes = new Set(held.rows.map((row) => `${row.tenant_id}/${row.instance_id}`));
    if (!boxes.has(`${input.tenantId}/${input.instanceId}`) && boxes.size >= Number(plan.box_limit)) throw new OrderError(`plan_limit_reached:${boxes.size}/${plan.box_limit}`);
  }
  const boxPlanId = randomUUID();
  await client.query(
    "INSERT INTO company_os_box_plans(id,tenant_id,instance_id,plan_id,plan_name,monthly_price_cents,currency,prices_exclude_vat,ai_allowance_cents,free_months,includes,early_bird,starts_at,ends_at,granted_by,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
    [boxPlanId, input.tenantId, input.instanceId, plan.id, plan.name, plan.monthly_price_cents, plan.currency, plan.prices_exclude_vat, plan.ai_allowance_cents, plan.free_months, JSON.stringify(plan.includes), plan.early_bird, startsAt.toISOString(), endsAt ? endsAt.toISOString() : null, admin, now.toISOString()],
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
    await client.query("UPDATE company_os_bundle_subscriptions SET box_plan_id=$2,included_in_plan=$3,invoice_monthly_cents=$4,billing_ends_at=COALESCE(billing_ends_at,$5),updated_at=$6 WHERE id=$1", [row.id, boxPlanId, included, cents, endsAt ? endsAt.toISOString() : null, now.toISOString()]);
    joined.push({ subscriptionId: row.id, bundleId: row.bundle_id, includedInPlan: included, monthlyPriceCents: cents });
  }
  // every function the plan includes, not yet held: granted by order at CHF 0
  const functions = await client.query("SELECT bundle_id FROM company_os_plan_functions WHERE plan_id=$1 ORDER BY bundle_id", [plan.id]);
  const granted = [];
  for (const row of functions.rows) {
    if (joined.some((item) => item.bundleId === row.bundle_id && item.includedInPlan)) continue;
    granted.push(await grantSubscriptionByOrder(client, { tenantId: input.tenantId, instanceId: input.instanceId, bundleId: row.bundle_id, startsOn: input.startsOn, endsOn: input.endsOn ?? null, administrator: admin, note: `included in plan ${plan.id}`, now }));
  }
  const result = { boxPlanId, planId: plan.id, planName: plan.name, earlyBird: plan.early_bird, startsAt: startsAt.toISOString(), endsAt: endsAt ? endsAt.toISOString() : null, granted, joined, grantedBy: admin };
  await planAudit(client, "plan_assigned", admin, { tenantId: input.tenantId, instanceId: input.instanceId, planId: plan.id, startsAt: result.startsAt, endsAt: result.endsAt, granted: granted.map((item) => item.bundleId), joined: joined.map((item) => item.bundleId), note: input.note ?? null }, { planId: plan.id, boxPlanId }, now);
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

/** The plans with how many boxes hold one now and how many ever got it (the early-bird count). */
export async function planList(client, now = new Date()) {
  const plans = (await client.query("SELECT * FROM company_os_plans ORDER BY id")).rows;
  const held = (await client.query("SELECT plan_id,tenant_id,instance_id,ends_at FROM company_os_box_plans")).rows;
  const functions = (await client.query("SELECT plan_id,bundle_id FROM company_os_plan_functions ORDER BY bundle_id")).rows;
  return plans.map((plan) => {
    const rows = held.filter((row) => row.plan_id === plan.id);
    const ever = new Set(rows.map((row) => `${row.tenant_id}/${row.instance_id}`)).size;
    const holding = new Set(rows.filter((row) => !row.ends_at || new Date(row.ends_at) > now).map((row) => `${row.tenant_id}/${row.instance_id}`)).size;
    return {
      id: plan.id, name: plan.name, monthlyPriceCents: plan.monthly_price_cents, currency: plan.currency, pricesExcludeVat: plan.prices_exclude_vat,
      aiAllowanceCents: plan.ai_allowance_cents, freeMonths: plan.free_months, includes: plan.includes, earlyBird: plan.early_bird, status: plan.status,
      includedFunctions: functions.filter((row) => row.plan_id === plan.id).map((row) => row.bundle_id),
      boxLimit: plan.box_limit ?? null, boxesHolding: holding, boxesEver: ever, placesLeft: plan.box_limit ? Math.max(0, Number(plan.box_limit) - ever) : null,
    };
  });
}

function vatText(plan) {
  if (!plan) return "";
  return plan.prices_exclude_vat ? "excl. VAT" : "incl. VAT";
}

/**
 * What to invoice for one month, per box: the plan (or CHF 0 in a free month), what it includes,
 * the AI allowance, the functions included at CHF 0, add-ons at their price, one-time lines, and
 * a total. A plan or subscription running on any day of the month counts for the whole month (no
 * part months). Free months count from the month the plan starts and cover the whole box.
 * Subscriptions billed by a provider (Polar) are not here: the provider invoices them.
 *
 * @param {{ query: Function }} client
 * @param {{ month: string; tenantId?: string | null; instanceId?: string | null }} input
 */
export async function invoiceLines(client, input) {
  const month = parseMonth(input.month);
  const scope = [input.tenantId ?? null, input.instanceId ?? null];
  const scoped = "($1::uuid IS NULL OR tenant_id=$1::uuid) AND ($2::uuid IS NULL OR instance_id=$2::uuid)";
  const plans = (await client.query(`SELECT * FROM company_os_box_plans WHERE ${scoped} ORDER BY created_at`, scope)).rows
    .filter((plan) => new Date(plan.starts_at) < month.end && (!plan.ends_at || new Date(plan.ends_at) > month.start));
  const subscriptions = (await client.query(
    `SELECT s.id,s.tenant_id,s.instance_id,s.bundle_id,s.copy_number,s.billing_description,s.subscription_state,s.billing_starts_at,s.entitled_at,s.billing_ends_at,s.cancel_effective_at,s.stopped_at,s.invoice_monthly_cents,s.included_in_plan,s.box_plan_id,s.created_at,b.monthly_price_cents,b.currency FROM company_os_bundle_subscriptions s JOIN company_os_function_bundles b ON b.id=s.bundle_id WHERE s.billing_provider='invoice' AND ($1::uuid IS NULL OR s.tenant_id=$1::uuid) AND ($2::uuid IS NULL OR s.instance_id=$2::uuid) ORDER BY s.created_at`,
    scope,
  )).rows.filter((row) => {
    const start = new Date(row.billing_starts_at ?? row.entitled_at ?? row.created_at);
    const stops = [row.stopped_at, row.subscription_state === "cancel_at_period_end" ? row.cancel_effective_at : null, row.billing_ends_at].filter(Boolean).map((value) => new Date(value).getTime());
    const stop = stops.length ? Math.min(...stops) : null;
    return start < month.end && (stop === null || stop > month.start.getTime());
  });
  const items = (await client.query(`SELECT * FROM company_os_invoice_items WHERE invoice_month=$3 AND ${scoped} ORDER BY created_at`, [...scope, month.start.toISOString().slice(0, 10)])).rows;
  const keys = (await client.query(`SELECT tenant_id,instance_id,label,enrolled_at FROM company_os_instance_keys WHERE ${scoped}`, scope)).rows;
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
    const plan = box.plans.at(-1) ?? null;
    const index = plan ? monthsFrom(plan.starts_at, month.start) : null;
    const free = plan !== null && index !== null && index < Number(plan.free_months);
    const currency = plan?.currency ?? box.subscriptions[0]?.currency ?? box.items[0]?.currency ?? "chf";
    const base = { month: month.label, tenantId: box.tenantId, instanceId: box.instanceId, box: boxLabel(box.tenantId, box.instanceId), plan: plan?.plan_name ?? "", currency, vat: vatText(plan) };
    const freeNote = free ? `free month ${index + 1} of ${plan.free_months}` : "";
    const add = (line, description, amountCents, note = "") => lines.push({ ...base, line, description, amountCents, note });
    let total = 0;
    if (plan) {
      const price = free ? 0 : Number(plan.monthly_price_cents);
      total += price;
      add("plan", `${plan.plan_name}, monthly`, price, free ? freeNote : (plan.early_bird ? "early-bird price" : ""));
      const includes = Array.isArray(plan.includes) ? plan.includes : [];
      if (includes.length) add("plan_includes", `Includes: ${includes.join("; ")}`, 0, "included in your plan");
      if (Number(plan.ai_allowance_cents) > 0) add("ai_allowance", `AI use up to ${currency.toUpperCase()} ${money(Number(plan.ai_allowance_cents))} per month`, 0, "included in your plan");
    } else {
      add("no_plan", "No plan on this box", 0, "add-ons only");
    }
    for (const row of box.subscriptions.filter((item) => item.included_in_plan)) add("included_function", row.billing_description, 0, "included in your plan");
    for (const row of box.subscriptions.filter((item) => !item.included_in_plan)) {
      const listPrice = Number(row.invoice_monthly_cents ?? row.monthly_price_cents);
      const price = free ? 0 : listPrice;
      total += price;
      add("add_on", row.billing_description, price, free ? freeNote : "add-on, list price");
    }
    for (const item of box.items) {
      total += Number(item.amount_cents);
      add(item.kind, item.description, Number(item.amount_cents), "one-time");
    }
    add("total", `Total ${month.label}`, total, base.vat);
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

/** The lines as CSV, one row per line, amounts in francs with two decimals. */
export function invoiceCsv(lines) {
  const rows = [CSV_COLUMNS.join(",")];
  for (const line of lines) rows.push([line.month, line.box, line.tenantId, line.instanceId, line.plan, line.line, line.description, money(line.amountCents), line.currency.toUpperCase(), line.vat, line.note].map(csvCell).join(","));
  return `${rows.join("\n")}\n`;
}

/** What the box shows on its Plan and costs page: its plan's terms and the month's lines (the same ones Old School invoices). */
export async function boxPlanView(client, input) {
  const now = input.now ?? new Date();
  const month = input.month ?? currentMonth(now);
  const plan = await liveBoxPlan(client, input.tenantId, input.instanceId, now);
  const lines = (await invoiceLines(client, { month, tenantId: input.tenantId, instanceId: input.instanceId })).map(({ tenantId: _tenant, instanceId: _instance, ...line }) => line);
  return {
    month,
    plan: plan
      ? {
          planId: plan.plan_id, name: plan.plan_name, monthlyPriceCents: Number(plan.monthly_price_cents), currency: plan.currency, pricesExcludeVat: plan.prices_exclude_vat,
          aiAllowanceCents: Number(plan.ai_allowance_cents), freeMonths: Number(plan.free_months), includes: plan.includes, earlyBird: plan.early_bird,
          startsAt: new Date(plan.starts_at).toISOString(), endsAt: plan.ends_at ? new Date(plan.ends_at).toISOString() : null,
        }
      : null,
    lines,
    totalCents: lines.find((line) => line.line === "total")?.amountCents ?? 0,
  };
}
