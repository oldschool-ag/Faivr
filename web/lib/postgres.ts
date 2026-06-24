import "server-only";

import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __faivrPgPool: Pool | undefined;
}

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  return databaseUrl;
}

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPgPool(): Pool {
  if (!globalThis.__faivrPgPool) {
    globalThis.__faivrPgPool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 5,
    });
  }

  return globalThis.__faivrPgPool;
}
