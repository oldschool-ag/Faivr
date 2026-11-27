import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignPlan, definePlan, endPlan, setPlanFunction } from "@/lib/companyOs/boxPlans.mjs";
import { endSubscriptionByAdmin, grantSubscriptionByOrder } from "@/lib/companyOs/subscriptionOrders.mjs";
import { applyStoreMigrations, readMigrations } from "../scripts/run-store-migrations.mjs";

/**
 * ST1 plans on a real Postgres (pg-mem has no row locks). Runs only with STORE_TEST_DATABASE_URL
 * set, inside a schema of its own that it drops afterwards; nothing else in that database is
 * touched. Each assign runs in one BEGIN/COMMIT, as the store admin command runs every command.
 */
const url = process.env.STORE_TEST_DATABASE_URL;
const ADMIN = "bernd (CEO)";
const NOW = new Date("2026-11-26T12:00:00.000Z");
const PLAN = "customers-and-product-management";
const OTHER = "other-plan";

describe.skipIf(!url)("ST1 plans on Postgres: one transaction per admin command", () => {
  const schema = `st1_test_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const connect = async () => {
    const client = new pg.Client({ connectionString: url, options: `-c search_path=${schema}` });
    await client.connect();
    return client;
  };
  let admin: pg.Client;
  const tenantId = randomUUID();
  const boxes = [randomUUID(), randomUUID(), randomUUID()];

  beforeAll(async () => {
    admin = await connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.query(readFileSync(new URL("../sql/company-os-marketplace.sql", import.meta.url), "utf8"));
    await applyStoreMigrations({ client: admin, migrations: await readMigrations(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../sql/migrations")), log: () => {} });
    for (const box of boxes) await admin.query("INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key,label,enrolled_at) VALUES($1,$2,'k','pem','box',now())", [tenantId, box]);
    await admin.query("INSERT INTO company_os_function_bundles(id,name,description,monthly_price_cents) VALUES('customers','Customers','CRM',0),('product-management','Product management','PM',0),('retired-workflow','Retired','gone',0)");
    await admin.query("UPDATE company_os_function_bundles SET status='retired' WHERE id='retired-workflow'");
    const terms = { boxChf: "100", earlyBirdPercent: "50", earlyBirdNote: "Early bird", topUpUsdPerChf: "1", freeMonths: 0, pricesExcludeVat: true, includes: ["Support"], administrator: ADMIN };
    await definePlan(admin, { id: PLAN, name: "Truchsess box", earlyBirdCustomers: 1, ...terms });
    await setPlanFunction(admin, { planId: PLAN, bundleId: "customers", granted: true, administrator: ADMIN });
    await definePlan(admin, { id: "broken-plan", name: "Broken", earlyBirdCustomers: 0, ...terms });
    await definePlan(admin, { id: OTHER, name: "Other", earlyBirdCustomers: 0, ...terms });
    await setPlanFunction(admin, { planId: OTHER, bundleId: "customers", granted: true, administrator: ADMIN });
    await setPlanFunction(admin, { planId: "broken-plan", bundleId: "retired-workflow", granted: true, administrator: ADMIN });
  });

  afterAll(async () => {
    if (!admin) return;
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  async function inTransaction<T>(client: pg.Client, work: () => Promise<T>) {
    await client.query("BEGIN");
    try {
      const result = await work();
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  it("two assigns at the same time never take the same customer number", async () => {
    const [a, b] = [await connect(), await connect()];
    try {
      // A takes the plan lock and holds it; B starts while A is still open
      await a.query("BEGIN");
      const first = await assignPlan(a, { tenantId, instanceId: boxes[0], planId: PLAN, startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
      const second = inTransaction(b, () => assignPlan(b, { tenantId, instanceId: boxes[1], planId: PLAN, startsOn: "2026-12-01", administrator: ADMIN, now: NOW }));
      const waited = await Promise.race([second.then(() => "finished"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 500))]);
      expect(waited).toBe("waiting");
      await a.query("COMMIT");
      const done = await second;
      // customer 1 is the plan's only early bird here; customer 2 is not
      expect([first.customerNumber, first.earlyBird?.discountBasisPoints]).toEqual([1, 5000]);
      expect([done.customerNumber, done.earlyBird]).toEqual([2, null]);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("Codex P2: two assigns of different plans on one box run one after the other: the second finds the first", async () => {
    const box = randomUUID();
    await admin.query("INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key,label,enrolled_at) VALUES($1,$2,'k','pem','box',now())", [tenantId, box]);
    const [a, b] = [await connect(), await connect()];
    try {
      await a.query("BEGIN");
      await assignPlan(a, { tenantId, instanceId: box, planId: PLAN, startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
      const second = inTransaction(b, () => assignPlan(b, { tenantId, instanceId: box, planId: OTHER, startsOn: "2026-12-01", administrator: ADMIN, now: NOW }));
      const waited = await Promise.race([second.then(() => "finished", () => "failed"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 500))]);
      expect(waited).toBe("waiting");
      await a.query("COMMIT");
      await expect(second).rejects.toThrow("box_has_a_plan");
      const plans = await a.query("SELECT plan_id FROM company_os_box_plans WHERE instance_id=$1", [box]);
      expect(plans.rows.map((row) => row.plan_id)).toEqual([PLAN]);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("Codex P2: two ends of a box's last two workflows at the same time: the second is refused", async () => {
    const box = randomUUID();
    await admin.query("INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key,label,enrolled_at) VALUES($1,$2,'k','pem','box',now())", [tenantId, box]);
    const assigned = await inTransaction(admin, () => assignPlan(admin, { tenantId, instanceId: box, planId: PLAN, startsOn: "2026-12-01", administrator: ADMIN, now: NOW }));
    const second = await inTransaction(admin, () => grantSubscriptionByOrder(admin, { tenantId, instanceId: box, bundleId: "product-management", startsOn: "2026-12-01", administrator: ADMIN, now: NOW }));
    const [a, b] = [await connect(), await connect()];
    try {
      await a.query("BEGIN");
      await endSubscriptionByAdmin(a, { subscriptionId: assigned.granted[0].subscriptionId, graceDays: 14, administrator: ADMIN, now: NOW });
      const other = inTransaction(b, () => endSubscriptionByAdmin(b, { subscriptionId: second.subscriptionId, graceDays: 14, administrator: ADMIN, now: NOW }));
      const waited = await Promise.race([other.then(() => "finished", () => "failed"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 500))]);
      expect(waited).toBe("waiting");
      await a.query("COMMIT");
      await expect(other).rejects.toThrow("last_workflow_end_the_plan_instead");
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("Codex P2: end-plan that overlaps a grant on the box ends the newly granted subscription too", async () => {
    const box = randomUUID();
    await admin.query("INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key,label,enrolled_at) VALUES($1,$2,'k','pem','box',now())", [tenantId, box]);
    const assigned = await inTransaction(admin, () => assignPlan(admin, { tenantId, instanceId: box, planId: PLAN, startsOn: "2026-12-01", administrator: ADMIN, now: NOW }));
    const [a, b] = [await connect(), await connect()];
    try {
      // A grants a second workflow and holds the box lock; B ends the plan meanwhile
      await a.query("BEGIN");
      const granted = await grantSubscriptionByOrder(a, { tenantId, instanceId: box, bundleId: "product-management", startsOn: "2026-12-01", administrator: ADMIN, now: NOW });
      const ending = inTransaction(b, () => endPlan(b, { boxPlanId: assigned.boxPlanId, graceDays: 14, administrator: ADMIN, now: NOW }));
      const waited = await Promise.race([ending.then(() => "finished", () => "failed"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 500))]);
      expect(waited).toBe("waiting");
      await a.query("COMMIT");
      const ended = await ending;
      expect(ended.subscriptions.map((item: { subscriptionId: string }) => item.subscriptionId)).toContain(granted.subscriptionId);
      const row = await a.query("SELECT subscription_state,admin_ended_at FROM company_os_bundle_subscriptions WHERE id=$1", [granted.subscriptionId]);
      expect([row.rows[0].subscription_state, row.rows[0].admin_ended_at !== null]).toEqual(["cancel_at_period_end", true]);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("an assign that fails half-way leaves nothing behind", async () => {
    const c = await connect();
    try {
      await expect(inTransaction(c, () => assignPlan(c, { tenantId, instanceId: boxes[2], planId: "broken-plan", startsOn: "2026-12-01", administrator: ADMIN, now: NOW }))).rejects.toThrow("bundle_not_active");
      const left = await c.query("SELECT count(*)::int AS n FROM company_os_box_plans WHERE instance_id=$1", [boxes[2]]);
      expect(left.rows[0].n).toBe(0);
      const audit = await c.query("SELECT count(*)::int AS n FROM company_os_plan_audit WHERE action='plan_assigned' AND detail->>'instanceId'=$1", [boxes[2]]);
      expect(audit.rows[0].n).toBe(0);
    } finally {
      await c.end();
    }
  });
});
