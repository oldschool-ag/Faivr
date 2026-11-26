import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as unknown as import("pg").Pool }));
vi.mock("@/lib/postgres", () => ({ getPgPool: () => holder.pool }));

import { addPackageToBundle, enrolPublisher, issueEnrolmentCode, upsertBundle } from "@/lib/companyOs/privateStore";
import { addInvoiceLine, assignPlan, definePlan, endPlan, invoiceCsv, invoiceLines, planList, setPlanFunction } from "@/lib/companyOs/boxPlans.mjs";
import { applyDueSubscriptionDates, grantSubscriptionByOrder } from "@/lib/companyOs/subscriptionOrders.mjs";
import { keyIdFor, loadEd25519PublicKey } from "@/lib/companyOs/publisherKeys";
import { enrol, storeInstallations, storePlan } from "@/app/api/company-os/v1/storeHandlers";
import { createStoreDb, ed25519Pair, envelope, signedManifest, signedRequest, type Appliance } from "./helpers/companyOsStoreDb";
import { assertSafeMigration } from "../scripts/run-store-migrations.mjs";

/**
 * ST1 plans: what Old School invoices per box, with the values the CEO entered as data (these
 * tests enter today's numbers the same way: Client Follow-up in an early-bird plan at CHF 149 with
 * the box and CHF 30 of AI use included, Opening doors as an add-on at CHF 99, first month free).
 */

const MODEL_ID = "faivr.agent.client-follow-up";
const ADMIN = "bernd (CEO)";
const NOW = new Date("2026-11-26T12:00:00.000Z");
const INCLUDES = ["Box on loan, 2 years warranty", "Setup in our office", "Updates of agents, system and AI", "Safety copies", "Support"];
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
    const payload = Buffer.from("client follow-up package bytes");
    const manifest: Record<string, unknown> = signedManifest({ modelId: MODEL_ID, version: "1.0.0", payload, publisherKeyId: keyId, publisherPrivatePem: pair.privatePem, permissions: ["workspace.read"] });
    const versionId = randomUUID();
    await holder.pool.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,'client-follow-up','Client Follow-up','Follows up clients.','active')", [MODEL_ID]);
    await holder.pool.query(
      "INSERT INTO company_os_package_versions(id,package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,'1.0.0','published',$3,$4,$5,'https://packages.faivr.test/x.tar.gz',$6,0,NULL,'1.0.0',now())",
      [versionId, MODEL_ID, JSON.stringify(manifest), keyId, (manifest.signature as { value: string }).value, manifest.packageDigest],
    );
    // list prices are the catalog entries' monthly prices, entered as data
    await upsertBundle({ id: "client-follow-up", name: "Client Follow-up", description: "Follows up every client.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 14900 });
    await upsertBundle({ id: "opening-doors", name: "Opening doors", description: "Opens doors.", stripePriceId: null, polarProductId: null, monthlyPriceCents: 9900 });
    await addPackageToBundle("client-follow-up", MODEL_ID);
    const issued = await issueEnrolmentCode({ label: "Office box", createdBy: "store-admin" });
    tenantId = issued.tenantId;
    appliance = { tenantId, instanceId: "", keyId: "", keys: ed25519Pair() };
    const response = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentCode: issued.code, appliancePublicKeyPem: appliance.keys.publicPem, label: "Muster AG office" }) }));
    const body = (await response.json()) as Record<string, string>;
    appliance.instanceId = body.instanceId;
    appliance.keyId = body.keyId;
    await definePlan(holder.pool, { id: "early-bird", name: "Early bird", monthlyChf: "149", aiAllowanceChf: "30", freeMonths: 1, pricesExcludeVat: true, includes: INCLUDES, earlyBird: true, boxLimit: 50, administrator: ADMIN });
    await setPlanFunction(holder.pool, { planId: "early-bird", bundleId: "client-follow-up", included: true, administrator: ADMIN });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await holder.pool.end();
  });

  async function otherBox() {
    const instanceId = randomUUID();
    await holder.pool.query("INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key,label,enrolled_at) VALUES($1,$2,'k','pem','another box',now())", [tenantId, instanceId]);
    return instanceId;
  }

  async function officeBox() {
    const assigned = await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "early-bird", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    const addOn = await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: appliance.instanceId, bundleId: "opening-doors", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    return { assigned, addOn };
  }

  const summary = (lines: Array<Record<string, unknown>>) => lines.map((line) => [line.line, line.description, line.amountCents, line.note]);

  it("gives a box the plan: its included function at CHF 0, an add-on at list price, and the box installs", async () => {
    const { assigned, addOn } = await officeBox();
    expect(assigned).toMatchObject({ planId: "early-bird", planName: "Early bird", earlyBird: true, startsAt: "2026-12-01T00:00:00.000Z", grantedBy: ADMIN });
    expect(assigned.granted).toEqual([expect.objectContaining({ bundleId: "client-follow-up", includedInPlan: true, monthlyPriceCents: 0, boxPlanId: assigned.boxPlanId })]);
    expect(addOn).toMatchObject({ bundleId: "opening-doors", includedInPlan: false, monthlyPriceCents: 9900, boxPlanId: assigned.boxPlanId });
    const installBody = envelope(appliance, { bundleId: "client-follow-up", faivrAgentModelId: MODEL_ID });
    const installed = await storeInstallations(signedRequest(appliance, "POST", "/api/company-os/v1/store/installations", installBody, { idempotencyKey: installBody.idempotencyKey as string }));
    expect(installed.status).toBe(201);
  });

  it("invoices nothing in the free first month and the plan, add-on and AI top-up from January", async () => {
    await officeBox();
    const december = await invoiceLines(holder.pool, { month: "2026-12" });
    expect(summary(december)).toEqual([
      ["plan", "Early bird, monthly", 0, "free month 1 of 1"],
      ["plan_includes", `Includes: ${INCLUDES.join("; ")}`, 0, "included in your plan"],
      ["ai_allowance", "AI use up to CHF 30.00 per month", 0, "included in your plan"],
      ["included_function", "Client Follow-up", 0, "included in your plan"],
      ["add_on", "Opening doors", 0, "free month 1 of 1"],
      ["total", "Total 2026-12", 0, "excl. VAT"],
    ]);
    await addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW });
    const january = await invoiceLines(holder.pool, { month: "2027-01" });
    expect(summary(january)).toEqual([
      ["plan", "Early bird, monthly", 14900, "early-bird price"],
      ["plan_includes", `Includes: ${INCLUDES.join("; ")}`, 0, "included in your plan"],
      ["ai_allowance", "AI use up to CHF 30.00 per month", 0, "included in your plan"],
      ["included_function", "Client Follow-up", 0, "included in your plan"],
      ["add_on", "Opening doors", 9900, "add-on, list price"],
      ["ai_top_up", "AI top-up", 2000, "one-time"],
      ["total", "Total 2027-01", 26800, "excl. VAT"],
    ]);
    expect(january.every((line) => line.box === "Muster AG office" && line.plan === "Early bird" && line.vat === "excl. VAT" && line.currency === "chf")).toBe(true);
    // November, before the plan starts: nothing to invoice for this box
    expect(await invoiceLines(holder.pool, { month: "2026-11" })).toEqual([]);

    const csv = invoiceCsv(january).split("\n");
    expect(csv[0]).toBe("month,box,tenant_id,instance_id,plan,line,description,amount,currency,vat,note");
    expect(csv[1]).toBe(`2027-01,Muster AG office,${tenantId},${appliance.instanceId},Early bird,plan,"Early bird, monthly",149.00,CHF,excl. VAT,early-bird price`);
    expect(csv[7]).toBe(`2027-01,Muster AG office,${tenantId},${appliance.instanceId},Early bird,total,Total 2027-01,268.00,CHF,excl. VAT,excl. VAT`);
  });

  it("shows the box the same lines it is invoiced for, on its Plan and costs page", async () => {
    await officeBox();
    const response = await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-01"));
    const body = (await response.json()) as Record<string, unknown>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.plan).toEqual({ planId: "early-bird", name: "Early bird", monthlyPriceCents: 14900, currency: "chf", pricesExcludeVat: true, aiAllowanceCents: 3000, freeMonths: 1, includes: INCLUDES, earlyBird: true, startsAt: "2026-12-01T00:00:00.000Z", endsAt: null });
    const invoiced = (await invoiceLines(holder.pool, { month: "2027-01", tenantId, instanceId: appliance.instanceId })).map(({ tenantId: _t, instanceId: _i, ...line }) => line);
    expect(body.lines).toEqual(invoiced);
    expect(body.totalCents).toBe(24800);
    expect(JSON.stringify(body)).not.toContain(tenantId);
    expect((await storePlan(signedRequest(appliance, "GET", "/api/company-os/v1/store/plan?month=2027-13"))).status).toBe(400);
  });

  it("stops offering an early-bird plan once its box limit is reached, and counts every box that held it", async () => {
    await definePlan(holder.pool, { id: "early-bird", name: "Early bird", monthlyChf: "149", aiAllowanceChf: "30", freeMonths: 1, pricesExcludeVat: true, includes: INCLUDES, earlyBird: true, boxLimit: 2, administrator: ADMIN });
    const first = await assignPlan(holder.pool, { tenantId, instanceId: appliance.instanceId, planId: "early-bird", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    await assignPlan(holder.pool, { tenantId, instanceId: await otherBox(), planId: "early-bird", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    await expect(assignPlan(holder.pool, { tenantId, instanceId: await otherBox(), planId: "early-bird", startsOn: "2026-12-01", administrator: ADMIN, now: NOW })).rejects.toThrow("plan_limit_reached:2/2");
    // a box that leaves does not free its place: the plan is for the first boxes
    await endPlan(holder.pool, { boxPlanId: first.boxPlanId, graceDays: 0, administrator: ADMIN, now: NOW });
    await expect(assignPlan(holder.pool, { tenantId, instanceId: await otherBox(), planId: "early-bird", startsOn: "2026-12-01", administrator: ADMIN, now: NOW })).rejects.toThrow("plan_limit_reached:2/2");
    expect((await planList(holder.pool, NOW)).find((plan: { id: string }) => plan.id === "early-bird")).toMatchObject({ earlyBird: true, boxLimit: 2, boxesEver: 2, boxesHolding: 1, placesLeft: 0, includedFunctions: ["client-follow-up"] });
    // one plan per box at a time
    await expect(assignPlan(holder.pool, { tenantId, instanceId: (await holder.pool.query("SELECT instance_id FROM company_os_box_plans WHERE ends_at IS NULL")).rows[0].instance_id, planId: "early-bird", startsOn: "2026-12-01", administrator: ADMIN, now: NOW })).rejects.toThrow("box_has_a_plan");
  });

  it("keeps a box's terms when the plan changes later", async () => {
    await officeBox();
    await definePlan(holder.pool, { id: "early-bird", name: "Early bird", monthlyChf: "199", aiAllowanceChf: "20", freeMonths: 0, pricesExcludeVat: true, includes: INCLUDES, earlyBird: true, boxLimit: 50, administrator: ADMIN });
    const second = await otherBox();
    await assignPlan(holder.pool, { tenantId, instanceId: second, planId: "early-bird", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    const january = await invoiceLines(holder.pool, { month: "2027-01" });
    expect(january.filter((line) => line.line === "plan").map((line) => [line.instanceId, line.amountCents])).toEqual([[appliance.instanceId, 14900], [second, 19900]]);
  });

  it("ends a plan with its subscriptions after the grace; the last month is invoiced whole, nothing after", async () => {
    const { assigned } = await officeBox();
    const endAt = new Date("2027-02-10T00:00:00.000Z");
    const ended = await endPlan(holder.pool, { boxPlanId: assigned.boxPlanId, graceDays: 14, administrator: ADMIN, reason: "contract ends", now: new Date(endAt.getTime() - 14 * DAY) });
    expect(ended).toMatchObject({ endsAt: endAt.toISOString(), endedBy: ADMIN });
    expect(ended.subscriptions).toHaveLength(2);
    expect(ended.subscriptions.every((item: { subscriptionState: string; effectiveAt: string }) => item.subscriptionState === "cancel_at_period_end" && item.effectiveAt === endAt.toISOString())).toBe(true);
    await applyDueSubscriptionDates(holder.pool, { now: new Date(endAt.getTime() + 1000) });
    const states = await holder.pool.query("SELECT subscription_state FROM company_os_bundle_subscriptions");
    expect(states.rows.map((row) => row.subscription_state)).toEqual(["cancelled", "cancelled"]);
    expect((await invoiceLines(holder.pool, { month: "2027-02" })).find((line) => line.line === "total")?.amountCents).toBe(24800);
    expect(await invoiceLines(holder.pool, { month: "2027-03" })).toEqual([]);
  });

  it("lists add-ons of a box without a plan, and never a subscription a provider bills", async () => {
    const box = await otherBox();
    await grantSubscriptionByOrder(holder.pool, { tenantId, instanceId: box, bundleId: "opening-doors", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
    await holder.pool.query("INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,copy_number,billing_description,billing_provider,subscription_state,entitled_at) VALUES($1,$2,$3,'client-follow-up',1,'Client Follow-up','polar','active',now())", [randomUUID(), tenantId, box]);
    expect(summary(await invoiceLines(holder.pool, { month: "2027-01" }))).toEqual([
      ["no_plan", "No plan on this box", 0, "add-ons only"],
      ["add_on", "Opening doors", 9900, "add-on, list price"],
      ["total", "Total 2027-01", 9900, ""],
    ]);
  });

  it("refuses plan data and invoice lines that would be wrong", async () => {
    const plan = (input: Record<string, unknown>) => definePlan(holder.pool, { id: "p", name: "P", monthlyChf: "10", aiAllowanceChf: "0", freeMonths: 0, pricesExcludeVat: true, includes: ["Support"], earlyBird: false, administrator: ADMIN, ...input } as Parameters<typeof definePlan>[1]);
    await expect(plan({ monthlyChf: "149.999" })).rejects.toThrow("monthly_price_invalid");
    await expect(plan({ monthlyChf: "-1" })).rejects.toThrow("monthly_price_invalid");
    await expect(plan({ earlyBird: true })).rejects.toThrow("early_bird_needs_box_limit");
    await expect(plan({ includes: [] })).rejects.toThrow("includes_invalid");
    await expect(plan({ pricesExcludeVat: undefined })).rejects.toThrow("prices_exclude_vat_required");
    await expect(plan({ administrator: "" })).rejects.toThrow("administrator_required");
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("box_has_no_plan");
    await officeBox();
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-01", kind: "discount", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("invoice_line_kind_invalid");
    await expect(addInvoiceLine(holder.pool, { tenantId, instanceId: appliance.instanceId, month: "2027-1", kind: "ai-top-up", amountChf: "20", administrator: ADMIN, now: NOW })).rejects.toThrow("month_invalid");
    const audit = await holder.pool.query("SELECT action,administrator FROM company_os_plan_audit ORDER BY created_at");
    expect(audit.rows.every((row) => row.administrator === ADMIN)).toBe(true);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["plan_defined", "plan_function_changed", "plan_assigned"]));
  });

  it("keeps every price in data: no plan or function price is written in the store's code", () => {
    for (const file of ["../lib/companyOs/boxPlans.mjs", "../lib/companyOs/subscriptionOrders.mjs", "../app/api/company-os/v1/storeHandlers.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/\b(149|14900|9900|99\.00|3000)\b/);
    }
    const sql = readFileSync(new URL("../sql/migrations/20261127_st1_plans_and_invoices.sql", import.meta.url), "utf8");
    expect(() => assertSafeMigration("20261127_st1_plans_and_invoices.sql", sql)).not.toThrow();
    expect(sql).not.toMatch(/INSERT INTO/i);
  });
});
