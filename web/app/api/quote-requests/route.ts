import { NextRequest, NextResponse } from "next/server";
import { createQuoteRequest, getQuoteRequestsByRequester } from "@/lib/quoteRequests";
import type { CreateQuoteRequestInput, TaskBriefArtifact } from "@/lib/quoteRequestSchema";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidBriefPayload(value: unknown): value is TaskBriefArtifact {
  if (!value || typeof value !== "object") return false;

  const payload = value as Partial<TaskBriefArtifact>;
  return (
    payload.version === 1 &&
    typeof payload.agentId === "number" &&
    isNonEmptyString(payload.agentName) &&
    isNonEmptyString(payload.title) &&
    isNonEmptyString(payload.objective) &&
    isNonEmptyString(payload.tokenSymbol) &&
    isNonEmptyString(payload.deadlineLabel)
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<CreateQuoteRequestInput>;

    if (
      !isNonEmptyString(body.requesterAddress) ||
      typeof body.agentId !== "number" ||
      !isNonEmptyString(body.agentName) ||
      !isValidBriefPayload(body.briefPayload)
    ) {
      return NextResponse.json({ error: "Invalid quote request payload" }, { status: 400 });
    }

    const record = await createQuoteRequest({
      requesterAddress: body.requesterAddress,
      agentId: body.agentId,
      agentName: body.agentName,
      briefHash: typeof body.briefHash === "string" ? body.briefHash : null,
      briefPayload: body.briefPayload,
    });

    return NextResponse.json({ request: record });
  } catch {
    return NextResponse.json({ error: "Failed to create quote request" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const requesterAddress = req.nextUrl.searchParams.get("requesterAddress");

    if (!isNonEmptyString(requesterAddress)) {
      return NextResponse.json({ error: "requesterAddress is required" }, { status: 400 });
    }

    const requests = await getQuoteRequestsByRequester(requesterAddress);
    return NextResponse.json({ requests });
  } catch {
    return NextResponse.json({ requests: [] }, { status: 500 });
  }
}
