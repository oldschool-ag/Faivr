import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authenticatedJson } from "@/lib/companyOs/http";
import { getPgPool } from "@/lib/postgres";
import { latestTruchsessRelease, ReleaseLookupError } from "@/lib/companyOs/truchsessReleases";

export async function GET(req: NextRequest) {
  const auth = await authenticatedJson(req);
  if (auth instanceof NextResponse) {
    const error = await auth.clone().json() as { error?: string };
    console.info("[company-os-release] box=unknown tag=none result=unauthorized");
    if (auth.status === 400 && error.error === "Missing signed identity headers")
      return NextResponse.json({ error: "Invalid Company OS signature" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return auth;
  }
  if (req.nextUrl.searchParams.get("channel") !== "stable") {
    console.info(`[company-os-release] box=${auth.principal.instanceId} tag=none result=unsupported_channel`);
    return NextResponse.json({ error: "unsupported_release_channel" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const release = await latestTruchsessRelease(getPgPool());
    console.info(`[company-os-release] box=${auth.principal.instanceId} tag=${release.tag}`);
    return NextResponse.json(release, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof ReleaseLookupError ? error.status : 502;
    console.info(`[company-os-release] box=${auth.principal.instanceId} tag=none result=failed status=${status}`);
    return NextResponse.json({ error: status === 503 ? "release_service_unavailable" : "release_unavailable" }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
