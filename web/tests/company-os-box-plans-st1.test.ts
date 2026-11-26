import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as unknown as import("pg").Pool }));
vi.mock("@/lib/postgres", () => ({ getPgPool: () => holder.pool }));

import { addPackageToBundle, enrolPublisher, issueEnrolmentCode, upsertBundle } from "@/lib/companyOs/privateStore";
import { addInvoiceLine, assignPlan, definePlan, endPlan, invoiceCsv, invoiceLines, markBox, planList, setBundleKind, setPlanFunction, setVatRate } from "@/lib/companyOs/boxPlans.mjs";
import { applyDueSubscriptionDates, endSubscriptionByAdmin, grantSubscriptionByOrder } from "@/lib/companyOs/subscriptionOrders.mjs";
import { keyIdFor, loadEd25519PublicKey } from "@/lib/companyOs/publisherKeys";
import { enrol, storeInstallations, storePlan } from "@/app/api/company-os/v1/storeHandlers";
import { createStoreDb, ed25519Pair, envelope, signedManifest, signedRequest, type Appliance } from "./helpers/companyOsStoreDb";
import { assertSafeMigration } from "../scripts/run-store-migrations.mjs";

/**
 * ST1 plans with the CEO's final price structure of 26 Nov 2026, entered as data the way the admin
 * command enters them. Per box and month, plus VAT: the box (CHF 100; none on own hardware), each
 * workflow at CHF 179 with USD 30 of AI provider use (allowances add up per box), each single agent
 * at CHF 59 to 149 with no allowance, and for customers 1 to 50 the first workflow at 50 percent as
 * its own discount line. Box plus one workflow: CHF 279.00 net, early bird CHF 189.50; own
 * hardware: CHF 179.00, early bird CHF 89.50. Never per person.
 */

const CUSTOMERS_MODEL = "faivr.agent.penn";
const ADMIN = "bernd (CEO)";
const NOW = new Date("2026-11-26T12:00:00.000Z");
const PLAN = "truchsess";
const PLAN_NAME = "Truchsess box";
const EARLY = "Early bird";
const INCLUDES = ["Setup in our office", "Updates of agents, system and AI", "Safety copies", "Support", "2 years warranty on the box"];
const DAY = 24 * 60 * 60 * 1000;

type Plan = Parameters<typeof definePlan>[1];

describe("ST1 plans: what Old School invoices per box", () => {
  let appliance: Appliance;
  let tenantId: string;

  const planInput = (extra: Partial<Plan> = {}) => ({ id: PLAN, name: PLAN_NAME, boxChf: "100", earlyBirdCustomers: 50, earlyBirdPercent: "50", earlyBirdNote: EARLY, topUpUsdPerChf: "1", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN, ...extra }) as Plan;
  const define = (extra: Partial<Plan> = {}) => definePlan(holder.pool, planInput(extra));
  const otherPlan = (id: string, extra: Partial<Plan> = {}) => definePlan(holder.pool, planInput({ id, name: id, earlyBirdCustomers: 0, earlyBirdPercent: "0", earlyBirdNote: null, ...extra }));

  beforeEach(async () => {
    holder.pool = createStoreDb().pool;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => {
      throw new Error(`no request may leave the store here: ${String(url)}`);
    }));
    const pair = ed25519Pair();
    const keyId = keyIdFor(loadEd25519PublicKey(pair.publicPem));
    await enrolPublisher({ publicKeyPem: pair.publicPem, publisherId: "old-school", name: "Old School AG" });
    const payload = Buffer.from("penn package bytes");
    const manifest: Record<string, unknown> = signedManifest({ modelId: CUSTOMERS_MODEL, version: "1.0.0", payload, publisherKeyId: keyId, publisherPrivatePem: pair.privatePem, permissions: ["workspace.read"] });
    await holder.pool.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,'penn','Penn','Keeps the customers.','active')", [CUSTOMERS_MODEL]);
    await holder.pool.query(
      "INSERT INTO company_os_package_versions(id,package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,'1.0.0','published',$3,$4,$5,'https://packages.faivr.test/x.tar.gz',$6,0,NULL,'1.0.0',now())",
      [randomUUID(), CUSTOMERS_MODEL, JSON.stringify(manifest), keyId, (manifest.signature as { value: string }).value, manifest.packageDigest],
    );
    // workflows, agents and their list prices are catalog data
    for (const [id, name] of [["customers", "Customers"], ["product-management", "Product management"], ["bob", "Developer"], ["extra-workflow", "Extra workflow"]]) {
      await upsertBundle({ id, name, description: `${name} workflow.`, stripePriceId: null, polarProductId: null, monthlyPriceCents: 17900 });
      await setBundleKind(holder.pool, { bundleId: id, kind: "workflow", aiAllowanceUsd: "30", administrator: ADMIN });
    }
    await upsertBundle({ id: "assistant", name: "Assistant", description: "A single agent.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 5900 });
    await setBundleKind(holder.pool, { bundleId: "assistant", kind: "agent", administrator: ADMIN });
    await addPackageToBundle("customers", CUSTOMERS_MODEL);
    const issued = await issueEnrolmentCode({ label: "Office box", createdBy: "store-admin" });
    tenantId = issued.tenantId;
    appliance = { tenantId, instanceId: "", keyId: "", keys: ed25519Pair() };
    const response = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentCode: issued.code, appliancePublicKeyPem: appliance.keys.publicPem, label: "Muster AG office" }) }));
    const body = (await response.json()) as Record<string, string>;
    appliance.instanceId = body.instanceId;
    appliance.keyId = body.keyId;
    await setVatRate(holder.pool, { from: "2024-01-01", percent: "8.1", administrator: ADMIN });
    await define();
    await setPlanFunction(holder.pool, { planId: PLAN, bundleId: "customers", granted: true, administrator: ADMIN });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await holder.pool.end();
  });

  async function newBox(label = "another box") {
    const instanceId = randomUUID();
    await holder.pool.query("INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key,label,enrolled_at) VALUES($1,$2,'k','pem',$3,now())", [tenantId, instanceId, label]);
    return instanceId;
  }

  const assign = (instanceId: string, extra: Record<string, unknown> = {}) => assignPlan(holder.pool, { tenantId, instanceId, planId: PLAN, startsOn: "2026-12-01", administrator: ADMIN, now: NOW, ...extra });
  const grant = (instanceId: string, bundleId: string, extra: Record<string, unknown> = {}) => grantSubscriptionByOrder(holder.pool, { tenantId, instanceId, bundleId, startsOn: "2026-12-01", administrator: ADMIN, now: NOW, ...extra });

  /** The office box: the plan with Customers, Product management added, and a single agent. */
  async function officeBox() {
    const assigned = await assign(appliance.instanceId);
    const second = await grant(appliance.instanceId, "product-management");
    const agent = await grant(appliance.instanceId, "assistant");
    return { assigned, second, agent };
  }

  const summary = (lines: Array<Record<string, unknown>>) => lines.map((line) => [line.line, line.description, line.amountCents, line.note]);
  const kinds = (lines: Array<Record<string, unknown>>, ...wanted: string[]) => summary(lines).filter((line) => wanted.includes(line[0] as string));
  const totals = (lines: Array<Record<string, unknown>>, instanceId?: string) => ["subtotal", "vat", "total"].map((name) => lines.find((line) => line.line === name && (!instanceId || line.instanceId === instanceId))?.amountCents);
  const BOX = ["box", "Truchsess box, monthly", 10000, ""];
  const INCL = ["box_includes", `Includes: ${INCLUDES.join("; ")}`, 0, "included with the box"];
  const workflow = (name: string, cents = 17900, note = "") => ["workflow", name, cents, note];
  const discount = (cents = -8950, note = "", name = "Customers") => ["discount", `${EARLY}: ${name} 50% off`, cents, note];

  it("gives a box the plan: its customer number, the early bird, its workflow at CHF 179 with USD 30, and the box installs", async () => {
    const { assigned, second, agent } = await officeBox();
    expect(assigned).toMatchObject({ planId: PLAN, planName: PLAN_NAME, customerNumber: 1, mark: null, ownHardware: false, boxPriceCents: 10000, earlyBird: { discountBasisPoints: 5000, note: EARLY }, startsAt: "2026-12-01T00:00:00.000Z", grantedBy: ADMIN });
    expect(assigned.granted.map((item: { bundleId: string; kind: string; monthlyPriceCents: number; allowanceUsdCents: number }) => [item.bundleId, item.kind, item.monthlyPriceCents, item.allowanceUsdCents])).toEqual([["customers", "workflow", 17900, 3000]]);
    expect(second).toMatchObject({ bundleId: "product-management", kind: "workflow", monthlyPriceCents: 17900, allowanceUsdCents: 3000, boxPlanId: assigned.boxPlanId });
    expect(agent).toMatchObject({ bundleId: "assistant", kind: "agent", monthlyPriceCents: 5900, allowanceUsdCents: 0, boxPlanId: assigned.boxPlanId });
    const installBody = envelope(appliance, { bundleId: "customers", faivrAgentModelId: CUSTOMERS_MODEL });
    expect((await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", installBody, { idempotencyKey: installBody.idempotencyKey as string }))).status).toBe(201);
  });

  it("CEO results: box and one workflow CHF 279.00 net, early bird CHF 189.50; own hardware CHF 179.00, early bird CHF 89.50", async () => {
    const first = await assign(await newBox("customer 1"));
    for (let n = 2; n <= 49; n += 1) await assign(await newBox(`customer ${n}`));
    const ownEarly = await assign(await newBox("customer 50, own server"), { ownHardware: true });
    const fiftyFirst = await assign(appliance.instanceId);
    const ownLater = await assign(await newBox("customer 52, own device"), { ownHardware: true });
    expect([first, ownEarly, fiftyFirst, ownLater].map((item) => [item.customerNumber, item.boxPriceCents, item.earlyBird?.discountBasisPoints ?? 0])).toEqual([[1, 10000, 5000], [50, 0, 5000], [51, 10000, 0], [52, 0, 0]]);
    const january = await invoiceLines(holder.pool, { month: "2027-01" });
    const subtotal = (instanceId: string) => january.find((line) => line.instanceId === instanceId && line.line === "subtotal")?.amountCents;
    const box = (number: number) => holder.pool.query("SELECT instance_id FROM company_os_box_plans WHERE customer_number=$1", [number]).then((r) => r.rows[0].instance_id as string);
    const [one, fifty, fiftyTwo] = [await box(1), await box(50), await box(52)];
    expect([subtotal(one), subtotal(fifty), subtotal(appliance.instanceId), subtotal(fiftyTwo)]).toEqual([18950, 8950, 27900, 17900]);
    expect(kinds(january.filter((line) => line.instanceId === appliance.instanceId), "box", "workflow", "discount")).toEqual([BOX, workflow("Customers")]);
    expect(kinds(january.filter((line) => line.instanceId === one), "box", "workflow", "discount")).toEqual([BOX, workflow("Customers"), discount()]);
    // own hardware: no box line, no "includes" line
    expect(kinds(january.filter((line) => line.instanceId === fifty), "box", "box_includes", "workflow", "discount")).toEqual([workflow("Customers"), discount()]);
    // never per person: nothing on the invoice counts users
    expect(JSON.stringify(january)).not.toMatch(/user|person|seat/i);
  });

  it("bills from the first month, plus Swiss VAT: net, VAT and total; a top-up is a one-time line that adds allowance", async () => {
    await officeBox();
    expect(summary(await invoiceLines(holder.pool, { month: "2026-12" }))).toEqual([
      BOX, INCL,
      workflow("Customers"), workflow("Product management"),
      ["agent", "Assistant", 5900, ""],
      discount(),
      ["subtotal", "Subtotal 2026-12, net", 42750, ""],
      ["vat", "VAT 8.1%", 3463, ""],
      ["total", "Total 2026-12", 46213, ""],
    ]);
    const topUp = await addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW });
    // at the plan's top-up rate (data: USD 1.00 per CHF 1.00 here)
    expect(topUp).toMatchObject({ amountCents: 2000, allowanceUsdCents: 2000 });
    const january = await invoiceLines(holder.pool, { month: "2027-01" });
    expect(summary(january).slice(-4)).toEqual([
      ["ai_top_up", "AI top-up", 2000, "one-time"],
      ["subtotal", "Subtotal 2027-01, net", 44750, ""],
      ["vat", "VAT 8.1%", 3625, ""],
      ["total", "Total 2027-01", 48375, ""],
    ]);
    // the allowance the box enforces: USD 30 for each workflow, none for the agent, plus the top-up
    expect(january.reduce((sum, line) => sum + Number(line.allowanceUsdCents ?? 0), 0)).toBe(8000);
    expect(january.find((line) => line.line === "agent")).not.toHaveProperty("allowanceUsdCents");
    expect(january.every((line) => line.box === "Muster AG office" && line.plan === PLAN_NAME && line.vat === "plus VAT" && line.currency === "chf" && line.invoiced === true)).toBe(true);
    expect(await invoiceLines(holder.pool, { month: "2026-11" })).toEqual([]);
    const csv = invoiceCsv(january).split("\n");
    const at = `2027-01,Muster AG office,${tenantId},${appliance.instanceId},${PLAN_NAME}`;
    expect(csv[0]).toBe("month,box,tenant_id,instance_id,plan,line,description,amount,currency,vat,note");
    expect(csv[1]).toBe(`${at},box,"${PLAN_NAME}, monthly",100.00,CHF,plus VAT,`);
    expect(csv[3]).toBe(`${at},workflow,Customers,179.00,CHF,plus VAT,`);
    expect(csv[5]).toBe(`${at},agent,Assistant,59.00,CHF,plus VAT,`);
    // the discount is a negative amount, never a spreadsheet formula guard
    expect(csv[6]).toBe(`${at},discount,${EARLY}: Customers 50% off,-89.50,CHF,plus VAT,`);
    expect(csv.slice(-4, -1)).toEqual([
      `${at},subtotal,"Subtotal 2027-01, net",447.50,CHF,plus VAT,`,
      `${at},vat,VAT 8.1%,36.25,CHF,plus VAT,`,
      `${at},total,Total 2027-01,483.75,CHF,plus VAT,`,
    ]);
    // the CSV never carries the USD allowance
    expect(csv.join("\n")).not.toMatch(/usd/i);
  });

  it("uses the VAT rate in force on the month's first day, and refuses a month without one", async () => {
    await officeBox();
    await setVatRate(holder.pool, { from: "2027-02-01", percent: "9", administrator: ADMIN });
    expect((await invoiceLines(holder.pool, { month: "2027-01" })).find((line) => line.line === "vat")).toMatchObject({ description: "VAT 8.1%", amountCents: 3463 });
    expect((await invoiceLines(holder.pool, { month: "2027-02" })).find((line) => line.line === "vat")).toMatchObject({ description: "VAT 9%", amountCents: 3848 });
    await holder.pool.query("DELETE FROM company_os_vat_rates");
    await expect(invoiceLines(holder.pool, { month: "2027-01" })).rejects.toThrow("vat_rate_missing_for:2027-01");
  });

  it("the early bird is the first customers' by number, kept while they stay and when they come back", async () => {
    await define({ earlyBirdCustomers: 2 });
    const first = await assign(appliance.instanceId);
    const second = await assign(await newBox());
    const third = await assign(await newBox());
    expect([first, second, third].map((item) => [item.customerNumber, item.earlyBird?.discountBasisPoints ?? 0])).toEqual([[1, 5000], [2, 5000], [3, 0]]);
    await endPlan(holder.pool, { boxPlanId: first.boxPlanId, graceDays: 0, administrator: ADMIN, now: NOW });
    // the plan changes afterwards: the returning customer keeps its number, box price and early bird
    await define({ boxChf: "120", earlyBirdCustomers: 0, earlyBirdPercent: "0", earlyBirdNote: null });
    const back = await assign(appliance.instanceId, { now: new Date(NOW.getTime() + 1000) });
    expect([back.customerNumber, back.boxPriceCents, back.earlyBird]).toEqual([1, 10000, { discountBasisPoints: 5000, note: EARLY }]);
    const fresh = await assign(await newBox());
    expect([fresh.customerNumber, fresh.boxPriceCents, fresh.earlyBird]).toEqual([4, 12000, null]);
    expect((await invoiceLines(holder.pool, { month: "2027-01" })).filter((line) => line.line === "discount")).toHaveLength(2);
    expect((await planList(holder.pool)).find((plan: { id: string }) => plan.id === PLAN)).toMatchObject({ boxPriceCents: 12000, earlyBird: { customers: 0, discountBasisPoints: 0, note: null }, topUpUsdCentsPerChf: 100, workflows: ["customers"], payingCustomers: 4, nextCustomerNumber: 5, nextCustomerGetsEarlyBird: false });
  });

  it("never counts or invoices a test box or Old School's own box; only an administrator marks one", async () => {
    const boxOne = await newBox("box 1");
    const testUser = await newBox("test user");
    await markBox(holder.pool, { tenantId, instanceId: boxOne, as: "old-school", note: "box 1", administrator: ADMIN });
    await markBox(holder.pool, { tenantId, instanceId: testUser, as: "test", administrator: ADMIN });
    expect(await assign(boxOne)).toMatchObject({ customerNumber: null, mark: "old_school" });
    expect(await assign(testUser, { ownHardware: true })).toMatchObject({ customerNumber: null, mark: "test" });
    expect(await assign(appliance.instanceId)).toMatchObject({ customerNumber: 1, earlyBird: { discountBasisPoints: 5000 } });
    const lines = await invoiceLines(holder.pool, { month: "2027-01" });
    expect(lines.filter((line) => line.instanceId === boxOne).at(-1)).toMatchObject({ line: "total", invoiced: false, note: "not invoiced: Old School's own box" });
    const csv = invoiceCsv(lines);
    expect(csv).not.toContain(boxOne);
    expect(csv).not.toContain(testUser);
    expect(csv).toContain(appliance.instanceId);
    expect(invoiceCsv(lines, { includeNotInvoiced: true })).toContain(testUser);
    await expect(markBox(holder.pool, { tenantId, instanceId: testUser, as: "paying", administrator: ADMIN })).rejects.toThrow("mark_invalid");
    const handlers = readFileSync(new URL("../app/api/company-os/v1/storeHandlers.ts", import.meta.url), "utf8") + readFileSync(new URL("../app/api/company-os/v1/handlers.ts", import.meta.url), "utf8");
    expect(handlers).not.toMatch(/markBox|company_os_box_marks/);
  });

  it("shows the box the same lines it is invoiced for, in CHF, and the AI allowance it enforces", async () => {
    await officeBox();
    await addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW });
    const response = await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-01"));
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.plan).toEqual({ planId: PLAN, name: PLAN_NAME, ownHardware: false, boxMonthlyCents: 10000, earlyBird: { note: EARLY, percent: 50 }, currency: "chf", pricesExcludeVat: true, freeMonths: 0, includes: INCLUDES, startsAt: "2026-12-01T00:00:00.000Z", endsAt: null, workflows: [{ bundleId: "customers", name: "Customers", kind: "workflow" }] });
    const invoiced = (await invoiceLines(holder.pool, { month: "2027-01", tenantId, instanceId: appliance.instanceId })).map(({ tenantId: _t, instanceId: _i, allowanceUsdCents: _u, ...line }) => line);
    expect(body.lines).toEqual(invoiced);
    expect([body.ready, body.message, body.netCents, body.vatCents, body.totalCents]).toEqual([true, null, 44750, 3625, 48375]);
    // the month's allowance: USD 30 for each of the two workflows and USD 20 from the top-up; the top-ups bought in CHF
    expect(body.aiAllowance).toEqual({ usdCents: 8000, topUpChfCents: 2000 });
    expect(JSON.stringify(body.lines)).not.toMatch(/allowanceUsd|usd/i);
    expect(JSON.stringify(body)).not.toContain(tenantId);
    expect((await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-13"))).status).toBe(400);
  });

  it("ends a plan with its workflows and agent after the grace; the last month is billed by its days, nothing after", async () => {
    const { assigned } = await officeBox();
    const endAt = new Date("2027-02-10T00:00:00.000Z");
    const ended = await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 14, administrator: ADMIN, reason: "contract ends", now: new Date(endAt.getTime() - 14 * DAY) });
    expect(ended).toMatchObject({ endsAt: endAt.toISOString(), endedBy: ADMIN });
    expect(ended.subscriptions).toHaveLength(3);
    await applyDueSubscriptionDates(holder.pool, { now: new Date(endAt.getTime() + 1000) });
    const states = await holder.pool.query("SELECT subscription_state FROM company_os_bundle_subscriptions");
    expect(states.rows.every((row) => row.subscription_state === "cancelled")).toBe(true);
    // 1 to 9 February: 9 of 28 days of every monthly line, the discount too
    const days = "9 of 28 days";
    expect(kinds(await invoiceLines(holder.pool, { month: "2027-02" }), "box", "workflow", "agent", "discount", "subtotal")).toEqual([
      ["box", "Truchsess box, monthly", 3214, days],
      workflow("Customers", 5754, days),
      workflow("Product management", 5754, days),
      ["agent", "Assistant", 1896, days],
      discount(-2877, days),
      ["subtotal", "Subtotal 2027-02, net", 13741, ""],
    ]);
    expect(await invoiceLines(holder.pool, { month: "2027-03" })).toEqual([]);
  });

  it("a box always has at least one workflow: a plan without one, the last one ended alone, an agent alone are refused", async () => {
    await otherPlan("agents-only");
    await setPlanFunction(holder.pool, { planId: "agents-only", bundleId: "assistant", granted: true, administrator: ADMIN });
    await expect(assignPlan(holder.pool, { tenantId, instanceId: await newBox(), planId: "agents-only", startsOn: "2026-12-01", administrator: ADMIN, now: NOW })).rejects.toThrow(/agent_needs_a_workflow_on_the_box|box_needs_a_workflow/);
    await otherPlan("empty");
    await expect(assignPlan(holder.pool, { tenantId, instanceId: await newBox(), planId: "empty", startsOn: "2026-12-01", administrator: ADMIN, now: NOW })).rejects.toThrow("box_needs_a_workflow");
    await expect(grant(await newBox(), "assistant")).rejects.toThrow("agent_needs_a_workflow_on_the_box");
    const { assigned, second } = await officeBox();
    const customers = assigned.granted[0].subscriptionId;
    // a second workflow may end; the last one ends with its plan (end-plan), not alone
    await endSubscriptionByAdmin(holder.pool, { subscriptionId: second.subscriptionId, graceDays: 0, administrator: ADMIN, now: NOW });
    await expect(endSubscriptionByAdmin(holder.pool, { subscriptionId: customers, graceDays: 0, administrator: ADMIN, now: NOW })).rejects.toThrow("last_workflow_end_the_plan_instead");
    await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 0, administrator: ADMIN, now: NOW });
    expect((await holder.pool.query("SELECT subscription_state FROM company_os_bundle_subscriptions WHERE id=$1", [customers])).rows[0].subscription_state).toBe("cancelled");
  });

  it("an agent never costs more than a workflow and has no AI allowance of its own", async () => {
    await expect(setBundleKind(holder.pool, { bundleId: "assistant", kind: "agent", aiAllowanceUsd: "30", administrator: ADMIN })).rejects.toThrow("agent_has_no_ai_allowance");
    await upsertBundle({ id: "big-agent", name: "Big agent", description: "Too dear.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 17950 });
    await expect(setBundleKind(holder.pool, { bundleId: "big-agent", kind: "agent", administrator: ADMIN })).rejects.toThrow("agent_price_above_workflow_price:big-agent:17950:17900");
    // at the workflow price it is allowed (CHF 59 to 149 is the CEO's range; the rule is never above a workflow)
    await upsertBundle({ id: "big-agent", name: "Big agent", description: "As dear as a workflow.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 17900 });
    await expect(setBundleKind(holder.pool, { bundleId: "big-agent", kind: "agent", administrator: ADMIN })).resolves.toMatchObject({ kind: "agent", aiAllowanceUsdCents: 0 });
    // a price written past the admin command is still refused when the agent is granted
    await holder.pool.query("UPDATE company_os_function_bundles SET monthly_price_cents=19900 WHERE id='assistant'");
    await assign(appliance.instanceId);
    await expect(grant(appliance.instanceId, "assistant")).rejects.toThrow("agent_price_above_workflow_price:assistant:19900:17900");
  });

  it("the developer workflow (Bob) is a workflow at CHF 179 with its USD 30", async () => {
    await assign(appliance.instanceId);
    await grant(appliance.instanceId, "bob");
    const january = await invoiceLines(holder.pool, { month: "2027-01" });
    expect(kinds(january, "workflow", "discount")).toEqual([workflow("Customers"), workflow("Developer"), discount()]);
    expect(january.find((line) => line.description === "Developer")).toMatchObject({ allowanceUsdCents: 3000 });
  });

  it("lists the workflows of a box without a plan, and never a subscription a provider bills", async () => {
    const box = await newBox();
    await grant(box, "extra-workflow");
    await holder.pool.query("INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,copy_number,billing_description,billing_provider,subscription_state,entitled_at) VALUES($1,$2,$3,'customers',1,'Customers','polar','active',now())", [randomUUID(), tenantId, box]);
    expect(summary(await invoiceLines(holder.pool, { month: "2027-01" }))).toEqual([
      ["no_plan", "No plan on this box", 0, "workflows and agents only"],
      workflow("Extra workflow"),
      ["subtotal", "Subtotal 2027-01, net", 17900, ""],
      ["vat", "VAT 8.1%", 1450, ""],
      ["total", "Total 2027-01", 19350, ""],
    ]);
  });

  it("Codex P2: a plan that a paid subscription joins does not rewrite the months before it", async () => {
    await grant(appliance.instanceId, "customers", { startsOn: "2026-11-01" });
    const assigned = await assign(appliance.instanceId);
    expect(assigned.joined.map((item: { bundleId: string }) => item.bundleId)).toEqual(["customers"]);
    expect(assigned.granted).toEqual([]);
    expect(kinds(await invoiceLines(holder.pool, { month: "2026-11" }), "workflow", "discount", "subtotal")).toEqual([workflow("Customers"), ["subtotal", "Subtotal 2026-11, net", 17900, ""]]);
    expect((await invoiceLines(holder.pool, { month: "2026-12" })).find((line) => line.line === "subtotal")?.amountCents).toBe(18950);
  });

  it("Codex P2: a plan ended before it started is not invoiced", async () => {
    const assigned = await assign(appliance.instanceId, { startsOn: "2026-12-20" });
    await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2026-12-10T00:00:00.000Z") });
    expect(await invoiceLines(holder.pool, { month: "2026-12" })).toEqual([]);
  });

  it("Codex P2: a month with a change of plan bills both plans, each with its own free months", async () => {
    const old = await assign(appliance.instanceId, { startsOn: "2027-01-01" });
    await grant(appliance.instanceId, "extra-workflow", { startsOn: "2027-01-01" });
    await endPlan(holder.pool, { boxPlanId: old.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-10T00:00:00.000Z") });
    await otherPlan("next-plan", { name: "Next plan", freeMonths: 1 });
    await setPlanFunction(holder.pool, { planId: "next-plan", bundleId: "customers", granted: true, administrator: ADMIN });
    await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "next-plan", startsOn: "2027-01-15", administrator: ADMIN, now: new Date("2027-01-12T00:00:00.000Z") });
    const january = await invoiceLines(holder.pool, { month: "2027-01" });
    const nine = "9 of 31 days";
    expect(kinds(january, "box", "workflow", "discount")).toEqual([
      ["box", "Truchsess box, monthly", 2903, nine],
      ["box", "Next plan, monthly", 0, "free month 1 of 1, 17 of 31 days"],
      workflow("Customers", 5197, nine),
      workflow("Customers", 0, "free month 1 of 1, 17 of 31 days"),
      workflow("Extra workflow", 5197, nine),
      discount(-2598, nine),
    ]);
    // the old plan's lines (their 9 days) are not waived by the new plan's free month
    expect(january.find((line) => line.line === "subtotal")?.amountCents).toBe(2903 + 2 * 5197 - 2598);
  });

  it("Codex P2: a month with a plan before VAT and a plan with VAT applies each plan's basis", async () => {
    await otherPlan("net-plan");
    await otherPlan("gross-plan", { boxChf: "108.10", pricesExcludeVat: false });
    for (const id of ["net-plan", "gross-plan"]) await setPlanFunction(holder.pool, { planId: id, bundleId: "customers", granted: true, administrator: ADMIN });
    const old = await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "net-plan", startsOn: "2027-01-01", administrator: ADMIN, now: NOW });
    await endPlan(holder.pool, { boxPlanId: old.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-10T00:00:00.000Z") });
    await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "gross-plan", startsOn: "2027-01-15", administrator: ADMIN, now: new Date("2027-01-12T00:00:00.000Z") });
    // 1 to 9 Jan before VAT: 29.03 + 51.97 (VAT 6.56 on top); 15 to 31 Jan with VAT: 59.28 + 98.16 (of which VAT 11.80)
    expect(totals(await invoiceLines(holder.pool, { month: "2027-01" }))).toEqual([22664, 1836, 24500]);
  });

  it("supervisor: a plan starting on 2 Dec bills 30 of 31 days of every monthly line in December", async () => {
    await assign(appliance.instanceId, { startsOn: "2026-12-02" });
    await grant(appliance.instanceId, "extra-workflow", { startsOn: "2026-12-02" });
    const days = "30 of 31 days";
    expect(kinds(await invoiceLines(holder.pool, { month: "2026-12" }), "box", "workflow", "discount", "subtotal")).toEqual([
      ["box", "Truchsess box, monthly", 9677, days],
      workflow("Customers", 17323, days),
      workflow("Extra workflow", 17323, days),
      discount(-8661, days),
      ["subtotal", "Subtotal 2026-12, net", 9677 + 2 * 17323 - 8661, ""],
    ]);
    expect(kinds(await invoiceLines(holder.pool, { month: "2027-01" }), "box", "discount")).toEqual([BOX, discount()]);
  });

  it("supervisor: a plan ending on 10 Jan bills 9 of 31 days in January", async () => {
    const assigned = await assign(appliance.instanceId);
    await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-10T00:00:00.000Z") });
    const days = "9 of 31 days";
    expect(kinds(await invoiceLines(holder.pool, { month: "2027-01" }), "box", "workflow", "discount")).toEqual([["box", "Truchsess box, monthly", 2903, days], workflow("Customers", 5197, days), discount(-2598, days)]);
  });

  it("supervisor: a change of plan on 15 Jan bills each plan for its own days, never two full prices", async () => {
    const old = await assign(appliance.instanceId);
    await endPlan(holder.pool, { boxPlanId: old.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-15T00:00:00.000Z") });
    await otherPlan("bigger-plan", { name: "Bigger box", boxChf: "150" });
    await setPlanFunction(holder.pool, { planId: "bigger-plan", bundleId: "customers", granted: true, administrator: ADMIN });
    await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "bigger-plan", startsOn: "2027-01-15", administrator: ADMIN, now: new Date("2027-01-15T00:00:00.000Z") });
    // 1 to 14 Jan on the old plan, 15 to 31 Jan on the new one: the workflow adds up to one month
    expect(kinds(await invoiceLines(holder.pool, { month: "2027-01" }), "box", "workflow", "discount")).toEqual([
      ["box", "Truchsess box, monthly", 4516, "14 of 31 days"],
      ["box", "Bigger box, monthly", 8226, "17 of 31 days"],
      workflow("Customers", 8084, "14 of 31 days"),
      workflow("Customers", 9816, "17 of 31 days"),
      discount(-4042, "14 of 31 days"),
    ]);
  });

  it("supervisor: end-plan then assign-plan of the same plan in one month bills only the days held, same number and early bird", async () => {
    const first = await assign(appliance.instanceId);
    await endPlan(holder.pool, { boxPlanId: first.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-10T00:00:00.000Z") });
    const again = await assign(appliance.instanceId, { startsOn: "2027-01-20", now: new Date("2027-01-12T00:00:00.000Z") });
    expect([again.customerNumber, again.boxPriceCents, again.earlyBird?.discountBasisPoints]).toEqual([first.customerNumber, 10000, 5000]);
    const lines = await invoiceLines(holder.pool, { month: "2027-01" });
    // 9 days (1 to 9 Jan) and 12 days (20 to 31 Jan) of each monthly line, not two full months
    expect(kinds(lines, "discount")).toEqual([discount(-2598, "9 of 31 days"), discount(-3465, "12 of 31 days")]);
    expect(lines.find((line) => line.line === "subtotal")?.amountCents).toBe(2903 + 3871 + 5197 + 6929 - 2598 - 3465);
  });

  it("supervisor: the next customer number is the highest counting number plus one, also after a box is marked later", async () => {
    await define({ earlyBirdCustomers: 5 });
    const boxes = [appliance.instanceId, await newBox(), await newBox(), await newBox(), await newBox()];
    for (const box of boxes) await assign(box);
    await markBox(holder.pool, { tenantId, instanceId: boxes[2], as: "test", administrator: ADMIN });
    const sixth = await assign(await newBox(), { ownHardware: true });
    expect([sixth.customerNumber, sixth.earlyBird]).toEqual([6, null]);
    const numbers = (await holder.pool.query("SELECT customer_number FROM company_os_box_plans WHERE customer_number IS NOT NULL ORDER BY customer_number")).rows.map((row) => row.customer_number);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await planList(holder.pool)).find((plan: { id: string }) => plan.id === PLAN)).toMatchObject({ payingCustomers: 5, nextCustomerNumber: 7, nextCustomerGetsEarlyBird: false });
  });

  it("supervisor: without a VAT rate the box is told plainly that the month's costs are not ready, and keeps its AI allowance", async () => {
    await officeBox();
    await holder.pool.query("DELETE FROM company_os_vat_rates");
    const response = await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-01"));
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ready: false, message: "The costs for this month are not ready yet. Old School is preparing them.", lines: [], plan: { planId: PLAN }, aiAllowance: { usdCents: 6000, topUpChfCents: 0 } });
    await expect(invoiceLines(holder.pool, { month: "2027-01" })).rejects.toThrow("vat_rate_missing_for:2027-01");
  });

  it("Codex P2: ending a plan passes its exact deadline to its subscriptions (no day lost to rounding)", async () => {
    const assigned = await assign(appliance.instanceId, { endsOn: "2027-02-01" });
    const addOn = await grant(appliance.instanceId, "extra-workflow");
    const ended = await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 14, administrator: ADMIN, now: new Date("2027-01-25T18:00:00.000Z") });
    expect(ended.endsAt).toBe("2027-02-01T00:00:00.000Z");
    expect(ended.subscriptions.every((item: { effectiveAt: string }) => item.effectiveAt === "2027-02-01T00:00:00.000Z")).toBe(true);
    const row = await holder.pool.query("SELECT cancel_effective_at FROM company_os_bundle_subscriptions WHERE id=$1", [addOn.subscriptionId]);
    expect(new Date(row.rows[0].cancel_effective_at).toISOString()).toBe("2027-02-01T00:00:00.000Z");
    expect((await invoiceLines(holder.pool, { month: "2027-01" })).find((line) => line.line === "workflow" && line.description === "Extra workflow")).toMatchObject({ amountCents: 17900, note: "" });
  });

  it("Codex P2: a workflow with a later end of its own stops billing when its plan ends", async () => {
    await assign(appliance.instanceId, { endsOn: "2027-02-01" });
    await grant(appliance.instanceId, "extra-workflow", { endsOn: "2027-03-01" });
    expect((await invoiceLines(holder.pool, { month: "2027-01" })).find((line) => line.line === "workflow" && line.description === "Extra workflow")).toMatchObject({ amountCents: 17900 });
    expect(await invoiceLines(holder.pool, { month: "2027-02" })).toEqual([]);
  });

  it("Codex P2: ending a plan also brings forward a later end an administrator had already set", async () => {
    await assign(appliance.instanceId);
    const addOn = await grant(appliance.instanceId, "extra-workflow");
    await endSubscriptionByAdmin(holder.pool, { subscriptionId: addOn.subscriptionId, graceDays: 20, administrator: ADMIN, now: new Date("2027-01-12T00:00:00.000Z") });
    const boxPlan = (await holder.pool.query("SELECT id FROM company_os_box_plans WHERE instance_id=$1", [appliance.instanceId])).rows[0].id;
    await endPlan(holder.pool, { boxPlanId: boxPlan, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-15T00:00:00.000Z") });
    const row = (await holder.pool.query("SELECT subscription_state,stopped_at FROM company_os_bundle_subscriptions WHERE id=$1", [addOn.subscriptionId])).rows[0];
    expect(row.subscription_state).toBe("cancelled");
    expect(new Date(row.stopped_at).toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });

  it("Codex P2: one currency per box: other currencies are refused, never added up", async () => {
    await upsertBundle({ id: "dollar-workflow", name: "Dollar workflow", description: "Priced in USD.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 9900, currency: "usd" });
    const box = await newBox();
    await grant(box, "dollar-workflow");
    await expect(assign(box)).rejects.toThrow("box_currency_differs_from_plan:usd:chf");
    await expect(grant(box, "extra-workflow")).rejects.toThrow("box_currency_differs:usd:chf");
    await assign(appliance.instanceId);
    await holder.pool.query("INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,copy_number,billing_description,billing_provider,subscription_state,entitled_at,billing_starts_at,invoice_monthly_cents) VALUES($1,$2,$3,'dollar-workflow',1,'Dollar workflow','invoice','active','2026-12-01','2026-12-01',9900)", [randomUUID(), tenantId, appliance.instanceId]);
    await expect(invoiceLines(holder.pool, { month: "2027-01" })).rejects.toThrow(`box_has_more_than_one_currency:${appliance.instanceId}:chf,usd`);
  });

  it("Codex P2: a plan grants only workflows in its own currency", async () => {
    await upsertBundle({ id: "dollar-workflow", name: "Dollar workflow", description: "Priced in USD.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 0, currency: "usd" });
    await expect(setPlanFunction(holder.pool, { planId: PLAN, bundleId: "dollar-workflow", granted: true, administrator: ADMIN })).rejects.toThrow("granted_workflow_currency_differs_from_plan:usd:chf");
    await holder.pool.query("UPDATE company_os_function_bundles SET currency='usd' WHERE id='customers'");
    await expect(assign(appliance.instanceId)).rejects.toThrow("workflow_currency_differs_from_plan:usd:chf");
  });

  it("Codex P2: a subscription on a plan loses its entitlement when the plan ends, whatever later end it has", async () => {
    await assign(appliance.instanceId, { endsOn: "2027-02-01" });
    const addOn = await grant(appliance.instanceId, "extra-workflow", { endsOn: "2027-03-01" });
    expect(addOn.endsAt).toBe("2027-02-01T00:00:00.000Z");
    await holder.pool.query("UPDATE company_os_bundle_subscriptions SET billing_ends_at='2027-03-01T00:00:00Z' WHERE id=$1", [addOn.subscriptionId]);
    const swept = await applyDueSubscriptionDates(holder.pool, { now: new Date("2027-02-02T00:00:00.000Z") });
    expect(swept.ended).toEqual(expect.arrayContaining([{ subscriptionId: addOn.subscriptionId, reason: "plan_ended", stoppedAt: "2027-02-01T00:00:00.000Z" }]));
    expect((await holder.pool.query("SELECT subscription_state FROM company_os_bundle_subscriptions WHERE id=$1", [addOn.subscriptionId])).rows[0].subscription_state).toBe("cancelled");
  });

  it("Codex P2: a box keeps the workflows its plan granted when it got the plan", async () => {
    await assign(appliance.instanceId);
    await setPlanFunction(holder.pool, { planId: PLAN, bundleId: "extra-workflow", granted: true, administrator: ADMIN });
    await setPlanFunction(holder.pool, { planId: PLAN, bundleId: "customers", granted: false, administrator: ADMIN });
    const view = (await (await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-01"))).json()) as { plan: { workflows: Array<{ bundleId: string }> } };
    expect(view.plan.workflows.map((item) => item.bundleId)).toEqual(["customers"]);
    const fresh = await assign(await newBox());
    expect(fresh.granted.map((item: { bundleId: string }) => item.bundleId)).toEqual(["extra-workflow"]);
  });

  it("Codex P2: a one-time line keeps its own plan's VAT basis after that plan ended", async () => {
    await otherPlan("gross-plan", { pricesExcludeVat: false });
    await setPlanFunction(holder.pool, { planId: "gross-plan", bundleId: "customers", granted: true, administrator: ADMIN });
    // the line for February is recorded while the plan runs; the plan is ended afterwards, on 1 Feb
    const gross = await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "gross-plan", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    await addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-02", kind: "ai-use-above-allowance", amountChf: "108.10", administrator: ADMIN, now: NOW });
    await endPlan(holder.pool, { boxPlanId: gross.boxPlanId, graceDays: 1, administrator: ADMIN, now: new Date("2027-01-31T00:00:00.000Z") });
    expect(totals(await invoiceLines(holder.pool, { month: "2027-02" }))).toEqual([10000, 810, 10810]);
  });

  it("Codex P2: a top-up added later for an earlier month uses that month's plan and rate", async () => {
    const january = await assign(appliance.instanceId, { startsOn: "2027-01-01" });
    await endPlan(holder.pool, { boxPlanId: january.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-02-01T00:00:00.000Z") });
    await otherPlan("rich-plan", { topUpUsdPerChf: "2" });
    await setPlanFunction(holder.pool, { planId: "rich-plan", bundleId: "customers", granted: true, administrator: ADMIN });
    await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "rich-plan", startsOn: "2027-02-01", administrator: ADMIN, now: new Date("2027-02-01T00:00:00.000Z") });
    // in February, a CHF 20 top-up for January: January's rate (USD 1 per CHF), not February's
    const late = await addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: new Date("2027-02-05T00:00:00.000Z") });
    expect(late.allowanceUsdCents).toBe(2000);
    const february = await addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-02", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: new Date("2027-02-05T00:00:00.000Z") });
    expect(february.allowanceUsdCents).toBe(4000);
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2026-11", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("box_has_no_plan_in_month");
  });

  it("Codex P2: a later change of a workflow's catalog currency or allowance never rewrites its invoices", async () => {
    const box = await newBox("standalone");
    await grant(box, "extra-workflow");
    await officeBox();
    // the catalog entry moves to USD and loses its allowance later: what was granted stays
    await upsertBundle({ id: "extra-workflow", name: "Extra workflow", description: "A later workflow.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 17900, currency: "usd" });
    await holder.pool.query("UPDATE company_os_function_bundles SET ai_allowance_usd_cents=0");
    const january = await invoiceLines(holder.pool, { month: "2027-01" });
    expect(january.filter((line) => line.instanceId === box).every((line) => line.currency === "chf")).toBe(true);
    expect(january.find((line) => line.instanceId === box && line.line === "workflow")).toMatchObject({ allowanceUsdCents: 3000 });
    expect(january.find((line) => line.instanceId === appliance.instanceId && line.line === "subtotal")?.amountCents).toBe(42750);
  });

  it("refuses plan data and invoice lines that would be wrong", async () => {
    const plan = (input: Record<string, unknown>) => definePlan(holder.pool, planInput({ id: "p", name: "P", ...input } as Partial<Plan>));
    await expect(plan({ boxChf: "100.999" })).rejects.toThrow("box_price_invalid");
    await expect(plan({ boxChf: "-1" })).rejects.toThrow("box_price_invalid");
    await expect(plan({ earlyBirdPercent: "101" })).rejects.toThrow("early_bird_percent_invalid");
    await expect(plan({ earlyBirdCustomers: -1 })).rejects.toThrow("early_bird_customers_invalid");
    await expect(plan({ earlyBirdNote: null })).rejects.toThrow("early_bird_note_required");
    await expect(plan({ topUpUsdPerChf: "-1" })).rejects.toThrow("top_up_usd_per_chf_invalid");
    await expect(plan({ includes: [] })).rejects.toThrow("includes_invalid");
    await expect(plan({ pricesExcludeVat: undefined })).rejects.toThrow("prices_exclude_vat_required");
    await expect(plan({ administrator: "" })).rejects.toThrow("administrator_required");
    await expect(setBundleKind(holder.pool, { bundleId: "customers", kind: "person", administrator: ADMIN })).rejects.toThrow("bundle_kind_invalid");
    await expect(setVatRate(holder.pool, { from: "2024-01", percent: "8.1", administrator: ADMIN })).rejects.toThrow("vat_from_invalid");
    await expect(setVatRate(holder.pool, { from: "2024-01-01", percent: "8,1", administrator: ADMIN })).rejects.toThrow("vat_percent_invalid");
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("box_has_no_plan");
    // a top-up needs a rate: a plan without one has none
    await plan({ topUpUsdPerChf: "0" });
    await setPlanFunction(holder.pool, { planId: "p", bundleId: "customers", granted: true, administrator: ADMIN });
    const plain = await newBox();
    await assignPlan(holder.pool, { tenantId, instanceId: plain, planId: "p", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: plain, month: "2027-01", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("plan_has_no_top_up_rate");
    await officeBox();
    await expect(assign(appliance.instanceId)).rejects.toThrow("box_has_a_plan");
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "discount", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("invoice_line_kind_invalid");
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-1", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("month_invalid");
    const audit = await holder.pool.query("SELECT action,administrator FROM company_os_plan_audit ORDER BY created_at");
    expect(audit.rows.every((row) => row.administrator === ADMIN)).toBe(true);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["vat_rate_set", "plan_defined", "plan_function_changed", "plan_assigned"]));
  });

  it("keeps every price, allowance, discount and rate in data: none is written in the store's code or migrations", () => {
    for (const file of ["../lib/companyOs/boxPlans.mjs", "../lib/companyOs/subscriptionOrders.mjs", "../app/api/company-os/v1/storeHandlers.ts", "../../scripts/company-os-store-admin.mjs"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
      expect(source, file).not.toMatch(/\b(17900|179|8950|89\.50|5900|27900|18950|3000|8\.1|810)\b/);
    }
    for (const name of ["20261127_st1_plans_and_invoices.sql", "20261128_st1_plan_prices_and_vat.sql", "20261130_st1_workflow_lines.sql", "20261202_st1_final_structure.sql"]) {
      const sql = readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), "utf8");
      expect(() => assertSafeMigration(name, sql)).not.toThrow();
      expect(sql).not.toMatch(/INSERT INTO/i);
    }
  });
});
