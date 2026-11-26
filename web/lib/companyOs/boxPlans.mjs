// ST1 plans: what Old School invoices per box, and what the box shows on its Plan and costs
// page. The CEO's final structure; every price is data. Per box and month, all plus VAT:
//   - the box line (the plan's box price); a customer on own hardware (device or server) has none;
//   - each workflow at its list price, each with the AI provider allowance in USD it includes
//     (the allowances of a box's workflows add up); a box always has at least one workflow;
//   - each single agent at its list price, with no allowance of its own (it uses the box's pool);
//     an agent's price never exceeds a workflow's;
//   - for the first customers by customer number (early bird), a discount line on the first
//     workflow, kept for as long as the customer stays;
//   - one-time top-ups in CHF that add USD allowance at the plan's rate.
// Nothing is priced per person: a workflow or agent is priced per box, whatever the number of users.
// A box keeps the prices, terms and workflows it was given; only boxes an administrator has not
// marked (test boxes, Old School's own) count as customers.
//
// One function (invoiceLines) builds a month's lines; the admin command prints them as CSV and the
// store answers the box with the same lines, so both always agree.
//
// Plain JavaScript on purpose: the admin command runs with node and no build step. No billing
// provider is reached from here.
import { randomUUID } from "node:crypto";
import { administrator, applyDueSubscriptionDates, endSubscriptionByAdmin, grantSubscriptionByOrder, INVOICE, liveBoxPlan, OrderError, parseOrderDate, workflowsCoveringPlan } from "./subscriptionOrders.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const ITEM_KINDS = { "ai-top-up": "ai_top_up", "ai-use-above-allowance": "ai_use_above_allowance" };
const ITEM_TEXT = { ai_top_up: "AI top-up", ai_use_above_allowance: "AI use above the allowance" };
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

/** The start of a UTC calendar day, in ms. Periods are counted in whole days: a day belongs to a period from the day it starts, up to the day it ends (that day not included). */
function dayStart(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Whole days of [start, stop) inside the month (stop null: open). */
function daysWithin(month, start, stop) {
  const from = Math.max(dayStart(start), month.start.getTime());
  const to = Math.min(stop === null ? month.end.getTime() : dayStart(stop), month.end.getTime());
  return Math.max(0, Math.round((to - from) / DAY_MS));
}

function daysInMonth(month) {
  return Math.round((month.end.getTime() - month.start.getTime()) / DAY_MS);
}

/** A monthly price for some days of the month: price x days / days in the month, rounded to the cent. */
function forDays(cents, days, total) {
  return days >= total ? cents : Math.round((cents * days) / total);
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

/** A percentage as typed ("50", "12.5") into basis points (5000, 1250), 0 to 100. */
function parsePercent(value, field) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(text)) throw new OrderError(`${field}_invalid`, 400);
  const [whole, fraction = ""] = text.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (basisPoints > 10000) throw new OrderError(`${field}_invalid`, 400);
  return basisPoints;
}

/**
 * Define a plan, or change it (for boxes that get it afterwards). Every value is given: nothing
 * is assumed by code. The plan's name is the box line's name ("Truchsess box"); `boxChf` is the box
 * price; the early bird is a discount (percent) on the first workflow for customers 1 to
 * `earlyBirdCustomers`; `topUpUsdPerChf` is the USD allowance one CHF of a top-up buys.
 *
 * @param {{ query: Function }} client
 * @param {{ id: string; name: string; boxChf: string; earlyBirdCustomers: number; earlyBirdPercent: string; earlyBirdNote?: string | null; topUpUsdPerChf: string; currency?: string; pricesExcludeVat: boolean; freeMonths: number; includes: string[]; administrator: string }} input
 */
export async function definePlan(client, input) {
  const admin = administrator(input.administrator);
  if (!SLUG.test(String(input.id ?? ""))) throw new OrderError("plan_id_invalid", 400);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 120) throw new OrderError("plan_name_invalid", 400);
  const boxCents = parseChf(input.boxChf, "box_price");
  const earlyBirdCustomers = Number(input.earlyBirdCustomers);
  if (!Number.isInteger(earlyBirdCustomers) || earlyBirdCustomers < 0 || earlyBirdCustomers > 100000) throw new OrderError("early_bird_customers_invalid", 400);
  const earlyBirdBp = parsePercent(input.earlyBirdPercent, "early_bird_percent");
  const earlyBirdNote = typeof input.earlyBirdNote === "string" && input.earlyBirdNote.trim() ? input.earlyBirdNote.trim() : null;
  if (earlyBirdNote !== null && earlyBirdNote.length > 60) throw new OrderError("early_bird_note_invalid", 400);
  if (earlyBirdCustomers > 0 && earlyBirdBp > 0 && earlyBirdNote === null) throw new OrderError("early_bird_note_required", 400);
  // USD cents per CHF 1.00, e.g. "1" (USD 1.00 per CHF 1.00)
  const topUpRate = parseChf(input.topUpUsdPerChf, "top_up_usd_per_chf");
  const currency = String(input.currency ?? "chf").trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new OrderError("currency_invalid", 400);
  if (typeof input.pricesExcludeVat !== "boolean") throw new OrderError("prices_exclude_vat_required", 400);
  const freeMonths = Number(input.freeMonths);
  if (!Number.isInteger(freeMonths) || freeMonths < 0 || freeMonths > 24) throw new OrderError("free_months_invalid", 400);
  const includes = (input.includes ?? []).map((item) => String(item).trim()).filter(Boolean);
  if (!includes.length || includes.length > 20 || includes.some((item) => item.length > 200)) throw new OrderError("includes_invalid", 400);
  await client.query(
    "INSERT INTO company_os_plans(id,name,currency,prices_exclude_vat,box_price_cents,early_bird_customers,early_bird_discount_bp,early_bird_note,top_up_usd_cents_per_chf,free_months,includes,status,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,currency=EXCLUDED.currency,prices_exclude_vat=EXCLUDED.prices_exclude_vat,box_price_cents=EXCLUDED.box_price_cents,early_bird_customers=EXCLUDED.early_bird_customers,early_bird_discount_bp=EXCLUDED.early_bird_discount_bp,early_bird_note=EXCLUDED.early_bird_note,top_up_usd_cents_per_chf=EXCLUDED.top_up_usd_cents_per_chf,free_months=EXCLUDED.free_months,includes=EXCLUDED.includes,status='active',updated_by=EXCLUDED.updated_by,updated_at=now()",
    [input.id, name, currency, input.pricesExcludeVat, boxCents, earlyBirdCustomers, earlyBirdBp, earlyBirdNote, topUpRate, freeMonths, JSON.stringify(includes), admin],
  );
  const plan = { id: input.id, name, boxPriceCents: boxCents, earlyBird: { customers: earlyBirdCustomers, discountBasisPoints: earlyBirdBp, note: earlyBirdNote }, topUpUsdCentsPerChf: topUpRate, currency, pricesExcludeVat: input.pricesExcludeVat, freeMonths, includes };
  await planAudit(client, "plan_defined", admin, plan, { planId: input.id });
  return plan;
}

/**
 * A function bundle's kind: a workflow (with the USD AI allowance it includes) or a single agent
 * (no allowance; it uses the box's pool). Checked with the whole catalog afterwards.
 */
export async function setBundleKind(client, input) {
  const admin = administrator(input.administrator);
  if (!["workflow", "agent"].includes(String(input.kind))) throw new OrderError("bundle_kind_invalid", 400);
  const allowance = input.kind === "agent" ? 0 : parseChf(input.aiAllowanceUsd, "ai_allowance_usd");
  if (input.kind === "agent" && input.aiAllowanceUsd !== undefined && input.aiAllowanceUsd !== null && parseChf(input.aiAllowanceUsd, "ai_allowance_usd") > 0) throw new OrderError("agent_has_no_ai_allowance", 400);
  const updated = await client.query("UPDATE company_os_function_bundles SET kind=$2,ai_allowance_usd_cents=$3,updated_at=now() WHERE id=$1 RETURNING id", [input.bundleId, input.kind, allowance]);
  if (!updated.rowCount) throw new OrderError("bundle_not_found", 404);
  await assertCatalogPrices(client);
  await planAudit(client, "plan_function_changed", admin, { bundleId: input.bundleId, kind: input.kind, aiAllowanceUsdCents: allowance });
  return { bundleId: input.bundleId, kind: input.kind, aiAllowanceUsdCents: allowance };
}

/**
 * The catalog's price rules: an agent's price never exceeds a workflow's (the lowest active
 * workflow price in the same currency), and an agent has no AI allowance of its own. Run after
 * every change of a bundle's price or kind; the admin command's transaction undoes a breach.
 */
export async function assertCatalogPrices(client) {
  const rows = (await client.query("SELECT id,kind,monthly_price_cents,currency,ai_allowance_usd_cents FROM company_os_function_bundles WHERE status='active'")).rows;
  for (const agent of rows.filter((row) => row.kind === "agent")) {
    if (Number(agent.ai_allowance_usd_cents) > 0) throw new OrderError(`agent_has_no_ai_allowance:${agent.id}`, 409);
    const workflows = rows.filter((row) => row.kind === "workflow" && row.currency === agent.currency).map((row) => Number(row.monthly_price_cents));
    if (workflows.length && Number(agent.monthly_price_cents) > Math.min(...workflows)) throw new OrderError(`agent_price_above_workflow_price:${agent.id}:${agent.monthly_price_cents}:${Math.min(...workflows)}`, 409);
  }
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

/**
 * The boxes that count as paying customers of a plan: every box that held it and carries no
 * mark, with its customer number. The next customer gets the highest of these numbers plus one,
 * so a number is never given twice while its box counts (a box marked later leaves a gap).
 */
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

function nextCustomerNumber(customers) {
  return customers.size ? Math.max(...customers.values()) + 1 : 1;
}

/**
 * A workflow granted with the plan (by order, at its list price), or taken out of the plan (for
 * boxes that get the plan afterwards). No minimum number of workflows is set here.
 */
export async function setPlanFunction(client, input) {
  const admin = administrator(input.administrator);
  const plan = await client.query("SELECT id,currency FROM company_os_plans WHERE id=$1", [input.planId]);
  if (!plan.rowCount) throw new OrderError("plan_not_found", 404);
  const bundle = await client.query("SELECT id,currency FROM company_os_function_bundles WHERE id=$1", [input.bundleId]);
  if (!bundle.rowCount) throw new OrderError("bundle_not_found", 404);
  if (input.granted && String(bundle.rows[0].currency) !== String(plan.rows[0].currency)) throw new OrderError(`granted_workflow_currency_differs_from_plan:${bundle.rows[0].currency}:${plan.rows[0].currency}`);
  if (input.granted) await client.query("INSERT INTO company_os_plan_functions(plan_id,bundle_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [input.planId, input.bundleId]);
  else await client.query("DELETE FROM company_os_plan_functions WHERE plan_id=$1 AND bundle_id=$2", [input.planId, input.bundleId]);
  await planAudit(client, "plan_function_changed", admin, { bundleId: input.bundleId, granted: Boolean(input.granted) }, { planId: input.planId });
  return { planId: input.planId, bundleId: input.bundleId, granted: Boolean(input.granted) };
}

/**
 * Give a box a plan. A box that counts (no administrator's mark; boxes and own-hardware customers
 * alike) gets the next customer number of the plan; the first `early_bird_customers` numbers get
 * the early-bird discount on the first workflow. The box keeps its box price, discount and terms
 * (a box that held the plan before gets its old number and terms back). A marked box gets no
 * number: it is shown the terms the next customer would get and is never invoiced. On own
 * hardware there is no box line. The plan's workflows are granted by order at their list price;
 * invoice subscriptions the box already has join the plan at the price they have. A box always
 * has at least one workflow.
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
  const ownHardware = input.ownHardware === true;
  // the box's row first, then the plan's: two assignments on one box (also of different plans) run one after the other
  const box = await client.query("SELECT 1 FROM company_os_instance_keys WHERE tenant_id=$1 AND instance_id=$2 AND revoked_at IS NULL FOR UPDATE", [input.tenantId, input.instanceId]);
  if (!box.rowCount) throw new OrderError("box_not_enrolled", 404);
  // the plan row is locked while customers are counted, so two boxes cannot get the same number
  const found = await client.query("SELECT * FROM company_os_plans WHERE id=$1 FOR UPDATE", [input.planId]);
  const plan = found.rows[0];
  if (!plan) throw new OrderError("plan_not_found", 404);
  if (plan.status !== "active") throw new OrderError("plan_retired");
  const live = await liveBoxPlan(client, input.tenantId, input.instanceId, now);
  if (live) throw new OrderError(`box_has_a_plan:${live.id}:${live.plan_id}`);
  // one currency per box: invoices never add up amounts in different currencies
  const otherCurrency = await client.query(
    "SELECT currency FROM company_os_box_plans WHERE tenant_id=$1 AND instance_id=$2 AND currency<>$3 UNION ALL SELECT COALESCE(s.invoice_currency,b.currency) FROM company_os_bundle_subscriptions s JOIN company_os_function_bundles b ON b.id=s.bundle_id WHERE s.tenant_id=$1 AND s.instance_id=$2 AND s.billing_provider='invoice' AND COALESCE(s.invoice_currency,b.currency)<>$3",
    [input.tenantId, input.instanceId, plan.currency],
  );
  if (otherCurrency.rowCount) throw new OrderError(`box_currency_differs_from_plan:${otherCurrency.rows[0].currency}:${plan.currency}`);
  const mark = await boxMark(client, input.tenantId, input.instanceId);
  const customers = await countingCustomers(client, plan.id);
  const key = `${input.tenantId}/${input.instanceId}`;
  const customerNumber = mark ? null : (customers.get(key) ?? nextCustomerNumber(customers));
  // a returning customer keeps the terms it had with its number; only a new number takes today's
  const earlier = customerNumber === null ? null : (await client.query("SELECT monthly_price_cents,own_hardware,early_bird_discount_bp,early_bird_note FROM company_os_box_plans WHERE plan_id=$1 AND tenant_id=$2 AND instance_id=$3 AND customer_number=$4 ORDER BY created_at LIMIT 1", [plan.id, input.tenantId, input.instanceId, customerNumber])).rows[0];
  const number = customerNumber ?? nextCustomerNumber(customers);
  const earlyBird = earlier ? Number(earlier.early_bird_discount_bp) > 0 : number <= Number(plan.early_bird_customers) && Number(plan.early_bird_discount_bp) > 0;
  const discountBp = earlier ? Number(earlier.early_bird_discount_bp) : (earlyBird ? Number(plan.early_bird_discount_bp) : 0);
  const discountNote = earlier ? (earlier.early_bird_note ?? null) : (earlyBird ? plan.early_bird_note : null);
  const boxCents = ownHardware ? 0 : (earlier && !earlier.own_hardware ? Number(earlier.monthly_price_cents) : Number(plan.box_price_cents));
  const boxPlanId = randomUUID();
  // the workflows the plan grants today are this box's, kept like its terms
  // workflows first: an agent rides on a box's workflows
  const grantedBundles = (await client.query("SELECT f.bundle_id,b.kind FROM company_os_plan_functions f JOIN company_os_function_bundles b ON b.id=f.bundle_id WHERE f.plan_id=$1", [plan.id])).rows
    .sort((a, b) => (a.kind === "workflow" ? 0 : 1) - (b.kind === "workflow" ? 0 : 1) || String(a.bundle_id).localeCompare(String(b.bundle_id))).map((row) => row.bundle_id);
  await client.query(
    "INSERT INTO company_os_box_plans(id,tenant_id,instance_id,plan_id,plan_name,monthly_price_cents,own_hardware,early_bird_discount_bp,early_bird_note,top_up_usd_cents_per_chf,currency,prices_exclude_vat,free_months,includes,customer_number,starts_at,ends_at,granted_by,created_at,included_bundles) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)",
    [boxPlanId, input.tenantId, input.instanceId, plan.id, plan.name, boxCents, ownHardware, discountBp, discountNote, plan.top_up_usd_cents_per_chf, plan.currency, plan.prices_exclude_vat, plan.free_months, JSON.stringify(plan.includes), customerNumber, startsAt.toISOString(), endsAt ? endsAt.toISOString() : null, admin, now.toISOString(), JSON.stringify(grantedBundles)],
  );
  // invoice subscriptions the box already has join the plan
  const existing = await client.query(
    "SELECT s.id,s.bundle_id,s.copy_number,s.invoice_monthly_cents,s.invoice_kind,s.invoice_allowance_usd_cents,b.monthly_price_cents,b.kind,b.ai_allowance_usd_cents FROM company_os_bundle_subscriptions s JOIN company_os_function_bundles b ON b.id=s.bundle_id WHERE s.tenant_id=$1 AND s.instance_id=$2 AND s.billing_provider=$3 AND s.subscription_state<>'cancelled' AND s.box_plan_id IS NULL",
    [input.tenantId, input.instanceId, INVOICE],
  );
  const joined = [];
  for (const row of existing.rows) {
    // it keeps the price, kind and allowance it has (also for the months before the plan) and never
    // outlives the plan's planned end; an earlier end of its own stays
    const cents = Number(row.invoice_monthly_cents ?? row.monthly_price_cents);
    await client.query("UPDATE company_os_bundle_subscriptions SET box_plan_id=$2,included_in_plan=false,invoice_monthly_cents=$3,pre_plan_monthly_cents=$3,invoice_currency=COALESCE(invoice_currency,$6),invoice_kind=COALESCE(invoice_kind,$7),invoice_allowance_usd_cents=COALESCE(invoice_allowance_usd_cents,$8),billing_ends_at=CASE WHEN $4::timestamptz IS NULL THEN billing_ends_at WHEN billing_ends_at IS NULL OR billing_ends_at>$4::timestamptz THEN $4::timestamptz ELSE billing_ends_at END,updated_at=$5 WHERE id=$1", [row.id, boxPlanId, cents, endsAt ? endsAt.toISOString() : null, now.toISOString(), plan.currency, row.kind, row.kind === "agent" ? 0 : Number(row.ai_allowance_usd_cents)]);
    joined.push({ subscriptionId: row.id, bundleId: row.bundle_id, copyNumber: Number(row.copy_number), kind: row.invoice_kind ?? row.kind, monthlyPriceCents: cents });
  }
  // every workflow the plan grants that the box does not hold yet: granted by order at its list price
  const granted = [];
  for (const bundleId of grantedBundles) {
    if (joined.some((item) => item.bundleId === bundleId && item.copyNumber === 1)) continue;
    granted.push(await grantSubscriptionByOrder(client, { tenantId: input.tenantId, instanceId: input.instanceId, bundleId, startsOn: input.startsOn, endsOn: input.endsOn ?? null, administrator: admin, note: `granted with plan ${plan.id}`, now }));
  }
  // a box always has at least one workflow, for as long as the plan runs: a joined workflow with an
  // earlier end of its own does not count
  if (!(await workflowsCoveringPlan(client, boxPlanId, endsAt ? endsAt.toISOString() : null)).length) throw new OrderError("box_needs_a_workflow", 409);
  const result = { boxPlanId, planId: plan.id, planName: plan.name, customerNumber, mark, ownHardware, boxPriceCents: boxCents, earlyBird: discountBp > 0 ? { discountBasisPoints: discountBp, note: discountNote } : null, startsAt: startsAt.toISOString(), endsAt: endsAt ? endsAt.toISOString() : null, granted, joined, grantedBy: admin };
  await planAudit(client, "plan_assigned", admin, { tenantId: input.tenantId, instanceId: input.instanceId, planId: plan.id, customerNumber, mark, ownHardware, boxPriceCents: boxCents, earlyBirdDiscountBp: discountBp, startsAt: result.startsAt, endsAt: result.endsAt, granted: granted.map((item) => item.bundleId), joined: joined.map((item) => item.bundleId), note: input.note ?? null }, { planId: plan.id, boxPlanId }, now);
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
  const subscriptions = await client.query("SELECT id FROM company_os_bundle_subscriptions WHERE box_plan_id=$1 AND billing_provider=$2 AND subscription_state<>'cancelled' AND admin_ended_at IS NULL", [plan.id, INVOICE]);
  const ended = [];
  // the subscriptions end at the plan's exact deadline, not at a rounded number of days; they are
  // ended before the plan's own end is written, so the date sweep (which also follows a plan's end)
  // cannot end them while this loop still works through them
  for (const row of subscriptions.rows) ended.push(await endSubscriptionByAdmin(client, { subscriptionId: row.id, graceDays, effectiveAt: effective, administrator: admin, reason: reason ?? `plan ${plan.plan_id} ended`, now, withPlan: true }));
  await client.query("UPDATE company_os_box_plans SET ends_at=$2,ended_by=$3,end_reason=$4 WHERE id=$1", [plan.id, effective.toISOString(), admin, reason]);
  // a subscription an administrator already ended later than the plan now ends with the plan; an earlier end stays
  const later = await client.query("SELECT id FROM company_os_bundle_subscriptions WHERE box_plan_id=$1 AND billing_provider=$2 AND subscription_state='cancel_at_period_end' AND admin_ended_at IS NOT NULL AND cancel_effective_at>$3", [plan.id, INVOICE, effective.toISOString()]);
  for (const row of later.rows) {
    await client.query("UPDATE company_os_bundle_subscriptions SET cancel_effective_at=$2,updated_at=$3 WHERE id=$1", [row.id, effective.toISOString(), now.toISOString()]);
    await client.query("UPDATE company_os_installations SET billing_cancel_effective_at=$2,updated_at=$3 WHERE bundle_subscription_id=$1", [row.id, effective.toISOString(), now.toISOString()]);
    ended.push({ subscriptionId: row.id, billing: INVOICE, subscriptionState: "cancel_at_period_end", effectiveAt: effective.toISOString(), endedBy: admin });
  }
  if (later.rowCount && effective.getTime() <= now.getTime()) await applyDueSubscriptionDates(client, { now });
  await planAudit(client, "plan_ended", admin, { effectiveAt: effective.toISOString(), graceDays, reason, subscriptions: ended.map((item) => item.subscriptionId) }, { planId: plan.plan_id, boxPlanId: plan.id }, now);
  return { boxPlanId: plan.id, endsAt: effective.toISOString(), endedBy: admin, subscriptions: ended };
}

/**
 * A one-time invoice line for one box and month in CHF: an AI top-up, which adds USD allowance at
 * the top-up rate of the box's plan, or AI use above the allowance (no allowance).
 */
export async function addInvoiceLine(client, input) {
  const now = input.now ?? new Date();
  const admin = administrator(input.administrator);
  const kind = ITEM_KINDS[String(input.kind ?? "")];
  if (!kind) throw new OrderError("invoice_line_kind_invalid", 400);
  const month = parseMonth(input.month);
  const amount = parseChf(input.amountChf, "amount");
  if (amount <= 0) throw new OrderError("amount_invalid", 400);
  // the plan that ran in the month the line is for (its rate and VAT basis), not a later one; in a
  // month with a change of plan, the one that ran last in that month
  const held = (await client.query("SELECT * FROM company_os_box_plans WHERE tenant_id=$1 AND instance_id=$2 ORDER BY starts_at,created_at", [input.tenantId, input.instanceId])).rows;
  const plan = held.filter((row) => daysWithin(month, row.starts_at, row.ends_at ?? null) > 0).at(-1) ?? null;
  if (!plan) throw new OrderError(held.length ? "box_has_no_plan_in_month" : "box_has_no_plan", 404);
  let allowanceUsd = null;
  if (kind === "ai_top_up") {
    // the top-up rate of the box's plan: USD cents of allowance per CHF 1.00
    if (!(Number(plan.top_up_usd_cents_per_chf) > 0)) throw new OrderError("plan_has_no_top_up_rate", 409);
    allowanceUsd = Math.round((amount * Number(plan.top_up_usd_cents_per_chf)) / 100);
  }
  const description = typeof input.description === "string" && input.description.trim() ? input.description.trim().slice(0, 200) : ITEM_TEXT[kind];
  const id = randomUUID();
  await client.query(
    "INSERT INTO company_os_invoice_items(id,tenant_id,instance_id,box_plan_id,invoice_month,kind,description,amount_cents,currency,created_by,created_at,allowance_usd_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
    [id, input.tenantId, input.instanceId, plan.id, month.start.toISOString().slice(0, 10), kind, description, amount, plan.currency, admin, now.toISOString(), allowanceUsd],
  );
  await planAudit(client, "invoice_line_added", admin, { month: month.label, kind, amountCents: amount, allowanceUsdCents: allowanceUsd, description }, { planId: plan.plan_id, boxPlanId: plan.id }, now);
  return { invoiceLineId: id, month: month.label, kind, description, amountCents: amount, currency: plan.currency, allowanceUsdCents: allowanceUsd };
}

/** The plans with their box price, early bird, top-up rate, workflows, and how many customers count. */
export async function planList(client) {
  const plans = (await client.query("SELECT * FROM company_os_plans ORDER BY id")).rows;
  const functions = (await client.query("SELECT plan_id,bundle_id FROM company_os_plan_functions ORDER BY bundle_id")).rows;
  const out = [];
  for (const plan of plans) {
    const customers = await countingCustomers(client, plan.id);
    const next = nextCustomerNumber(customers);
    out.push({
      id: plan.id, name: plan.name, currency: plan.currency, pricesExcludeVat: plan.prices_exclude_vat, boxPriceCents: Number(plan.box_price_cents), freeMonths: plan.free_months,
      earlyBird: { customers: Number(plan.early_bird_customers), discountBasisPoints: Number(plan.early_bird_discount_bp), note: plan.early_bird_note ?? null },
      topUpUsdCentsPerChf: Number(plan.top_up_usd_cents_per_chf), includes: plan.includes, status: plan.status,
      workflows: functions.filter((row) => row.plan_id === plan.id).map((row) => row.bundle_id),
      payingCustomers: customers.size, nextCustomerNumber: next, nextCustomerGetsEarlyBird: next <= Number(plan.early_bird_customers) && Number(plan.early_bird_discount_bp) > 0,
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
 * What to invoice for one month, per box, all plus VAT (or with VAT included, as the plan says):
 * the box line (none on own hardware) with what it includes, each workflow and each single agent
 * at its price, the early-bird discount on the first workflow, one-time lines, then the net
 * subtotal, the VAT at the rate in force on the month's first day, and the total. Every monthly
 * line is billed for the days it ran when that is only part of the month (price x days / days in
 * the month, rounded to the cent); a workflow or agent on a plan follows the plan's days and stops
 * with it. Free months (if a plan has any) count from the month the plan starts and cover that
 * plan's lines. Workflows and top-ups carry the USD allowance they give (`allowanceUsdCents`, for
 * the box to enforce; never shown or printed). Subscriptions billed by a provider (Polar) are not
 * here. A box an administrator marked (test, Old School's own) is listed with `invoiced: false`.
 *
 * @param {{ query: Function }} client
 * @param {{ month: string; tenantId?: string | null; instanceId?: string | null; withoutTotals?: boolean }} input
 */
export async function invoiceLines(client, input) {
  const month = parseMonth(input.month);
  const scope = [input.tenantId ?? null, input.instanceId ?? null];
  const scoped = "($1::uuid IS NULL OR tenant_id=$1::uuid) AND ($2::uuid IS NULL OR instance_id=$2::uuid)";
  const total = daysInMonth(month);
  // a plan counts with the whole days it ran in the month (none: a period that ended before it started)
  const allPlans = (await client.query(`SELECT * FROM company_os_box_plans WHERE ${scoped} ORDER BY created_at`, scope)).rows;
  const anyPlanById = new Map(allPlans.map((plan) => [plan.id, plan]));
  const plans = allPlans
    .map((plan) => ({ ...plan, days: daysWithin(month, plan.starts_at, plan.ends_at ?? null) }))
    .filter((plan) => plan.days > 0);
  const subscriptions = (await client.query(
    `SELECT s.id,s.tenant_id,s.instance_id,s.bundle_id,s.copy_number,s.billing_description,s.subscription_state,s.billing_starts_at,s.entitled_at,s.billing_ends_at,s.cancel_effective_at,s.stopped_at,s.invoice_monthly_cents,s.pre_plan_monthly_cents,s.included_in_plan,s.box_plan_id,s.created_at,b.monthly_price_cents,COALESCE(s.invoice_currency,b.currency) AS currency,COALESCE(s.invoice_kind,b.kind) AS kind,COALESCE(s.invoice_allowance_usd_cents,CASE WHEN b.kind='agent' THEN 0 ELSE b.ai_allowance_usd_cents END) AS allowance_usd_cents FROM company_os_bundle_subscriptions s JOIN company_os_function_bundles b ON b.id=s.bundle_id WHERE s.billing_provider='invoice' AND ($1::uuid IS NULL OR s.tenant_id=$1::uuid) AND ($2::uuid IS NULL OR s.instance_id=$2::uuid) ORDER BY s.created_at`,
    scope,
  )).rows.map((row) => {
    const start = new Date(row.billing_starts_at ?? row.entitled_at ?? row.created_at).getTime();
    const stops = [row.stopped_at, row.subscription_state === "cancel_at_period_end" ? row.cancel_effective_at : null, row.billing_ends_at].filter(Boolean).map((value) => new Date(value).getTime());
    // a subscription on a plan stops with that plan, whatever later end it has of its own
    const linkedEnd = row.box_plan_id && anyPlanById.get(row.box_plan_id)?.ends_at ? new Date(anyPlanById.get(row.box_plan_id).ends_at).getTime() : null;
    if (linkedEnd !== null) stops.push(linkedEnd);
    const stop = stops.length ? Math.min(...stops) : null;
    return { ...row, start, stop, days: daysWithin(month, start, stop) };
  }).filter((row) => row.days > 0);
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
    // every plan that ran in the month is invoiced for its days (a change of plan bills each for
    // its days); free months are each plan's own and cover that plan's lines only
    const latest = box.plans.at(-1) ?? null;
    const currency = latest?.currency ?? box.subscriptions[0]?.currency ?? box.items[0]?.currency ?? "chf";
    const mark = markOf(box.tenantId, box.instanceId);
    const base = { month: month.label, tenantId: box.tenantId, instanceId: box.instanceId, box: boxLabel(box.tenantId, box.instanceId), plan: latest?.plan_name ?? "", currency, vat: vatText(latest), invoiced: !mark };
    const add = (line, description, amountCents, note = "", extra = {}) => lines.push({ ...base, line, description, amountCents, note, ...extra });
    const freeNoteOf = new Map();
    for (const plan of box.plans) {
      const index = monthsFrom(plan.starts_at, month.start);
      if (index < Number(plan.free_months)) freeNoteOf.set(plan.id, `free month ${index + 1} of ${plan.free_months}`);
    }
    const daysNote = (days) => (days < total ? `${days} of ${total} days` : "");
    const notes = (...parts) => parts.filter(Boolean).join(", ");
    // charges are summed by VAT basis: prices before VAT, and prices with VAT included
    const sums = { exclusive: 0, inclusive: 0 };
    const planById = new Map(box.plans.map((plan) => [plan.id, plan]));
    const charge = (cents, planId) => {
      // the VAT basis of the plan a charge belongs to, also when that plan no longer runs this month
      const plan = planId ? anyPlanById.get(planId) : null;
      if (plan && plan.prices_exclude_vat === false) sums.inclusive += cents;
      else sums.exclusive += cents;
    };
    if (!box.plans.length) add("no_plan", "No plan on this box", 0, "workflows and agents only");
    for (const plan of box.plans) {
      // the box, for the days it ran; none on own hardware
      if (plan.own_hardware) continue;
      const free = freeNoteOf.get(plan.id);
      const boxPrice = free ? 0 : forDays(Number(plan.monthly_price_cents), plan.days, total);
      charge(boxPrice, plan.id);
      add("box", `${plan.plan_name}, monthly`, boxPrice, notes(free, daysNote(plan.days)));
      const includes = Array.isArray(plan.includes) ? plan.includes : [];
      if (includes.length) add("box_includes", `Includes: ${includes.join("; ")}`, 0, "included with the box");
    }
    // a subscription's days split into the days before its plan started (the price it had then),
    // the days its plan ran, and the days after its plan ended (not billed: the plan's end ends what
    // rides on it); workflows first, then agents, each by name
    const segments = [];
    const ordered = [...box.subscriptions].sort((a, b) => (a.kind === "workflow" ? 0 : 1) - (b.kind === "workflow" ? 0 : 1) || String(a.billing_description).localeCompare(String(b.billing_description)) || a.start - b.start || String(a.id).localeCompare(String(b.id)));
    for (const row of ordered) {
      const linked = row.box_plan_id ? anyPlanById.get(row.box_plan_id) : null;
      const plan = linked && planById.has(linked.id) ? linked : null;
      const planStart = linked ? new Date(linked.starts_at).getTime() : null;
      const onFrom = plan ? Math.max(row.start, planStart) : null;
      const onPlan = plan ? daysWithin(month, onFrom, row.stop) : 0;
      const offTo = linked ? (row.stop === null ? planStart : Math.min(row.stop, planStart)) : row.stop;
      const offPlan = linked ? daysWithin(month, row.start, offTo) : row.days;
      const allowance = row.kind === "agent" ? 0 : Number(row.allowance_usd_cents ?? 0);
      if (onPlan > 0) {
        const free = freeNoteOf.get(plan.id);
        const price = free ? 0 : forDays(Number(row.invoice_monthly_cents ?? row.monthly_price_cents), onPlan, total);
        charge(price, plan.id);
        add(row.kind, row.billing_description, price, notes(free, daysNote(onPlan)), row.kind === "workflow" ? { allowanceUsdCents: forDays(allowance, onPlan, total) } : {});
        segments.push({ row, plan, from: onFrom, stop: row.stop, free });
      }
      if (offPlan > 0) {
        const price = forDays(Number(row.pre_plan_monthly_cents ?? row.invoice_monthly_cents ?? row.monthly_price_cents), offPlan, total);
        charge(price, null);
        add(row.kind, row.billing_description, price, daysNote(offPlan), row.kind === "workflow" ? { allowanceUsdCents: forDays(allowance, offPlan, total) } : {});
      }
    }
    // the early bird: each day, the discount goes to the first workflow on the plan that runs that
    // day (the earliest started), for the days it is first; kept for as long as the customer stays
    for (const plan of box.plans) {
      const bp = Number(plan.early_bird_discount_bp ?? 0);
      if (!(bp > 0)) continue;
      const own = segments.filter((segment) => segment.plan.id === plan.id && segment.row.kind === "workflow")
        .sort((a, b) => a.row.start - b.row.start || new Date(a.row.created_at).getTime() - new Date(b.row.created_at).getTime() || String(a.row.billing_description).localeCompare(String(b.row.billing_description)) || String(a.row.id).localeCompare(String(b.row.id)));
      const firstDays = new Map();
      for (let day = 0; day < total; day += 1) {
        const at = month.start.getTime() + day * DAY_MS;
        const first = own.find((segment) => dayStart(segment.from) <= at && (segment.stop === null || at < dayStart(segment.stop)));
        if (first) firstDays.set(first, (firstDays.get(first) ?? 0) + 1);
      }
      for (const [segment, days] of firstDays) {
        const monthly = Math.round((Number(segment.row.invoice_monthly_cents ?? segment.row.monthly_price_cents) * bp) / 10000);
        const discount = segment.free ? 0 : -forDays(monthly, days, total);
        charge(discount, plan.id);
        add("discount", `${plan.early_bird_note ?? "Discount"}: ${segment.row.billing_description} ${bp / 100}% off`, discount, notes(segment.free, daysNote(days)));
      }
    }
    // one currency per box: refuse loudly rather than add up francs and another currency
    const currencies = new Set([...box.plans.map((plan) => plan.currency), ...box.subscriptions.map((row) => row.currency), ...box.items.map((item) => item.currency)].map((value) => String(value).toLowerCase()));
    if (currencies.size > 1) throw new OrderError(`box_has_more_than_one_currency:${box.instanceId}:${[...currencies].sort().join(",")}`, 409);
    for (const item of box.items) {
      // a one-time line follows the VAT basis of the plan it was added under
      charge(Number(item.amount_cents), anyPlanById.has(item.box_plan_id) ? item.box_plan_id : latest?.id ?? null);
      add(item.kind, item.description, Number(item.amount_cents), "one-time", item.allowance_usd_cents !== null && item.allowance_usd_cents !== undefined ? { allowanceUsdCents: Number(item.allowance_usd_cents) } : {});
    }
    // net, VAT and total: prices before VAT get the VAT on top; prices with VAT have it taken out
    if (vatBasisPoints === null) {
      // the box's AI allowance does not wait for a VAT rate; an invoice does
      if (input.withoutTotals) continue;
      throw new OrderError(`vat_rate_missing_for:${month.label}`, 409);
    }
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
  for (const line of lines.filter((item) => item.invoiced || options.includeNotInvoiced)) {
    // text cells are guarded against spreadsheet formulas; the amount is a number (a discount is negative)
    const cells = [line.month, line.box, line.tenantId, line.instanceId, line.plan, line.line, line.description].map(csvCell);
    rows.push([...cells, money(line.amountCents), ...[line.currency.toUpperCase(), line.vat, line.note].map(csvCell)].join(","));
  }
  return `${rows.join("\n")}\n`;
}

/**
 * What the box shows on its Plan and costs page: its plan's terms and the month's lines (the same
 * ones Old School invoices), and the AI allowance the box enforces this month: the USD allowance of
 * its workflows for their days plus top-ups. Amounts the box shows are in CHF; the USD allowance is
 * for enforcing only (the box pauses AI work when it is used up) and is never shown.
 */
export async function boxPlanView(client, input) {
  const now = input.now ?? new Date();
  const month = input.month ?? currentMonth(now);
  const plan = await liveBoxPlan(client, input.tenantId, input.instanceId, now);
  let lines = [];
  let ready = true;
  let allowanceLines;
  try {
    lines = await invoiceLines(client, { month, tenantId: input.tenantId, instanceId: input.instanceId });
    allowanceLines = lines;
  } catch (error) {
    // no VAT rate for the month yet: the box is told in plain words, not with an error code, and
    // still gets the AI allowance it enforces (it must not pause AI work for a missing VAT rate)
    if (!(error instanceof OrderError) || !error.code.startsWith("vat_rate_missing_for:")) throw error;
    ready = false;
    allowanceLines = await invoiceLines(client, { month, tenantId: input.tenantId, instanceId: input.instanceId, withoutTotals: true });
  }
  const aiAllowance = {
    usdCents: allowanceLines.reduce((sum, line) => sum + Number(line.allowanceUsdCents ?? 0), 0),
    topUpChfCents: allowanceLines.filter((line) => line.line === "ai_top_up").reduce((sum, line) => sum + Number(line.amountCents), 0),
  };
  const shown = lines.map(({ tenantId: _tenant, instanceId: _instance, allowanceUsdCents: _usd, ...line }) => line);
  const workflowIds = plan ? (Array.isArray(plan.included_bundles) ? plan.included_bundles : (await client.query("SELECT bundle_id FROM company_os_plan_functions WHERE plan_id=$1", [plan.plan_id])).rows.map((row) => row.bundle_id)) : [];
  const workflows = workflowIds.length ? (await client.query("SELECT id,name,kind FROM company_os_function_bundles ORDER BY name")).rows.filter((row) => workflowIds.includes(row.id)).map((row) => ({ bundleId: row.id, name: row.name, kind: row.kind })) : [];
  return {
    month,
    plan: plan
      ? {
          planId: plan.plan_id, name: plan.plan_name, ownHardware: plan.own_hardware === true, boxMonthlyCents: Number(plan.monthly_price_cents),
          earlyBird: Number(plan.early_bird_discount_bp) > 0 ? { note: plan.early_bird_note ?? null, percent: Number(plan.early_bird_discount_bp) / 100 } : null,
          currency: plan.currency, pricesExcludeVat: plan.prices_exclude_vat, freeMonths: Number(plan.free_months), includes: plan.includes,
          startsAt: new Date(plan.starts_at).toISOString(), endsAt: plan.ends_at ? new Date(plan.ends_at).toISOString() : null,
          workflows,
        }
      : null,
    lines: shown,
    // the allowance the box enforces this month (USD, never shown) and the top-ups bought (CHF, shown)
    aiAllowance,
    ready,
    message: ready ? null : "The costs for this month are not ready yet. Old School is preparing them.",
    netCents: shown.find((line) => line.line === "subtotal")?.amountCents ?? 0,
    vatCents: shown.find((line) => line.line === "vat")?.amountCents ?? 0,
    totalCents: shown.find((line) => line.line === "total")?.amountCents ?? 0,
  };
}
