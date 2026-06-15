import { NextRequest, NextResponse } from "next/server";
import { createQuoteRequest, getQuoteRequestsByAgent, getQuoteRequestsByRequester, updateQuoteRequest } from "@/lib/quoteRequests";
import {
  OPERATOR_MUTABLE_QUOTE_REQUEST_STATUSES,
  type CreateQuoteRequestInput,
  type OperatorMutableQuoteRequestStatus,
  type TaskBriefArtifact,
  type UpdateQuoteRequestInput,
} from "@/lib/quoteRequestSchema";

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

function isOperatorAuthorized(req: NextRequest): boolean {
  const configuredKey = process.env.QUOTE_REQUEST_OPERATOR_KEY?.trim();
  if (!configuredKey) return false;
  return req.headers.get("x-operator-key") === configuredKey;
}

function isOperatorMutableStatus(value: unknown): value is OperatorMutableQuoteRequestStatus {
  return typeof value === "string" && OPERATOR_MUTABLE_QUOTE_REQUEST_STATUSES.includes(value as OperatorMutableQuoteRequestStatus);
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
    const agentIdParam = req.nextUrl.searchParams.get("agentId");

    if (isNonEmptyString(requesterAddress)) {
      const requests = await getQuoteRequestsByRequester(requesterAddress);
      return NextResponse.json({ requests });
    }

    if (isNonEmptyString(agentIdParam)) {
      if (!isOperatorAuthorized(req)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const parsedAgentId = Number(agentIdParam);
      if (!Number.isInteger(parsedAgentId) || parsedAgentId < 0) {
        return NextResponse.json({ error: "agentId must be a valid number" }, { status: 400 });
      }

      const requests = await getQuoteRequestsByAgent(parsedAgentId);
      return NextResponse.json({ requests });
    }

    if (!isOperatorAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requests = await getQuoteRequestsByAgent();
    return NextResponse.json({ requests });
  } catch {
    return NextResponse.json({ requests: [] }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  if (!isOperatorAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await req.json()) as Partial<UpdateQuoteRequestInput>;

    if (!isNonEmptyString(body.requestId) || !isOperatorMutableStatus(body.status)) {
      return NextResponse.json({ error: "Invalid quote request update payload" }, { status: 400 });
    }

    if (body.status === "quoted" && !isNonEmptyString(body.quoteMessage)) {
      return NextResponse.json({ error: "quoteMessage is required when sending a quote" }, { status: 400 });
    }

    if (body.agentId !== undefined && (!Number.isInteger(body.agentId) || body.agentId < 0)) {
      return NextResponse.json({ error: "agentId must be a valid number" }, { status: 400 });
    }

    const request = await updateQuoteRequest({
      requestId: body.requestId,
      agentId: body.agentId,
      status: body.status,
      quoteAmount: typeof body.quoteAmount === "string" ? body.quoteAmount : null,
      quoteMessage: typeof body.quoteMessage === "string" ? body.quoteMessage : null,
      operatorNote: typeof body.operatorNote === "string" ? body.operatorNote : null,
    });

    if (!request) {
      return NextResponse.json({ error: "Quote request not found" }, { status: 404 });
    }

    return NextResponse.json({ request });
  } catch {
    return NextResponse.json({ error: "Failed to update quote request" }, { status: 500 });
  }
}
