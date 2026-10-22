import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as unknown as import("pg").Pool }));
vi.mock("@/lib/postgres", () => ({ getPgPool: () => holder.pool }));

import { addPackageToBundle, createStoreInstallation, upsertBundle } from "@/lib/companyOs/privateStore";
import { createStoreDb } from "./helpers/companyOsStoreDb";

/**
 * F25 (T129): a function of several agents ("Software delivery: Bob", the lead plus its roles) is
 * one subscription per copy, and each agent of the copy is one installation with its own id. The
 * reserved id of a checkout belongs to the one installation it was reserved for; the box sends a
 * fresh id for every other agent, and a reused id is still refused.
 */
const BUNDLE = "software-delivery";
const LEAD = "example.agent.bob";
const ROLES = ["example.agent.bob-ci-fixer", "example.agent.bob-instructions-keeper", "example.agent.bob-qa-reviewer", "example.agent.bob-implementer", "example.agent.bob-planner", "example.agent.bob-release-notes"];
const tenantId = randomUUID();
const instanceId = randomUUID();

async function subscription(input: { copyNumber?: number; requestedInstallationId?: string | null; state?: string } = {}) {
  const id = randomUUID();
  await holder.pool.query(
    "INSERT INTO company_os_bundle_subscriptions(id,tenant_id,instance_id,bundle_id,copy_number,requested_installation_id,subscription_state) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id, tenantId, instanceId, BUNDLE, input.copyNumber ?? 1, input.requestedInstallationId ?? null, input.state ?? "active"],
  );
  return id;
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  return "installed";
}

describe("F25: one installation per agent of a function copy", () => {
  beforeEach(async () => {
    holder.pool = createStoreDb().pool;
    await upsertBundle({ id: BUNDLE, name: "Software delivery: Bob", description: "Bob and his roles.", stripePriceId: null, monthlyPriceCents: 9900 });
    for (const modelId of [LEAD, ...ROLES]) {
      await holder.pool.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,$1,$1,'x','active')", [modelId]);
      await holder.pool.query(
        "INSERT INTO company_os_package_versions(id,package_id,version,status,manifest,publisher_key_id,artifact_sha256,published_at) VALUES($1,$2,'1.0.0','published','{}','key','sha256:abc',now())",
        [randomUUID(), modelId],
      );
      await addPackageToBundle(BUNDLE, modelId);
    }
  });

  afterEach(async () => {
    await holder.pool.end();
  });

  it("box 1: an earlier unfinished install of one role, then Install all of the other agents of copy 1", async () => {
    const subscriptionId = await subscription();
    // the old attempt: CI Fixer was reserved without an id (the store chose one) and never finished on the box
    const ciFixer = await createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: ROLES[0] });
    // the box asks for the next agent the way it did on 22 Oct 2026 (no id): refused before F25
    const keeper = await createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: ROLES[1] });
    expect(keeper.installationId).not.toBe(ciFixer.installationId);
    // and the box's own fresh id per agent (T129) for the rest, the lead included
    const ids = new Set([ciFixer.installationId, keeper.installationId]);
    for (const modelId of [LEAD, ...ROLES.slice(2)]) {
      const installationId = randomUUID();
      const made = await createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId, subscriptionId, installationId });
      expect(made).toMatchObject({ installationId, subscriptionId, copyNumber: 1 });
      ids.add(made.installationId);
    }
    expect(ids.size).toBe(7);
    const rows = await holder.pool.query("SELECT DISTINCT bundle_subscription_id FROM company_os_installations");
    expect(rows.rows.map((row) => row.bundle_subscription_id)).toEqual([subscriptionId]);
  });

  it("a paid copy: the reserved id goes to the lead, every role gets its own", async () => {
    const reserved = randomUUID();
    const subscriptionId = await subscription({ copyNumber: 2, requestedInstallationId: reserved });
    const lead = await createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: LEAD, subscriptionId, installationId: reserved });
    expect(lead.installationId).toBe(reserved);
    // a role without an id: never the lead's reserved id again
    const first = await createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: ROLES[0], subscriptionId });
    expect(first.installationId).not.toBe(reserved);
    // a role with the box's own id
    const own = randomUUID();
    expect((await createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: ROLES[1], subscriptionId, installationId: own })).installationId).toBe(own);
  });

  it("a role installed before the lead leaves the reserved id to the lead", async () => {
    const reserved = randomUUID();
    const subscriptionId = await subscription({ copyNumber: 2, requestedInstallationId: reserved });
    const role = randomUUID();
    expect((await createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: ROLES[0], subscriptionId, installationId: role })).installationId).toBe(role);
    expect((await createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: LEAD, subscriptionId })).installationId).toBe(reserved);
  });

  it("still refuses a reused id, a second install of one agent, and another copy's reserved id", async () => {
    const otherReserved = randomUUID();
    const subscriptionId = await subscription();
    await subscription({ copyNumber: 2, requestedInstallationId: otherReserved });
    const lead = await createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: LEAD, subscriptionId, installationId: randomUUID() });
    // the same id for another agent
    expect(await refusal(createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: ROLES[0], subscriptionId, installationId: lead.installationId }))).toBe("installation_id_reused");
    // the same agent again on the same copy
    expect(await refusal(createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: LEAD, subscriptionId, installationId: randomUUID() }))).toBe(`package_already_installed:${lead.installationId}`);
    // the id another copy reserved for its own installation
    expect(await refusal(createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: ROLES[0], subscriptionId, installationId: otherReserved }))).toBe("installation_scope_mismatch");
    // no subscription, no installation
    const inactive = await subscription({ copyNumber: 3, state: "checkout_pending" });
    expect(await refusal(createStoreInstallation({ tenantId, instanceId, bundleId: BUNDLE, modelId: ROLES[0], subscriptionId: inactive, installationId: randomUUID() }))).toBe("subscription_not_active");
  });
});
