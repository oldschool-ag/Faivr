import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { resetRateLimitForTests } from "@/lib/rateLimit";
import type { QuoteRequestRecord } from "@/lib/quoteRequestSchema";

vi.mock("@/lib/quoteRequests", () => ({
  createQuoteRequest: vi.fn(),
  getQuoteRequestsByAgent: vi.fn(),
  getQuoteRequestsByRequester: vi.fn(),
  updateQuoteRequest: vi.fn(),
}));

import { GET, PATCH, POST } from "@/app/api/quote-requests/route";
import { proxy } from "@/proxy";
import {
  createQuoteRequest,
  getQuoteRequestsByAgent,
  getQuoteRequestsByRequester,
  updateQuoteRequest,
} from "@/lib/quoteRequests";

const requesterAddress = "0x1111111111111111111111111111111111111111";
const operatorUsername = "operator";
const operatorPassword = "correct-password";
type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

function basicAuthHeader(username = operatorUsername, password = operatorPassword): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function buildRequest(path: string, init?: NextRequestInit): NextRequest {
  return new NextRequest(`https://faivr.test${path}`, init);
}

function validCreatePayload() {
  return {
    requesterAddress,
    agentId: 7,
    agentName: "Research Agent",
    briefHash: "abc123",
    briefPayload: {
      version: 1 as const,
      agentId: 7,
      agentName: "Research Agent",
      title: "Review data room",
      objective: "Summarize the relevant diligence material.",
      tokenSymbol: "USDC",
      deadlineLabel: "This week",
    },
  };
}

function quoteRecord(overrides: Partial<QuoteRequestRecord> = {}): QuoteRequestRecord {
  return {
    requestId: "qr_test_1",
    requesterAddress,
    agentId: 7,
    agentName: "Research Agent",
    briefHash: "abc123",
    briefPayload: validCreatePayload().briefPayload,
    status: "requested" as const,
    quoteAmount: null,
    quoteMessage: null,
    operatorNote: null,
    viewedAt: null,
    respondedAt: null,
    closedAt: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("quote request API", () => {
  beforeEach(() => {
    resetRateLimitForTests();
    vi.clearAllMocks();
    vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.OPERATOR_AUTH_USERNAME = operatorUsername;
    process.env.OPERATOR_AUTH_PASSWORD = operatorPassword;
    delete process.env.QUOTE_REQUEST_OPERATOR_KEY;
  });

  test("rejects invalid quote request payloads", async () => {
    const response = await POST(
      buildRequest("/api/quote-requests", {
        method: "POST",
        body: JSON.stringify({ requesterAddress: "not-an-address" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(createQuoteRequest).not.toHaveBeenCalled();
  });

  test("creates a quote request for a valid public payload", async () => {
    vi.mocked(createQuoteRequest).mockResolvedValueOnce(quoteRecord());

    const response = await POST(
      buildRequest("/api/quote-requests", {
        method: "POST",
        body: JSON.stringify(validCreatePayload()),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.request.requestId).toBe("qr_test_1");
    expect(createQuoteRequest).toHaveBeenCalledWith(expect.objectContaining({ requesterAddress, agentId: 7 }));
  });

  test("allows public requester lookup without operator auth", async () => {
    vi.mocked(getQuoteRequestsByRequester).mockResolvedValueOnce([quoteRecord()]);

    const response = await GET(buildRequest(`/api/quote-requests?requesterAddress=${requesterAddress}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requests).toHaveLength(1);
    expect(getQuoteRequestsByRequester).toHaveBeenCalledWith(requesterAddress);
  });

  test("rejects unauthorized operator GET", async () => {
    const response = await GET(buildRequest("/api/quote-requests?agentId=7"));

    expect(response.status).toBe(401);
    expect(getQuoteRequestsByAgent).not.toHaveBeenCalled();
  });

  test("rejects unauthorized operator PATCH", async () => {
    const response = await PATCH(
      buildRequest("/api/quote-requests", {
        method: "PATCH",
        body: JSON.stringify({ requestId: "qr_test_1", status: "viewed" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(updateQuoteRequest).not.toHaveBeenCalled();
  });

  test("updates a quote request with authorized operator auth", async () => {
    vi.mocked(updateQuoteRequest).mockResolvedValueOnce(quoteRecord({ status: "quoted", quoteMessage: "Ready" }));

    const response = await PATCH(
      buildRequest("/api/quote-requests", {
        method: "PATCH",
        headers: {
          Authorization: basicAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requestId: "qr_test_1",
          agentId: 7,
          status: "quoted",
          quoteAmount: "100",
          quoteMessage: "Ready",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.request.status).toBe("quoted");
    expect(updateQuoteRequest).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "qr_test_1", agentId: 7, status: "quoted", quoteMessage: "Ready" }),
    );
  });

  test("rejects invalid operator status handling", async () => {
    const response = await PATCH(
      buildRequest("/api/quote-requests", {
        method: "PATCH",
        headers: {
          Authorization: basicAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId: "qr_test_1", status: "requested" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(updateQuoteRequest).not.toHaveBeenCalled();
  });

  test("rejects invalid operator agentId handling", async () => {
    const response = await GET(
      buildRequest("/api/quote-requests?agentId=not-a-number", {
        headers: { Authorization: basicAuthHeader() },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("agentId must be a valid number");
    expect(getQuoteRequestsByAgent).not.toHaveBeenCalled();
  });

  test("smoke checks operator route auth behavior", async () => {
    const unauthorized = await proxy(buildRequest("/operator/quote-requests"));
    expect(unauthorized.status).toBe(401);

    const authorized = await proxy(
      buildRequest("/operator/quote-requests", {
        headers: { Authorization: basicAuthHeader() },
      }),
    );
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("x-robots-tag")).toContain("noindex");
  });
});
