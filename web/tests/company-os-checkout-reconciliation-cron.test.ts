import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/companyOs/checkoutReconciliation", () => ({ reconcilePendingCheckouts: reconcile }));
const dates = vi.hoisted(() => vi.fn());
vi.mock("@/lib/companyOs/privateStore", () => ({ applyDueOrderDates: dates }));

import { GET } from "@/app/api/cron/reconcile-checkouts/route";

describe("checkout reconciliation cron", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    reconcile.mockReset();
    dates.mockReset();
  });

  it("rejects unauthenticated requests", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const response = await GET(new NextRequest("https://store.faivr.test/api/cron/reconcile-checkouts"));
    expect(response.status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
    expect(dates).not.toHaveBeenCalled();
  });

  it("runs the bounded scheduled reconciliation batch", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    reconcile.mockResolvedValue({ checked: 2, activated: 1, abandoned: 1, pending: 0, providerErrors: 0 });
    dates.mockResolvedValue({ ended: [{ subscriptionId: "s", reason: "admin_grace_over", stoppedAt: "2026-12-14T00:00:00.000Z" }] });
    const response = await GET(new NextRequest("https://store.faivr.test/api/cron/reconcile-checkouts", { headers: { Authorization: "Bearer test-cron-secret" } }));
    expect(response.status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith({ limit: 50 });
    // ST1: the order dates of every box are applied in the same run (no scope: the whole store)
    expect(dates).toHaveBeenCalledWith();
    expect(await response.json()).toMatchObject({ activated: 1, abandoned: 1, ended: 1 });
  });
});
