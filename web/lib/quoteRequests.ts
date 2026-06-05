import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { CreateQuoteRequestInput, QuoteRequestRecord } from "@/lib/quoteRequestSchema";

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

function buildRequestId(): string {
  return `qr_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

export async function createQuoteRequest(input: CreateQuoteRequestInput): Promise<QuoteRequestRecord> {
  const entries = await readJson<QuoteRequestRecord[]>(QUOTE_REQUESTS_FILE, []);
  const now = Date.now();

  const record: QuoteRequestRecord = {
    requestId: buildRequestId(),
    requesterAddress: normalizeAddress(input.requesterAddress),
    agentId: input.agentId,
    agentName: input.agentName,
    briefHash: input.briefHash ?? null,
    briefPayload: input.briefPayload,
    status: "requested",
    createdAt: now,
    updatedAt: now,
  };

  entries.push(record);
  await writeJson(QUOTE_REQUESTS_FILE, entries);
  return record;
}

export async function getQuoteRequestsByRequester(requesterAddress: string): Promise<QuoteRequestRecord[]> {
  const entries = await readJson<QuoteRequestRecord[]>(QUOTE_REQUESTS_FILE, []);
  const normalized = normalizeAddress(requesterAddress);

  return entries
    .filter((entry) => normalizeAddress(entry.requesterAddress) === normalized)
    .sort((a, b) => b.createdAt - a.createdAt);
}
