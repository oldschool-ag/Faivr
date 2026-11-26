import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as unknown as import("pg").Pool }));
vi.mock("@/lib/postgres", () => ({ getPgPool: () => holder.pool }));

import { addPackageToBundle, enrolPublisher, issueEnrolmentCode, upsertBundle } from "@/lib/companyOs/privateStore";
import { addInvoiceLine, assignPlan, definePlan, endPlan, invoiceCsv, invoiceLines, markBox, planList, setPlanFunction, setVatRate } from "@/lib/companyOs/boxPlans.mjs";
import { applyDueSubscriptionDates, endSubscriptionByAdmin, grantSubscriptionByOrder } from "@/lib/companyOs/subscriptionOrders.mjs";
import { keyIdFor, loadEd25519PublicKey } from "@/lib/companyOs/publisherKeys";
import { enrol, storeInstallations, storePlan } from "@/app/api/company-os/v1/storeHandlers";
import { createStoreDb, ed25519Pair, envelope, signedManifest, signedRequest, type Appliance } from "./helpers/companyOsStoreDb";
import { assertSafeMigration } from "../scripts/run-store-migrations.mjs";

/**
 * ST1 plans with the CEO's corrections of 26 Nov 2026, entered as data the way the admin command
 * enters them: one plan for two workflows (Customers, Product management), CHF 149 plus VAT for
 * customers 1 to 50 and CHF 249 plus VAT from customer 51, CHF 30 of AI use included, no free
 * month, Swiss VAT on top; test boxes and Old School's own boxes never count and are not invoiced.
 */

const CUSTOMERS_MODEL = "faivr.agent.penn";
const ADMIN = "bernd (CEO)";
const NOW = new Date("2026-11-26T12:00:00.000Z");
const PLAN = "customers-and-product-management";
const PLAN_NAME = "Customers and Product management";
const INCLUDES = ["Setup in our office", "Updates of agents, system and AI", "Safety copies", "Support", "2 years warranty on the box"];
const DAY = 24 * 60 * 60 * 1000;

describe("ST1 plans: what Old School invoices per box", () => {
  let appliance: Appliance;
  let tenantId: string;

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
    // workflows and list prices are catalog data
    await upsertBundle({ id: "customers", name: "Customers", description: "CRM with Penn.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 0 });
    await upsertBundle({ id: "product-management", name: "Product management", description: "The Product Owner (pilot).", stripePriceId: null, polarProductId: null, monthlyPriceCents: 0 });
    await upsertBundle({ id: "extra-workflow", name: "Extra workflow", description: "An add-on.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 9900 });
    await addPackageToBundle("customers", CUSTOMERS_MODEL);
    const issued = await issueEnrolmentCode({ label: "Office box", createdBy: "store-admin" });
    tenantId = issued.tenantId;
    appliance = { tenantId, instanceId: "", keyId: "", keys: ed25519Pair() };
    const response = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentCode: issued.code, appliancePublicKeyPem: appliance.keys.publicPem, label: "Muster AG office" }) }));
    const body = (await response.json()) as Record<string, string>;
    appliance.instanceId = body.instanceId;
    appliance.keyId = body.keyId;
    await setVatRate(holder.pool, { from: "2024-01-01", percent: "8.1", administrator: ADMIN });
    await definePlan(holder.pool, { id: PLAN, name: PLAN_NAME, prices: "1=149|51=249", aiAllowanceChf: "30", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN });
    await setPlanFunction(holder.pool, { planId: PLAN, bundleId: "customers", included: true, administrator: ADMIN });
    await setPlanFunction(holder.pool, { planId: PLAN, bundleId: "product-management", included: true, administrator: ADMIN });
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

  async function officeBox() {
    const assigned = await assign(appliance.instanceId);
    const addOn = await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "extra-workflow", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    return { assigned, addOn };
  }

  const summary = (lines: Array<Record<string, unknown>>) => lines.map((line) => [line.line, line.description, line.amountCents, line.note]);
  const head = [
    ["plan_includes", `Includes: ${INCLUDES.join("; ")}`, 0, "included in your plan"],
    ["ai_allowance", "AI use up to CHF 30.00 per month", 0, "included in your plan"],
    ["included_function", "Customers", 0, "included in your plan"],
    ["included_function", "Product management", 0, "included in your plan"],
  ];

  it("gives a box the plan: both workflows at CHF 0, an add-on at list price, and the box installs", async () => {
    const { assigned, addOn } = await officeBox();
    expect(assigned).toMatchObject({ planId: PLAN, planName: PLAN_NAME, customerNumber: 1, mark: null, monthlyPriceCents: 14900, startsAt: "2026-12-01T00:00:00.000Z", grantedBy: ADMIN });
    expect(assigned.granted.map((item: { bundleId: string; includedInPlan: boolean; monthlyPriceCents: number }) => [item.bundleId, item.includedInPlan, item.monthlyPriceCents])).toEqual([["customers", true, 0], ["product-management", true, 0]]);
    expect(addOn).toMatchObject({ bundleId: "extra-workflow", includedInPlan: false, monthlyPriceCents: 9900, boxPlanId: assigned.boxPlanId });
    const installBody = envelope(appliance, { bundleId: "customers", faivrAgentModelId: CUSTOMERS_MODEL });
    expect((await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", installBody, { idempotencyKey: installBody.idempotencyKey as string }))).status).toBe(201);
  });

  it("bills from the first month, plus Swiss VAT: net, VAT and total", async () => {
    await officeBox();
    expect(summary(await invoiceLines(holder.pool, { month: "2026-12" }))).toEqual([
      ["plan", `${PLAN_NAME}, monthly`, 14900, ""],
      ...head,
      ["add_on", "Extra workflow", 9900, "add-on, list price"],
      ["subtotal", "Subtotal 2026-12, net", 24800, ""],
      ["vat", "VAT 8.1%", 2009, ""],
      ["total", "Total 2026-12", 26809, ""],
    ]);
    await addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW });
    const january = await invoiceLines(holder.pool, { month: "2027-01" });
    expect(summary(january).slice(-4)).toEqual([
      ["ai_top_up", "AI top-up", 2000, "one-time"],
      ["subtotal", "Subtotal 2027-01, net", 26800, ""],
      ["vat", "VAT 8.1%", 2171, ""],
      ["total", "Total 2027-01", 28971, ""],
    ]);
    expect(january.every((line) => line.box === "Muster AG office" && line.plan === PLAN_NAME && line.vat === "plus VAT" && line.currency === "chf" && line.invoiced === true)).toBe(true);
    // November, before the plan starts: nothing
    expect(await invoiceLines(holder.pool, { month: "2026-11" })).toEqual([]);
    const csv = invoiceCsv(january).split("\n");
    expect(csv[0]).toBe("month,box,tenant_id,instance_id,plan,line,description,amount,currency,vat,note");
    expect(csv[1]).toBe(`2027-01,Muster AG office,${tenantId},${appliance.instanceId},${PLAN_NAME},plan,"${PLAN_NAME}, monthly",149.00,CHF,plus VAT,`);
    expect(csv.slice(-4, -1)).toEqual([
      `2027-01,Muster AG office,${tenantId},${appliance.instanceId},${PLAN_NAME},subtotal,"Subtotal 2027-01, net",268.00,CHF,plus VAT,`,
      `2027-01,Muster AG office,${tenantId},${appliance.instanceId},${PLAN_NAME},vat,VAT 8.1%,21.71,CHF,plus VAT,`,
      `2027-01,Muster AG office,${tenantId},${appliance.instanceId},${PLAN_NAME},total,Total 2027-01,289.71,CHF,plus VAT,`,
    ]);
  });

  it("uses the VAT rate in force on the month's first day, and refuses a month without one", async () => {
    await officeBox();
    await setVatRate(holder.pool, { from: "2027-02-01", percent: "9", administrator: ADMIN });
    expect((await invoiceLines(holder.pool, { month: "2027-01" })).find((line) => line.line === "vat")).toMatchObject({ description: "VAT 8.1%", amountCents: 2009 });
    expect((await invoiceLines(holder.pool, { month: "2027-02" })).find((line) => line.line === "vat")).toMatchObject({ description: "VAT 9%", amountCents: 2232 });
    await holder.pool.query("DELETE FROM company_os_vat_rates");
    await expect(invoiceLines(holder.pool, { month: "2027-01" })).rejects.toThrow("vat_rate_missing_for:2027-01");
  });

  it("prices customers by number: the first ones keep the lower price, later ones pay the next step", async () => {
    // the steps as data: here customers 1 and 2 at CHF 149, from customer 3 CHF 249
    await definePlan(holder.pool, { id: PLAN, name: PLAN_NAME, prices: "1=149|3=249", aiAllowanceChf: "30", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN });
    const first = await assign(appliance.instanceId);
    const second = await assign(await newBox());
    const third = await assign(await newBox());
    expect([first, second, third].map((item) => [item.customerNumber, item.monthlyPriceCents])).toEqual([[1, 14900], [2, 14900], [3, 24900]]);
    // the first customer leaves and comes back: same number, same price
    await endPlan(holder.pool, { boxPlanId: first.boxPlanId, graceDays: 0, administrator: ADMIN, now: NOW });
    const back = await assign(appliance.instanceId, { now: new Date(NOW.getTime() + 1000) });
    expect([back.customerNumber, back.monthlyPriceCents]).toEqual([1, 14900]);
    // a later price change applies only to boxes that get the plan afterwards
    await definePlan(holder.pool, { id: PLAN, name: PLAN_NAME, prices: "1=199", aiAllowanceChf: "30", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN });
    const plans = (await invoiceLines(holder.pool, { month: "2027-01" })).filter((line) => line.line === "plan").map((line) => line.amountCents);
    expect(plans.sort()).toEqual([14900, 14900, 24900]);
    expect((await planList(holder.pool)).find((plan: { id: string }) => plan.id === PLAN)).toMatchObject({ payingCustomers: 3, nextCustomerPays: 19900, workflows: ["customers", "product-management"], prices: [{ fromCustomer: 1, monthlyPriceCents: 19900 }] });
  });

  it("never counts or invoices a test box or Old School's own box; only an administrator marks one", async () => {
    await definePlan(holder.pool, { id: PLAN, name: PLAN_NAME, prices: "1=149|2=249", aiAllowanceChf: "30", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN });
    const boxOne = await newBox("box 1");
    const testUser = await newBox("test user");
    await markBox(holder.pool, { tenantId, instanceId: boxOne, as: "old-school", note: "box 1", administrator: ADMIN });
    await markBox(holder.pool, { tenantId, instanceId: testUser, as: "test", administrator: ADMIN });
    expect(await assign(boxOne)).toMatchObject({ customerNumber: null, mark: "old_school", monthlyPriceCents: 14900 });
    expect(await assign(testUser)).toMatchObject({ customerNumber: null, mark: "test" });
    // the first paying customer is still customer 1, at the first step
    expect(await assign(appliance.instanceId)).toMatchObject({ customerNumber: 1, monthlyPriceCents: 14900 });
    const lines = await invoiceLines(holder.pool, { month: "2027-01" });
    expect(lines.filter((line) => line.instanceId === boxOne).at(-1)).toMatchObject({ line: "total", invoiced: false, note: "not invoiced: Old School's own box" });
    const csv = invoiceCsv(lines);
    expect(csv).not.toContain(boxOne);
    expect(csv).not.toContain(testUser);
    expect(csv).toContain(appliance.instanceId);
    expect(invoiceCsv(lines, { includeNotInvoiced: true })).toContain(testUser);
    await expect(markBox(holder.pool, { tenantId, instanceId: testUser, as: "paying", administrator: ADMIN })).rejects.toThrow("mark_invalid");
    // no store route a box can call sets a mark
    const handlers = readFileSync(new URL("../app/api/company-os/v1/storeHandlers.ts", import.meta.url), "utf8") + readFileSync(new URL("../app/api/company-os/v1/handlers.ts", import.meta.url), "utf8");
    expect(handlers).not.toMatch(/markBox|company_os_box_marks/);
  });

  it("shows the box the same lines it is invoiced for, on its Plan and costs page", async () => {
    await officeBox();
    const response = await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-01"));
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.plan).toEqual({ planId: PLAN, name: PLAN_NAME, monthlyPriceCents: 14900, currency: "chf", pricesExcludeVat: true, aiAllowanceCents: 3000, freeMonths: 0, includes: INCLUDES, startsAt: "2026-12-01T00:00:00.000Z", endsAt: null, workflows: [{ bundleId: "customers", name: "Customers" }, { bundleId: "product-management", name: "Product management" }] });
    const invoiced = (await invoiceLines(holder.pool, { month: "2027-01", tenantId, instanceId: appliance.instanceId })).map(({ tenantId: _t, instanceId: _i, ...line }) => line);
    expect(body.lines).toEqual(invoiced);
    expect([body.ready, body.message, body.netCents, body.vatCents, body.totalCents]).toEqual([true, null, 24800, 2009, 26809]);
    expect(JSON.stringify(body)).not.toContain(tenantId);
    expect(JSON.stringify(body)).not.toContain("customer 1");
    expect((await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-13"))).status).toBe(400);
  });

  it("ends a plan with its subscriptions after the grace; the last month is billed by its days, nothing after", async () => {
    const { assigned } = await officeBox();
    const endAt = new Date("2027-02-10T00:00:00.000Z");
    const ended = await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 14, administrator: ADMIN, reason: "contract ends", now: new Date(endAt.getTime() - 14 * DAY) });
    expect(ended).toMatchObject({ endsAt: endAt.toISOString(), endedBy: ADMIN });
    expect(ended.subscriptions).toHaveLength(3);
    await applyDueSubscriptionDates(holder.pool, { now: new Date(endAt.getTime() + 1000) });
    const states = await holder.pool.query("SELECT subscription_state FROM company_os_bundle_subscriptions");
    expect(states.rows.every((row) => row.subscription_state === "cancelled")).toBe(true);
    // 1 to 9 February: 9 of 28 days of CHF 149 (47.89) and of the add-on's CHF 99 (31.82)
    expect(summary(await invoiceLines(holder.pool, { month: "2027-02" })).filter((line) => ["plan", "add_on", "subtotal"].includes(line[0] as string))).toEqual([
      ["plan", `${PLAN_NAME}, monthly`, 4789, "9 of 28 days"],
      ["add_on", "Extra workflow", 3182, "add-on, list price, 9 of 28 days"],
      ["subtotal", "Subtotal 2027-02, net", 7971, ""],
    ]);
    expect(await invoiceLines(holder.pool, { month: "2027-03" })).toEqual([]);
  });

  it("lists add-ons of a box without a plan, and never a subscription a provider bills", async () => {
    const box = await newBox();
    await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: box, bundleId: "extra-workflow", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    await holder.pool.query("INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,copy_number,billing_description,billing_provider,subscription_state,entitled_at) VALUES($1,$2,$3,'customers',1,'Customers','polar','active',now())", [randomUUID(), tenantId, box]);
    expect(summary(await invoiceLines(holder.pool, { month: "2027-01" }))).toEqual([
      ["no_plan", "No plan on this box", 0, "add-ons only"],
      ["add_on", "Extra workflow", 9900, "add-on, list price"],
      ["subtotal", "Subtotal 2027-01, net", 9900, ""],
      ["vat", "VAT 8.1%", 802, ""],
      ["total", "Total 2027-01", 10702, ""],
    ]);
  });

  it("Codex P2: a plan that a paid subscription joins does not rewrite the months before it", async () => {
    await holder.pool.query("UPDATE company_os_function_bundles SET monthly_price_cents=5000 WHERE id='customers'");
    await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "customers", startsOn: "2026-11-01", administrator: ADMIN, now: NOW });
    await assign(appliance.instanceId);
    expect(summary(await invoiceLines(holder.pool, { month: "2026-11" })).filter((line) => line[0] === "add_on" || line[0] === "subtotal")).toEqual([["add_on", "Customers", 5000, "add-on, list price"], ["subtotal", "Subtotal 2026-11, net", 5000, ""]]);
    expect(summary(await invoiceLines(holder.pool, { month: "2026-12" })).filter((line) => line[2] === 0 && line[0] === "included_function").map((line) => line[1])).toEqual(["Customers", "Product management"]);
    expect((await invoiceLines(holder.pool, { month: "2026-12" })).find((line) => line.line === "subtotal")?.amountCents).toBe(14900);
  });

  it("Codex P2: a plan ended before it started is not invoiced", async () => {
    const assigned = await assign(appliance.instanceId, { startsOn: "2026-12-20" });
    await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2026-12-10T00:00:00.000Z") });
    expect(await invoiceLines(holder.pool, { month: "2026-12" })).toEqual([]);
  });

  it("Codex P2: a month with a change of plan bills both plans, each with its own free months", async () => {
    const old = await assign(appliance.instanceId, { startsOn: "2027-01-01" });
    await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "extra-workflow", startsOn: "2027-01-01", administrator: ADMIN, now: NOW });
    await endPlan(holder.pool, { boxPlanId: old.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-10T00:00:00.000Z") });
    await definePlan(holder.pool, { id: "next-plan", name: "Next plan", prices: "1=199", aiAllowanceChf: "30", freeMonths: 1, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN });
    await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "next-plan", startsOn: "2027-01-15", administrator: ADMIN, now: new Date("2027-01-12T00:00:00.000Z") });
    const january = summary(await invoiceLines(holder.pool, { month: "2027-01" }));
    expect(january.filter((line) => line[0] === "plan")).toEqual([["plan", `${PLAN_NAME}, monthly`, 4326, "9 of 31 days"], ["plan", "Next plan, monthly", 0, "free month 1 of 1"]]);
    // the add-on of the old plan (its 9 days) is not waived by the new plan's free month
    expect(january.filter((line) => line[0] === "add_on")).toEqual([["add_on", "Extra workflow", 2874, "add-on, list price, 9 of 31 days"]]);
    expect(january.find((line) => line[0] === "subtotal")?.[2]).toBe(7200);
  });

  it("Codex P2: a customer who returns after a price change keeps its number and its price", async () => {
    const first = await assign(appliance.instanceId);
    await endPlan(holder.pool, { boxPlanId: first.boxPlanId, graceDays: 0, administrator: ADMIN, now: NOW });
    await definePlan(holder.pool, { id: PLAN, name: PLAN_NAME, prices: "1=199", aiAllowanceChf: "30", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN });
    const back = await assign(appliance.instanceId, { now: new Date(NOW.getTime() + 1000) });
    expect([back.customerNumber, back.monthlyPriceCents]).toEqual([1, 14900]);
    // a new customer pays today's steps
    expect((await assign(await newBox())).monthlyPriceCents).toBe(19900);
  });

  it("Codex P2: a month with a plan before VAT and a plan with VAT applies each plan's basis", async () => {
    await definePlan(holder.pool, { id: "net-plan", name: "Net plan", prices: "1=100", aiAllowanceChf: "0", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN });
    await definePlan(holder.pool, { id: "gross-plan", name: "Gross plan", prices: "1=108.10", aiAllowanceChf: "0", freeMonths: 0, pricesExcludeVat: false, includes: INCLUDES, administrator: ADMIN });
    const old = await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "net-plan", startsOn: "2027-01-01", administrator: ADMIN, now: NOW });
    await endPlan(holder.pool, { boxPlanId: old.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-10T00:00:00.000Z") });
    await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "gross-plan", startsOn: "2027-01-15", administrator: ADMIN, now: new Date("2027-01-12T00:00:00.000Z") });
    const january = await invoiceLines(holder.pool, { month: "2027-01" });
    // 1 to 9 Jan of CHF 100 before VAT (29.03, VAT 2.35 on top); 15 to 31 Jan of CHF 108.10 with VAT (59.28, of which VAT 4.44)
    expect(["subtotal", "vat", "total"].map((name) => january.find((line) => line.line === name)?.amountCents)).toEqual([2903 + 5484, 235 + 444, 2903 + 5928 + 235]);
  });

  it("supervisor: a plan starting on 2 Dec bills 30 of 31 days in December, its add-on the same days", async () => {
    await assign(appliance.instanceId, { startsOn: "2026-12-02" });
    await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "extra-workflow", startsOn: "2026-12-02", administrator: ADMIN, now: NOW });
    expect(summary(await invoiceLines(holder.pool, { month: "2026-12" })).filter((line) => ["plan", "add_on", "subtotal"].includes(line[0] as string))).toEqual([
      ["plan", `${PLAN_NAME}, monthly`, 14419, "30 of 31 days"],
      ["add_on", "Extra workflow", 9581, "add-on, list price, 30 of 31 days"],
      ["subtotal", "Subtotal 2026-12, net", 24000, ""],
    ]);
    expect((await invoiceLines(holder.pool, { month: "2027-01" })).find((line) => line.line === "plan")).toMatchObject({ amountCents: 14900, note: "" });
  });

  it("supervisor: a plan ending on 10 Jan bills 9 of 31 days in January", async () => {
    const assigned = await assign(appliance.instanceId);
    await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-10T00:00:00.000Z") });
    expect((await invoiceLines(holder.pool, { month: "2027-01" })).find((line) => line.line === "plan")).toMatchObject({ amountCents: 4326, note: "9 of 31 days" });
  });

  it("supervisor: a change of plan on 15 Jan bills each plan for its own days, never two full prices", async () => {
    const old = await assign(appliance.instanceId);
    await endPlan(holder.pool, { boxPlanId: old.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-15T00:00:00.000Z") });
    await definePlan(holder.pool, { id: "bigger-plan", name: "Bigger plan", prices: "1=249", aiAllowanceChf: "30", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN });
    await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "bigger-plan", startsOn: "2027-01-15", administrator: ADMIN, now: new Date("2027-01-15T00:00:00.000Z") });
    const plans = summary(await invoiceLines(holder.pool, { month: "2027-01" })).filter((line) => line[0] === "plan");
    // 1 to 14 Jan at 149 (67.29), 15 to 31 Jan at 249 (136.55)
    expect(plans).toEqual([["plan", `${PLAN_NAME}, monthly`, 6729, "14 of 31 days"], ["plan", "Bigger plan, monthly", 13655, "17 of 31 days"]]);
  });

  it("supervisor: end-plan then assign-plan of the same plan in one month bills only the days held, same number and price", async () => {
    const first = await assign(appliance.instanceId);
    await endPlan(holder.pool, { boxPlanId: first.boxPlanId, graceDays: 0, administrator: ADMIN, now: new Date("2027-01-10T00:00:00.000Z") });
    const again = await assign(appliance.instanceId, { startsOn: "2027-01-20", now: new Date("2027-01-12T00:00:00.000Z") });
    expect([again.customerNumber, again.monthlyPriceCents]).toEqual([first.customerNumber, 14900]);
    const lines = await invoiceLines(holder.pool, { month: "2027-01" });
    // 9 days (1 to 9 Jan) and 12 days (20 to 31 Jan): 43.26 + 57.68, not 2 x 149
    expect(summary(lines).filter((line) => line[0] === "plan")).toEqual([["plan", `${PLAN_NAME}, monthly`, 4326, "9 of 31 days"], ["plan", `${PLAN_NAME}, monthly`, 5768, "12 of 31 days"]]);
    expect(lines.find((line) => line.line === "subtotal")?.amountCents).toBe(10094);
  });

  it("supervisor: the next customer number is the highest counting number plus one, also after a box is marked later", async () => {
    await definePlan(holder.pool, { id: PLAN, name: PLAN_NAME, prices: "1=149|6=249", aiAllowanceChf: "30", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, administrator: ADMIN });
    const boxes = [appliance.instanceId, await newBox(), await newBox(), await newBox(), await newBox()];
    for (const box of boxes) await assign(box);
    // box 3 turns out to be a test box
    await markBox(holder.pool, { tenantId, instanceId: boxes[2], as: "test", administrator: ADMIN });
    const sixth = await assign(await newBox());
    expect([sixth.customerNumber, sixth.monthlyPriceCents]).toEqual([6, 24900]);
    const numbers = (await holder.pool.query("SELECT customer_number FROM company_os_box_plans WHERE customer_number IS NOT NULL ORDER BY customer_number")).rows.map((row) => row.customer_number);
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6]);
    expect((await planList(holder.pool)).find((plan: { id: string }) => plan.id === PLAN)).toMatchObject({ payingCustomers: 5, nextCustomerNumber: 7, nextCustomerPays: 24900 });
  });

  it("supervisor: without a VAT rate the box is told plainly that the month's costs are not ready", async () => {
    await officeBox();
    await holder.pool.query("DELETE FROM company_os_vat_rates");
    const response = await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-01"));
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ready: false, message: "The costs for this month are not ready yet. Old School is preparing them.", lines: [], plan: { planId: PLAN } });
    // Old School's CSV still refuses, so no invoice goes out without VAT
    await expect(invoiceLines(holder.pool, { month: "2027-01" })).rejects.toThrow("vat_rate_missing_for:2027-01");
  });

  it("Codex P2: ending a plan passes its exact deadline to its subscriptions (no day lost to rounding)", async () => {
    const assigned = await assign(appliance.instanceId, { endsOn: "2027-02-01" });
    const addOn = await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "extra-workflow", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    const ended = await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 14, administrator: ADMIN, now: new Date("2027-01-25T18:00:00.000Z") });
    expect(ended.endsAt).toBe("2027-02-01T00:00:00.000Z");
    expect(ended.subscriptions.every((item: { effectiveAt: string }) => item.effectiveAt === "2027-02-01T00:00:00.000Z")).toBe(true);
    const row = await holder.pool.query("SELECT cancel_effective_at FROM company_os_bundle_subscriptions WHERE id=$1", [addOn.subscriptionId]);
    expect(new Date(row.rows[0].cancel_effective_at).toISOString()).toBe("2027-02-01T00:00:00.000Z");
    // the add-on is billed for all of January, like its plan
    expect((await invoiceLines(holder.pool, { month: "2027-01" })).find((line) => line.line === "add_on")).toMatchObject({ amountCents: 9900, note: "add-on, list price" });
  });

  it("Codex P2: an add-on with a later end of its own stops billing when its plan ends", async () => {
    await assign(appliance.instanceId, { endsOn: "2027-02-01" });
    await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "extra-workflow", startsOn: "2026-12-01", endsOn: "2027-03-01", administrator: ADMIN, now: NOW });
    expect((await invoiceLines(holder.pool, { month: "2027-01" })).find((line) => line.line === "add_on")).toMatchObject({ amountCents: 9900 });
    expect(await invoiceLines(holder.pool, { month: "2027-02" })).toEqual([]);
  });

  it("Codex P2: ending a plan also brings forward a later end an administrator had already set", async () => {
    await assign(appliance.instanceId);
    const addOn = await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "extra-workflow", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
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
    await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: box, bundleId: "dollar-workflow", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    await expect(assign(box)).rejects.toThrow("box_currency_differs_from_plan:usd:chf");
    await expect(grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: box, bundleId: "extra-workflow", startsOn: "2026-12-01", administrator: ADMIN, now: NOW })).rejects.toThrow("box_currency_differs:usd:chf");
    // data written around the commands is still refused when the invoice is built
    await assign(appliance.instanceId);
    await holder.pool.query("INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,copy_number,billing_description,billing_provider,subscription_state,entitled_at,billing_starts_at,invoice_monthly_cents) VALUES($1,$2,$3,'dollar-workflow',1,'Dollar workflow','invoice','active','2026-12-01','2026-12-01',9900)", [randomUUID(), tenantId, appliance.instanceId]);
    await expect(invoiceLines(holder.pool, { month: "2027-01" })).rejects.toThrow(`box_has_more_than_one_currency:${appliance.instanceId}:chf,usd`);
  });

  it("Codex P2: a plan includes only workflows in its own currency", async () => {
    await upsertBundle({ id: "dollar-workflow", name: "Dollar workflow", description: "Priced in USD.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 0, currency: "usd" });
    await expect(setPlanFunction(holder.pool, { planId: PLAN, bundleId: "dollar-workflow", included: true, administrator: ADMIN })).rejects.toThrow("included_workflow_currency_differs_from_plan:usd:chf");
    // a workflow whose currency changed after it was included is refused when the plan is given
    await holder.pool.query("UPDATE company_os_function_bundles SET currency='usd' WHERE id='product-management'");
    await expect(assign(appliance.instanceId)).rejects.toThrow("included_workflow_currency_differs_from_plan:usd:chf");
  });

  it("Codex P2: a subscription on a plan loses its entitlement when the plan ends, whatever later end it has", async () => {
    await assign(appliance.instanceId, { endsOn: "2027-02-01" });
    const addOn = await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "extra-workflow", startsOn: "2026-12-01", endsOn: "2027-03-01", administrator: ADMIN, now: NOW });
    expect(addOn.endsAt).toBe("2027-02-01T00:00:00.000Z");
    // data written around the commands: the sweep still follows the plan's end
    await holder.pool.query("UPDATE company_os_bundle_subscriptions SET billing_ends_at='2027-03-01T00:00:00Z' WHERE id=$1", [addOn.subscriptionId]);
    const swept = await applyDueSubscriptionDates(holder.pool, { now: new Date("2027-02-02T00:00:00.000Z") });
    expect(swept.ended).toEqual(expect.arrayContaining([{ subscriptionId: addOn.subscriptionId, reason: "plan_ended", stoppedAt: "2027-02-01T00:00:00.000Z" }]));
    expect((await holder.pool.query("SELECT subscription_state FROM company_os_bundle_subscriptions WHERE id=$1", [addOn.subscriptionId])).rows[0].subscription_state).toBe("cancelled");
  });

  it("Codex P2: a box keeps the workflows its plan included when it got the plan", async () => {
    await assign(appliance.instanceId);
    // later, for new customers only: the extra workflow is included, Product management no longer
    await setPlanFunction(holder.pool, { planId: PLAN, bundleId: "extra-workflow", included: true, administrator: ADMIN });
    await setPlanFunction(holder.pool, { planId: PLAN, bundleId: "product-management", included: false, administrator: ADMIN });
    // a later grant to the older box: the extra workflow is still an add-on at its price for it
    const addOn = await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "extra-workflow", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    expect(addOn).toMatchObject({ includedInPlan: false, monthlyPriceCents: 9900 });
    const view = (await (await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-01"))).json()) as { plan: { workflows: Array<{ bundleId: string }> } };
    expect(view.plan.workflows.map((item) => item.bundleId)).toEqual(["customers", "product-management"]);
    // a new box gets today's set
    const fresh = await assign(await newBox());
    expect(fresh.granted.map((item: { bundleId: string }) => item.bundleId)).toEqual(["customers", "extra-workflow"]);
  });

  it("Codex P2: a one-time line keeps its own plan's VAT basis after that plan ended", async () => {
    await definePlan(holder.pool, { id: "gross-plan", name: "Gross plan", prices: "1=100", aiAllowanceChf: "0", freeMonths: 0, pricesExcludeVat: false, includes: INCLUDES, administrator: ADMIN });
    await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "gross-plan", startsOn: "2026-12-01", endsOn: "2027-02-01", administrator: ADMIN, now: NOW });
    await addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-02", kind: "ai-top-up", amountChf: "108.10", administrator: ADMIN, now: NOW });
    const february = await invoiceLines(holder.pool, { month: "2027-02" });
    // VAT included: 108.10 is the total, of which 8.10 VAT
    expect(["subtotal", "vat", "total"].map((name) => february.find((line) => line.line === name)?.amountCents)).toEqual([10000, 810, 10810]);
  });

  it("refuses plan data and invoice lines that would be wrong", async () => {
    const plan = (input: Record<string, unknown>) => definePlan(holder.pool, { id: "p", name: "P", prices: "1=10", aiAllowanceChf: "0", freeMonths: 0, pricesExcludeVat: true, includes: ["Support"], administrator: ADMIN, ...input } as Parameters<typeof definePlan>[1]);
    await expect(plan({ prices: "1=149.999" })).rejects.toThrow("prices_invalid");
    await expect(plan({ prices: "51=249" })).rejects.toThrow("prices_invalid");
    await expect(plan({ prices: "1=149|1=249" })).rejects.toThrow("prices_invalid");
    await expect(plan({ includes: [] })).rejects.toThrow("includes_invalid");
    await expect(plan({ pricesExcludeVat: undefined })).rejects.toThrow("prices_exclude_vat_required");
    await expect(plan({ administrator: "" })).rejects.toThrow("administrator_required");
    await expect(setVatRate(holder.pool, { from: "2024-01", percent: "8.1", administrator: ADMIN })).rejects.toThrow("vat_from_invalid");
    await expect(setVatRate(holder.pool, { from: "2024-01-01", percent: "8,1", administrator: ADMIN })).rejects.toThrow("vat_percent_invalid");
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("box_has_no_plan");
    await officeBox();
    await expect(assign(appliance.instanceId)).rejects.toThrow("box_has_a_plan");
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "discount", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("invoice_line_kind_invalid");
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-1", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("month_invalid");
    const audit = await holder.pool.query("SELECT action,administrator FROM company_os_plan_audit ORDER BY created_at");
    expect(audit.rows.every((row) => row.administrator === ADMIN)).toBe(true);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["vat_rate_set", "plan_defined", "plan_function_changed", "plan_assigned"]));
  });

  it("keeps every price and rate in data: none is written in the store's code or migrations", () => {
    for (const file of ["../lib/companyOs/boxPlans.mjs", "../lib/companyOs/subscriptionOrders.mjs", "../app/api/company-os/v1/storeHandlers.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/\b(149|249|14900|24900|9900|3000|8\.1|810)\b/);
    }
    for (const name of ["20261127_st1_plans_and_invoices.sql", "20261128_st1_plan_prices_and_vat.sql"]) {
      const sql = readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), "utf8");
      expect(() => assertSafeMigration(name, sql)).not.toThrow();
      expect(sql).not.toMatch(/INSERT INTO/i);
    }
  });
});
