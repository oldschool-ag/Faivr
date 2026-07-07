import { NextRequest, NextResponse } from "next/server";
import { auditOperatorAction } from "@/lib/auditLog";
import { authorizeOperatorRequest, operatorAuthChallengeHeaders } from "@/lib/operatorAuth";
import { createQuoteRequest, getQuoteRequestsByAgent, getQuoteRequestsByRequester, updateQuoteRequest } from "@/lib/quoteRequests";
import { getClientIp, checkRateLimit } from "@/lib/rateLimit";
import { parseAgentIdParam, parseCreateQuoteRequestPayload, parseRequesterAddressParam, parseUpdateQuoteRequestPayload } from "@/lib/quoteRequestValidation";

const PUBLIC_CREATE_LIMIT = { limit: 20, windowMs: 60_000 };
const OPERATOR_READ_LIMIT = { limit: 60, windowMs: 60_000 };
const OPERATOR_WRITE_LIMIT = { limit: 30, windowMs: 60_000 };

function noStoreJson(payload: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(payload, { ...init, headers });
}

function rateLimitedResponse(retryAfterSeconds: number) {
  return noStoreJson(
    { error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": retryAfterSeconds.toString(),
      },
    },
  );
}

async function requireOperator(req: NextRequest) {
  const auth = await authorizeOperatorRequest(req);
  if (auth.ok) return auth;

  return auth;
}

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit(req, "quote-request:create", PUBLIC_CREATE_LIMIT);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  }

  try {
    const body = await req.json();
    const parsed = parseCreateQuoteRequestPayload(body);

    if (!parsed) {
      return noStoreJson({ error: "Invalid quote request payload" }, { status: 400 });
    }

    const record = await createQuoteRequest(parsed);

    return noStoreJson({ request: record });
  } catch {
    return noStoreJson({ error: "Failed to create quote request" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const requesterAddress = parseRequesterAddressParam(req.nextUrl.searchParams.get("requesterAddress"));
    const agentIdParam = req.nextUrl.searchParams.get("agentId");

    if (requesterAddress) {
      const requests = await getQuoteRequestsByRequester(requesterAddress);
      return noStoreJson({ requests });
    }

    const rateLimit = checkRateLimit(req, "quote-request:operator-get", OPERATOR_READ_LIMIT);
    if (!rateLimit.allowed) {
      return rateLimitedResponse(rateLimit.retryAfterSeconds);
    }

    const auth = await requireOperator(req);
    if (!auth.ok) {
      return noStoreJson(
        { error: auth.reason === "missing-config" ? "Operator auth is not configured" : "Unauthorized" },
        { status: auth.reason === "missing-config" ? 503 : 401, headers: operatorAuthChallengeHeaders() },
      );
    }

    if (agentIdParam) {
      const parsedAgentId = parseAgentIdParam(agentIdParam);
      if (parsedAgentId === null) {
        auditOperatorAction({
          action: "quote_requests.list",
          actor: auth.actor,
          authMethod: auth.method,
          ip: getClientIp(req),
          userAgent: req.headers.get("user-agent"),
          outcome: "rejected",
          reason: "invalid-agent-id",
        });
        return noStoreJson({ error: "agentId must be a valid number" }, { status: 400 });
      }

      const requests = await getQuoteRequestsByAgent(parsedAgentId);
      auditOperatorAction({
        action: "quote_requests.list",
        actor: auth.actor,
        authMethod: auth.method,
        ip: getClientIp(req),
        userAgent: req.headers.get("user-agent"),
        agentId: parsedAgentId,
        outcome: "success",
      });
      return noStoreJson({ requests });
    }

    const requests = await getQuoteRequestsByAgent();
    auditOperatorAction({
      action: "quote_requests.list",
      actor: auth.actor,
      authMethod: auth.method,
      ip: getClientIp(req),
      userAgent: req.headers.get("user-agent"),
      outcome: "success",
    });
    return noStoreJson({ requests });
  } catch {
    return noStoreJson({ requests: [] }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const rateLimit = checkRateLimit(req, "quote-request:operator-patch", OPERATOR_WRITE_LIMIT);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit.retryAfterSeconds);
  }

  const auth = await requireOperator(req);
  if (!auth.ok) {
    return noStoreJson(
      { error: auth.reason === "missing-config" ? "Operator auth is not configured" : "Unauthorized" },
      { status: auth.reason === "missing-config" ? 503 : 401, headers: operatorAuthChallengeHeaders() },
    );
  }

  try {
    const body = await req.json();
    const parsed = parseUpdateQuoteRequestPayload(body);

    if (!parsed) {
      auditOperatorAction({
        action: "quote_requests.update",
        actor: auth.actor,
        authMethod: auth.method,
        ip: getClientIp(req),
        userAgent: req.headers.get("user-agent"),
        outcome: "rejected",
        reason: "invalid-payload",
      });
      return noStoreJson({ error: "Invalid quote request update payload" }, { status: 400 });
    }

    const request = await updateQuoteRequest(parsed);

    if (!request) {
      auditOperatorAction({
        action: "quote_requests.update",
        actor: auth.actor,
        authMethod: auth.method,
        ip: getClientIp(req),
        userAgent: req.headers.get("user-agent"),
        requestId: parsed.requestId,
        agentId: parsed.agentId,
        status: parsed.status,
        outcome: "not_found",
      });
      return noStoreJson({ error: "Quote request not found" }, { status: 404 });
    }

    auditOperatorAction({
      action: "quote_requests.update",
      actor: auth.actor,
      authMethod: auth.method,
      ip: getClientIp(req),
      userAgent: req.headers.get("user-agent"),
      requestId: parsed.requestId,
      agentId: parsed.agentId,
      status: parsed.status,
      outcome: "success",
    });
    return noStoreJson({ request });
  } catch {
    auditOperatorAction({
      action: "quote_requests.update",
      actor: auth.actor,
      authMethod: auth.method,
      ip: getClientIp(req),
      userAgent: req.headers.get("user-agent"),
      outcome: "error",
    });
    return noStoreJson({ error: "Failed to update quote request" }, { status: 500 });
  }
}
