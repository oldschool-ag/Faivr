import "server-only";

import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { isProductionRuntime } from "@/lib/env";
import { getPgPool, hasDatabaseUrl } from "@/lib/postgres";
import type { CreateQuoteRequestInput, QuoteRequestRecord, TaskBriefArtifact, UpdateQuoteRequestInput } from "@/lib/quoteRequestSchema";

const DATA_DIR = path.join(process.cwd(), ".support-data");
const QUOTE_REQUESTS_FILE = path.join(DATA_DIR, "quote-requests.json");
const QUOTE_REQUESTS_TABLE = "quote_requests";

let ensureStoreReadyPromise: Promise<void> | null = null;

type QuoteRequestRow = {
  request_id: string;
  requester_address: string;
  agent_id: number;
  agent_name: string;
  brief_hash: string | null;
  brief_payload: TaskBriefArtifact;
  status: QuoteRequestRecord["status"];
  quote_amount: string | null;
  quote_message: string | null;
  operator_note: string | null;
  viewed_at: number | null;
  responded_at: number | null;
  closed_at: number | null;
  created_at: number;
  updated_at: number;
};

function shouldUseDatabase(): boolean {
  return hasDatabaseUrl();
}

function assertDurableProductionStore() {
  if (isProductionRuntime() && !shouldUseDatabase()) {
    throw new Error("DATABASE_URL is required in production for durable quote-request storage");
  }
}

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

function mapRowToQuoteRequestRecord(row: QuoteRequestRow): QuoteRequestRecord {
  return {
    requestId: row.request_id,
    requesterAddress: row.requester_address,
    agentId: row.agent_id,
    agentName: row.agent_name,
    briefHash: row.brief_hash,
    briefPayload: row.brief_payload,
    status: row.status,
    quoteAmount: row.quote_amount,
    quoteMessage: row.quote_message,
    operatorNote: row.operator_note,
    viewedAt: row.viewed_at,
    respondedAt: row.responded_at,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildUpdatedRecord(current: QuoteRequestRecord, input: UpdateQuoteRequestInput): QuoteRequestRecord {
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

  return next;
}

async function readLegacyQuoteRequests(): Promise<QuoteRequestRecord[]> {
  return readJson<QuoteRequestRecord[]>(QUOTE_REQUESTS_FILE, []);
}

async function createLegacyQuoteRequest(input: CreateQuoteRequestInput): Promise<QuoteRequestRecord> {
  const entries = await readLegacyQuoteRequests();
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

async function getLegacyQuoteRequestsByRequester(requesterAddress: string): Promise<QuoteRequestRecord[]> {
  const entries = await readLegacyQuoteRequests();
  const normalized = normalizeAddress(requesterAddress);

  return entries
    .filter((entry) => normalizeAddress(entry.requesterAddress) === normalized)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getLegacyQuoteRequestsByAgent(agentId?: number): Promise<QuoteRequestRecord[]> {
  const entries = await readLegacyQuoteRequests();

  return entries
    .filter((entry) => (typeof agentId === "number" ? entry.agentId === agentId : true))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

async function updateLegacyQuoteRequest(input: UpdateQuoteRequestInput): Promise<QuoteRequestRecord | null> {
  const entries = await readLegacyQuoteRequests();
  const index = entries.findIndex(
    (entry) => entry.requestId === input.requestId && (typeof input.agentId === "number" ? entry.agentId === input.agentId : true),
  );

  if (index === -1) return null;

  const next = buildUpdatedRecord(entries[index], input);
  entries[index] = next;
  await writeJson(QUOTE_REQUESTS_FILE, entries);
  return next;
}

async function ensureDatabaseStoreReady(): Promise<void> {
  if (!shouldUseDatabase()) return;

  if (!ensureStoreReadyPromise) {
    ensureStoreReadyPromise = initializeDatabaseStore().catch((error) => {
      ensureStoreReadyPromise = null;
      throw error;
    });
  }

  await ensureStoreReadyPromise;
}

async function initializeDatabaseStore(): Promise<void> {
  const pool = getPgPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${QUOTE_REQUESTS_TABLE} (
      request_id TEXT PRIMARY KEY,
      requester_address TEXT NOT NULL,
      agent_id INTEGER NOT NULL,
      agent_name TEXT NOT NULL,
      brief_hash TEXT,
      brief_payload JSONB NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('requested', 'viewed', 'quoted', 'closed')),
      quote_amount TEXT,
      quote_message TEXT,
      operator_note TEXT,
      viewed_at BIGINT,
      responded_at BIGINT,
      closed_at BIGINT,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS quote_requests_requester_created_idx
    ON ${QUOTE_REQUESTS_TABLE} (requester_address, created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS quote_requests_agent_updated_idx
    ON ${QUOTE_REQUESTS_TABLE} (agent_id, updated_at DESC)
  `);

  await importLegacyQuoteRequests(pool);
}

function serializeLegacyRecordForImport(record: QuoteRequestRecord) {
  return {
    request_id: record.requestId,
    requester_address: normalizeAddress(record.requesterAddress),
    agent_id: record.agentId,
    agent_name: record.agentName,
    brief_hash: record.briefHash ?? null,
    brief_payload: record.briefPayload,
    status: record.status,
    quote_amount: record.quoteAmount ?? null,
    quote_message: record.quoteMessage ?? null,
    operator_note: record.operatorNote ?? null,
    viewed_at: record.viewedAt ?? null,
    responded_at: record.respondedAt ?? null,
    closed_at: record.closedAt ?? null,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
  };
}

async function importLegacyQuoteRequests(pool: ReturnType<typeof getPgPool>): Promise<void> {
  const existing = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${QUOTE_REQUESTS_TABLE}`);
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    return;
  }

  const legacyRecords = await readLegacyQuoteRequests();
  if (legacyRecords.length === 0) {
    return;
  }

  const payload = JSON.stringify(legacyRecords.map(serializeLegacyRecordForImport));

  await pool.query(
    `
      INSERT INTO ${QUOTE_REQUESTS_TABLE} (
        request_id,
        requester_address,
        agent_id,
        agent_name,
        brief_hash,
        brief_payload,
        status,
        quote_amount,
        quote_message,
        operator_note,
        viewed_at,
        responded_at,
        closed_at,
        created_at,
        updated_at
      )
      SELECT
        entry.request_id,
        entry.requester_address,
        entry.agent_id,
        entry.agent_name,
        entry.brief_hash,
        entry.brief_payload,
        entry.status,
        entry.quote_amount,
        entry.quote_message,
        entry.operator_note,
        entry.viewed_at,
        entry.responded_at,
        entry.closed_at,
        entry.created_at,
        entry.updated_at
      FROM jsonb_to_recordset($1::jsonb) AS entry(
        request_id TEXT,
        requester_address TEXT,
        agent_id INTEGER,
        agent_name TEXT,
        brief_hash TEXT,
        brief_payload JSONB,
        status TEXT,
        quote_amount TEXT,
        quote_message TEXT,
        operator_note TEXT,
        viewed_at BIGINT,
        responded_at BIGINT,
        closed_at BIGINT,
        created_at BIGINT,
        updated_at BIGINT
      )
      ON CONFLICT (request_id) DO NOTHING
    `,
    [payload],
  );
}

async function createDatabaseQuoteRequest(input: CreateQuoteRequestInput): Promise<QuoteRequestRecord> {
  await ensureDatabaseStoreReady();

  const now = Date.now();
  const requestId = buildRequestId();
  const result = await getPgPool().query<QuoteRequestRow>(
    `
      INSERT INTO ${QUOTE_REQUESTS_TABLE} (
        request_id,
        requester_address,
        agent_id,
        agent_name,
        brief_hash,
        brief_payload,
        status,
        quote_amount,
        quote_message,
        operator_note,
        viewed_at,
        responded_at,
        closed_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'requested', NULL, NULL, NULL, NULL, NULL, NULL, $7, $7)
      RETURNING *
    `,
    [
      requestId,
      normalizeAddress(input.requesterAddress),
      input.agentId,
      input.agentName,
      input.briefHash ?? null,
      JSON.stringify(input.briefPayload),
      now,
    ],
  );

  return mapRowToQuoteRequestRecord(result.rows[0]);
}

async function getDatabaseQuoteRequestsByRequester(requesterAddress: string): Promise<QuoteRequestRecord[]> {
  await ensureDatabaseStoreReady();

  const result = await getPgPool().query<QuoteRequestRow>(
    `
      SELECT *
      FROM ${QUOTE_REQUESTS_TABLE}
      WHERE requester_address = $1
      ORDER BY created_at DESC
    `,
    [normalizeAddress(requesterAddress)],
  );

  return result.rows.map(mapRowToQuoteRequestRecord);
}

async function getDatabaseQuoteRequestsByAgent(agentId?: number): Promise<QuoteRequestRecord[]> {
  await ensureDatabaseStoreReady();

  const result = typeof agentId === "number"
    ? await getPgPool().query<QuoteRequestRow>(
        `
          SELECT *
          FROM ${QUOTE_REQUESTS_TABLE}
          WHERE agent_id = $1
          ORDER BY updated_at DESC
        `,
        [agentId],
      )
    : await getPgPool().query<QuoteRequestRow>(
        `
          SELECT *
          FROM ${QUOTE_REQUESTS_TABLE}
          ORDER BY updated_at DESC
        `,
      );

  return result.rows.map(mapRowToQuoteRequestRecord);
}

async function readQuoteRequestForUpdate(client: PoolClient, input: UpdateQuoteRequestInput): Promise<QuoteRequestRecord | null> {
  const result = await client.query<QuoteRequestRow>(
    `
      SELECT *
      FROM ${QUOTE_REQUESTS_TABLE}
      WHERE request_id = $1
        AND ($2::integer IS NULL OR agent_id = $2)
      FOR UPDATE
    `,
    [input.requestId, typeof input.agentId === "number" ? input.agentId : null],
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapRowToQuoteRequestRecord(result.rows[0]);
}

async function updateDatabaseQuoteRequest(input: UpdateQuoteRequestInput): Promise<QuoteRequestRecord | null> {
  await ensureDatabaseStoreReady();

  const client = await getPgPool().connect();

  try {
    await client.query("BEGIN");

    const current = await readQuoteRequestForUpdate(client, input);
    if (!current) {
      await client.query("ROLLBACK");
      return null;
    }

    const next = buildUpdatedRecord(current, input);
    if (next === current) {
      await client.query("COMMIT");
      return current;
    }

    const result = await client.query<QuoteRequestRow>(
      `
        UPDATE ${QUOTE_REQUESTS_TABLE}
        SET
          status = $2,
          quote_amount = $3,
          quote_message = $4,
          operator_note = $5,
          viewed_at = $6,
          responded_at = $7,
          closed_at = $8,
          updated_at = $9
        WHERE request_id = $1
        RETURNING *
      `,
      [
        next.requestId,
        next.status,
        next.quoteAmount ?? null,
        next.quoteMessage ?? null,
        next.operatorNote ?? null,
        next.viewedAt ?? null,
        next.respondedAt ?? null,
        next.closedAt ?? null,
        next.updatedAt,
      ],
    );

    await client.query("COMMIT");
    return mapRowToQuoteRequestRecord(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createQuoteRequest(input: CreateQuoteRequestInput): Promise<QuoteRequestRecord> {
  assertDurableProductionStore();

  if (!shouldUseDatabase()) {
    return createLegacyQuoteRequest(input);
  }

  return createDatabaseQuoteRequest(input);
}

export async function getQuoteRequestsByRequester(requesterAddress: string): Promise<QuoteRequestRecord[]> {
  assertDurableProductionStore();

  if (!shouldUseDatabase()) {
    return getLegacyQuoteRequestsByRequester(requesterAddress);
  }

  return getDatabaseQuoteRequestsByRequester(requesterAddress);
}

export async function getQuoteRequestsByAgent(agentId?: number): Promise<QuoteRequestRecord[]> {
  assertDurableProductionStore();

  if (!shouldUseDatabase()) {
    return getLegacyQuoteRequestsByAgent(agentId);
  }

  return getDatabaseQuoteRequestsByAgent(agentId);
}

export async function updateQuoteRequest(input: UpdateQuoteRequestInput): Promise<QuoteRequestRecord | null> {
  assertDurableProductionStore();

  if (!shouldUseDatabase()) {
    return updateLegacyQuoteRequest(input);
  }

  return updateDatabaseQuoteRequest(input);
}
