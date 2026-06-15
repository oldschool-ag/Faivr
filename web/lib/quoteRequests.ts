import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { CreateQuoteRequestInput, QuoteRequestRecord, UpdateQuoteRequestInput } from "@/lib/quoteRequestSchema";

const DATA_DIR = path.join(process.cwd(), ".support-data");
const QUOTE_REQUESTS_FILE = path.join(DATA_DIR, "quote-requests.json");

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, data: unknown) {
  await ensureDir();
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildRequestId(): string {
  return `qr_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

async function readQuoteRequests(): Promise<QuoteRequestRecord[]> {
  return readJson<QuoteRequestRecord[]>(QUOTE_REQUESTS_FILE, []);
}

export async function createQuoteRequest(input: CreateQuoteRequestInput): Promise<QuoteRequestRecord> {
  const entries = await readQuoteRequests();
  const now = Date.now();

  const record: QuoteRequestRecord = {
    requestId: buildRequestId(),
    requesterAddress: normalizeAddress(input.requesterAddress),
    agentId: input.agentId,
    agentName: input.agentName,
    briefHash: input.briefHash ?? null,
    briefPayload: input.briefPayload,
    status: "requested",
    quoteAmount: null,
    quoteMessage: null,
    operatorNote: null,
    viewedAt: null,
    respondedAt: null,
    closedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  entries.push(record);
  await writeJson(QUOTE_REQUESTS_FILE, entries);
  return record;
}

export async function getQuoteRequestsByRequester(requesterAddress: string): Promise<QuoteRequestRecord[]> {
  const entries = await readQuoteRequests();
  const normalized = normalizeAddress(requesterAddress);

  return entries
    .filter((entry) => normalizeAddress(entry.requesterAddress) === normalized)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getQuoteRequestsByAgent(agentId?: number): Promise<QuoteRequestRecord[]> {
  const entries = await readQuoteRequests();

  return entries
    .filter((entry) => (typeof agentId === "number" ? entry.agentId === agentId : true))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function updateQuoteRequest(input: UpdateQuoteRequestInput): Promise<QuoteRequestRecord | null> {
  const entries = await readQuoteRequests();
  const index = entries.findIndex(
    (entry) => entry.requestId === input.requestId && (typeof input.agentId === "number" ? entry.agentId === input.agentId : true),
  );

  if (index === -1) return null;

  const current = entries[index];
  if (current.status === "closed" && input.status !== "closed") {
    return current;
  }

  const now = Date.now();
  const next: QuoteRequestRecord = {
    ...current,
    updatedAt: now,
  };

  if (input.status === "viewed") {
    if (next.status !== "quoted" && next.status !== "closed") {
      next.status = "viewed";
    }
    next.viewedAt ??= now;
  }

  if (input.status === "quoted") {
    next.status = "quoted";
    next.viewedAt ??= now;
    next.respondedAt = now;
    next.quoteAmount = normalizeOptionalString(input.quoteAmount);
    next.quoteMessage = normalizeOptionalString(input.quoteMessage);
    next.operatorNote = normalizeOptionalString(input.operatorNote);
  }

  if (input.status === "closed") {
    next.status = "closed";
    next.closedAt = now;
    const operatorNote = normalizeOptionalString(input.operatorNote);
    if (operatorNote !== null) {
      next.operatorNote = operatorNote;
    }
  }

  entries[index] = next;
  await writeJson(QUOTE_REQUESTS_FILE, entries);
  return next;
}
