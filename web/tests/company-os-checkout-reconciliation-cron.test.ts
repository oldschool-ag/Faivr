import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const reconcile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/companyOs/checkoutReconciliation", () => ({ reconcilePendingCheckouts: reconcile }));

import { GET } from "@/app/api/cron/reconcile-checkouts/route";

describe("checkout reconciliation cron", () => {
  afterEach(() => {
    delete process.env.CRON_SECRET;
    reconcile.mockReset();
  });

  it("rejects unauthenticated requests", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const response = await GET(new NextRequest("https://store.faivr.test/api/cron/reconcile-checkouts"));
    expect(response.status).toBe(401);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("runs the bounded scheduled reconciliation batch", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    reconcile.mockResolvedValue({ checked: 2, activated: 1, abandoned: 1, pending: 0, providerErrors: 0 });
    const response = await GET(new NextRequest("https://store.faivr.test/api/cron/reconcile-checkouts", { headers: { Authorization: "Bearer test-cron-secret" } }));
    expect(response.status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith({ limit: 50 });
    expect(await response.json()).toMatchObject({ activated: 1, abandoned: 1 });
  });
});
