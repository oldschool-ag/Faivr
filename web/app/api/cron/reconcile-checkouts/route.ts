import { NextRequest, NextResponse } from "next/server";
import { reconcilePendingCheckouts } from "@/lib/companyOs/checkoutReconciliation";

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

/** Bounded Vercel cron recovery for provider webhooks; no customer data is logged. */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const result = await reconcilePendingCheckouts({ limit: 50 });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
