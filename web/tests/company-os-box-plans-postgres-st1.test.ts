import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignPlan, definePlan, endPlan, setPlanFunction } from "@/lib/companyOs/boxPlans.mjs";
import { endSubscriptionByAdmin, grantSubscriptionByOrder } from "@/lib/companyOs/subscriptionOrders.mjs";
import { createStoreInstallation } from "@/lib/companyOs/privateStore";
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
const MODEL = "faivr.agent.penn";

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
    await admin.query("INSERT INTO company_os_publishers(key_id,public_key) VALUES('key','fixture')");
    await admin.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,'penn','Penn','Keeps the customers.','active')", [MODEL]);
    await admin.query("INSERT INTO company_os_package_versions(id,package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,min_company_os_version,published_at) VALUES($1,$2,'1.0.0','published','{}','key','sig','https://packages.faivr.test/x.tar.gz',$3,0,'1.0.0',now())", [randomUUID(), MODEL, `sha256:${"a".repeat(64)}`]);
    await admin.query("INSERT INTO company_os_bundle_packages(bundle_id,package_id) VALUES('customers',$1)", [MODEL]);
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
      // decision C: one early-bird place; two assigns at once under the plan lock never both take it
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

  async function boxWithAWorkflow() {
    const box = randomUUID();
    await admin.query("INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key,label,enrolled_at) VALUES($1,$2,'k','pem','box',now())", [tenantId, box]);
    const granted = await inTransaction(admin, () => grantSubscriptionByOrder(admin, { tenantId, instanceId: box, bundleId: "customers", startsOn: "2026-11-26", administrator: ADMIN, now: NOW }));
    return { box, subscriptionId: granted.subscriptionId as string };
  }

  async function activeInstallations(box: string) {
    const rows = await admin.query("SELECT i.installation_state,i.subscription_state FROM company_os_installations i JOIN company_os_bundle_subscriptions s ON s.id=i.bundle_subscription_id WHERE i.instance_id=$1 AND (i.subscription_state='active' OR s.subscription_state='active')", [box]);
    return rows.rows;
  }

  it("Codex security P2: a zero-grace end that holds the box lock wins over an install at the same moment", async () => {
    const { box, subscriptionId } = await boxWithAWorkflow();
    const [a, b] = [await connect(), await connect()];
    try {
      // A ends the subscription now and holds the box lock; B's install starts meanwhile and waits
      await a.query("BEGIN");
      await endSubscriptionByAdmin(a, { subscriptionId, graceDays: 0, administrator: ADMIN, now: NOW });
      const install = createStoreInstallation({ tenantId, instanceId: box, bundleId: "customers", modelId: MODEL }, b as never);
      const started = inTransaction(b, () => install);
      const waited = await Promise.race([started.then(() => "finished", () => "failed"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 500))]);
      expect(waited).toBe("waiting");
      await a.query("COMMIT");
      await expect(started).rejects.toThrow("subscription_not_active");
      expect(await activeInstallations(box)).toEqual([]);
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("Codex security P2: an install that holds the box lock first is ended by the zero-grace end that waited for it", async () => {
    const { box, subscriptionId } = await boxWithAWorkflow();
    const [a, b] = [await connect(), await connect()];
    try {
      // B installs and holds the box lock; A's end starts meanwhile, waits, then ends the new installation too
      await b.query("BEGIN");
      const made = await createStoreInstallation({ tenantId, instanceId: box, bundleId: "customers", modelId: MODEL }, b as never);
      const ending = inTransaction(a, () => endSubscriptionByAdmin(a, { subscriptionId, graceDays: 0, administrator: ADMIN, now: NOW }));
      const waited = await Promise.race([ending.then(() => "finished", () => "failed"), new Promise((resolve) => setTimeout(() => resolve("waiting"), 500))]);
      expect(waited).toBe("waiting");
      await b.query("COMMIT");
      await ending;
      expect(await activeInstallations(box)).toEqual([]);
      const row = await admin.query("SELECT subscription_state FROM company_os_installations WHERE id=$1", [made.installationId]);
      expect(row.rows[0].subscription_state).not.toBe("active");
    } finally {
      await a.end();
      await b.end();
    }
  });

  it("Codex security P2: an install on a plan an administrator ended is refused", async () => {
    const box = randomUUID();
    await admin.query("INSERT INTO company_os_instance_keys(tenant_id,instance_id,key_id,public_key,label,enrolled_at) VALUES($1,$2,'k','pem','box',now())", [tenantId, box]);
    const assigned = await inTransaction(admin, () => assignPlan(admin, { tenantId, instanceId: box, planId: OTHER, startsOn: "2026-11-26", administrator: ADMIN, now: NOW }));
    // the plan's end is written while its subscription still reads active (the moment the lock closes)
    await admin.query("UPDATE company_os_box_plans SET ended_by=$2 WHERE id=$1", [assigned.boxPlanId, ADMIN]);
    await expect(inTransaction(admin, () => createStoreInstallation({ tenantId, instanceId: box, bundleId: "customers", modelId: MODEL }, admin as never))).rejects.toThrow("box_plan_not_active");
    expect(await activeInstallations(box).then((rows) => rows.filter((r) => r.subscription_state === "active" && r.installation_state === "entitled"))).toEqual([]);
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
