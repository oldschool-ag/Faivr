import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const MIGRATIONS_TABLE = "schema_migrations";
const LOCK_KEY_SQL = "SELECT pg_advisory_lock(hashtext('faivr-store-migrations'))";
const UNLOCK_KEY_SQL = "SELECT pg_advisory_unlock(hashtext('faivr-store-migrations'))";
const LEGACY_MIGRATION_HASHES = new Map([
  ["20261006_public_catalog.sql", "258db8b9238eaaa2e5bc7e323f372a8c4d503ee8979caf619b4f035f05ae6a75"],
  ["20261009_package_version_updates.sql", "ed8893b646cc0624e61930297870ca0ad734ee6192979c9ad8efb2b346fe72f3"],
  ["20261011_truchsess_release_channels.sql", "01694fec59052a0d5ef9e39694d5cf5d718ccf0fc90800f9647ca685234cdc2a"],
]);

export class MigrationError extends Error {}

export function migrationSha256(sql) {
  return createHash("sha256").update(sql).digest("hex");
}

/** Scan executable SQL only: strings, dollar-quoted blocks, and nested comments are opaque data. */
function scanSql(sql) {
  const tokens = [];
  let marker = false;
  let depth = 0;
  for (let index = 0; index < sql.length;) {
    const char = sql[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (sql.startsWith("--", index)) {
      const end = sql.indexOf("\n", index + 2);
      const comment = sql.slice(index + 2, end < 0 ? sql.length : end);
      if (depth === 0 && /^\s*allow-destructive:\s*\S.+\s*$/.test(comment)) marker = true;
      index = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", index)) {
      let nesting = 1;
      index += 2;
      while (index < sql.length && nesting) {
        if (sql.startsWith("/*", index)) { nesting += 1; index += 2; }
        else if (sql.startsWith("*/", index)) { nesting -= 1; index += 2; }
        else index += 1;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char; index += 1;
      while (index < sql.length) { if (sql[index] === quote && sql[index + 1] === quote) { index += 2; continue; } if (sql[index++] === quote) break; }
      continue;
    }
    if (char === "$") {
      const delimiter = sql.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        const end = sql.indexOf(delimiter, index + delimiter.length);
        index = end < 0 ? sql.length : end + delimiter.length;
        continue;
      }
    }
    if (char === "(") { tokens.push({ value: char, depth }); depth += 1; index += 1; continue; }
    if (char === ")") { depth = Math.max(0, depth - 1); tokens.push({ value: char, depth }); index += 1; continue; }
    if (char === ";") { tokens.push({ value: char, depth }); index += 1; continue; }
    const word = sql.slice(index).match(/^[A-Za-z_][A-Za-z0-9_$]*/)?.[0];
    if (word) { tokens.push({ value: word.toUpperCase(), depth }); index += word.length; continue; }
    index += 1;
  }
  return { tokens, marker };
}

export function sqlTokens(sql) {
  return scanSql(sql).tokens.map((token) => token.value);
}

export function assertSafeMigration(filename, sql) {
  const { tokens, marker } = scanSql(sql);
  let deletionDepth = null;
  let deleteHasOuterWhere = false;
  let destructive = false;
  for (const token of tokens) {
    if (token.value === "DROP" || token.value === "TRUNCATE") destructive = true;
    if (["DO", "EXECUTE", "FUNCTION", "PROCEDURE"].includes(token.value)) destructive = true;
    if (token.value === "DELETE") { deletionDepth = token.depth; deleteHasOuterWhere = false; }
    if (deletionDepth !== null && token.value === "WHERE" && token.depth === deletionDepth) deleteHasOuterWhere = true;
    if (token.value === ";" && token.depth === 0) {
      if (deletionDepth !== null && !deleteHasOuterWhere) destructive = true;
      deletionDepth = null;
      deleteHasOuterWhere = false;
    }
  }
  if (deletionDepth !== null && !deleteHasOuterWhere) destructive = true;
  if (destructive && !marker) throw new MigrationError(`Migration ${filename} contains destructive or opaque executable SQL without -- allow-destructive: <reason>`);
}

export async function readMigrations(directory) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(names.map(async (filename) => {
    const sql = await readFile(path.join(directory, filename), "utf8");
    assertSafeMigration(filename, sql);
    return { filename, sql, sha256: migrationSha256(sql) };
  }));
}

function columnsMatch(rows, expected) {
  return expected.every((column) => rows.some((row) => row.table_name === column.table && row.column_name === column.name && row.data_type === column.type && row.is_nullable === column.nullable && (!column.default || String(row.column_default ?? "").toLowerCase().includes(column.default))));
}

function normalizedConstraint(definition) {
  return String(definition)
    .toLowerCase()
    .replace(/::[a-z_ ]+/g, "")
    .replace(/[\s()]/g, "");
}

async function legacySchemaState(client, migration) {
  if (LEGACY_MIGRATION_HASHES.get(migration.filename) !== migration.sha256) return "absent";
  if (migration.filename === "20261006_public_catalog.sql") {
    const result = await client.query("SELECT table_name,column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('company_os_function_bundles','company_os_packages') AND column_name='public_listing'");
    if (!result.rows.length) return "absent";
    return columnsMatch(result.rows, [
      { table: "company_os_function_bundles", name: "public_listing", type: "boolean", nullable: "NO", default: "false" },
      { table: "company_os_packages", name: "public_listing", type: "boolean", nullable: "NO", default: "false" },
    ]) ? "compatible" : "incompatible";
  }
  if (migration.filename === "20261009_package_version_updates.sql") {
    const relation = await client.query("SELECT to_regclass('public.company_os_package_versions') AS relation");
    if (!relation.rows[0]?.relation) return "absent";
    const column = await client.query("SELECT data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='company_os_package_versions' AND column_name='release_notes'");
    if (!column.rows.length) return "absent";
    const constraints = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.company_os_package_versions'::regclass");
    return column.rows.length === 1 && column.rows[0].data_type === "text" && column.rows[0].is_nullable === "YES" && !column.rows[0].column_default && constraints.rows.some((row) => normalizedConstraint(row.definition) === "checkrelease_notesisnullorchar_lengthrelease_notes<=1000") ? "compatible" : "incompatible";
  }
  if (migration.filename === "20261011_truchsess_release_channels.sql") {
    const relation = await client.query("SELECT to_regclass('public.company_os_release_channels') AS relation");
    if (!relation.rows[0]?.relation) return "absent";
    const columns = await client.query("SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='company_os_release_channels'");
    const constraints = await client.query("SELECT contype,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.company_os_release_channels'::regclass");
    return columnsMatch(columns.rows.map((row) => ({ ...row, table_name: "company_os_release_channels" })), [
      { table: "company_os_release_channels", name: "channel", type: "text", nullable: "NO" },
      { table: "company_os_release_channels", name: "pinned_tag", type: "text", nullable: "YES" },
      { table: "company_os_release_channels", name: "updated_at", type: "timestamp with time zone", nullable: "NO", default: "now" },
    ]) && constraints.rows.some((row) => row.contype === "p" && normalizedConstraint(row.definition) === "primarykeychannel") && constraints.rows.some((row) => row.contype === "c" && normalizedConstraint(row.definition) === "checkchannel='stable'") ? "compatible" : "incompatible";
  }
  return "absent";
}

export async function applyStoreMigrations({ client, migrations, log = console.log }) {
  for (const migration of migrations) assertSafeMigration(migration.filename, migration.sql);
  await client.query(LOCK_KEY_SQL);
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (filename text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const recorded = await client.query(`SELECT filename,sha256 FROM ${MIGRATIONS_TABLE}`);
    const applied = new Map(recorded.rows.map((row) => [row.filename, row.sha256]));
    // Detect every history rewrite before applying a single pending migration.
    for (const migration of migrations) {
      const knownHash = applied.get(migration.filename);
      if (knownHash && knownHash !== migration.sha256) throw new MigrationError(`Migration ${migration.filename} was changed after it was applied`);
    }
    const result = { applied: [], backfilled: [], skipped: [] };
    for (const migration of migrations) {
      if (applied.has(migration.filename)) { result.skipped.push(migration.filename); continue; }
      await client.query("BEGIN");
      try {
        const legacyState = await legacySchemaState(client, migration);
        if (legacyState === "incompatible") throw new MigrationError(`Migration ${migration.filename} found an incompatible partial legacy schema`);
        if (legacyState === "compatible") {
          await client.query(`INSERT INTO ${MIGRATIONS_TABLE}(filename,sha256) VALUES($1,$2)`, [migration.filename, migration.sha256]);
          await client.query("COMMIT");
          result.backfilled.push(migration.filename);
          log(`Backfilled store migration ${migration.filename}`);
          continue;
        }
        await client.query(migration.sql);
        await client.query(`INSERT INTO ${MIGRATIONS_TABLE}(filename,sha256) VALUES($1,$2)`, [migration.filename, migration.sha256]);
        await client.query("COMMIT");
        result.applied.push(migration.filename);
        log(`Applied store migration ${migration.filename}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error instanceof MigrationError ? error : new MigrationError(`Migration ${migration.filename} failed`);
      }
    }
    return result;
  } finally {
    await client.query(UNLOCK_KEY_SQL).catch(() => {});
  }
}

function normalizedNeonEndpoint(connectionString) {
  const url = new URL(connectionString);
  return {
    hostname: url.hostname.replace("-pooler.", "."),
    port: url.port || "5432",
    pathname: decodeURIComponent(url.pathname),
  };
}

export function migrationDatabaseUrl(env = process.env) {
  // Neon Vercel integration supplies this direct URL separately for each preview/production deployment.
  const direct = env.STORE_MIGRATIONS_DATABASE_URL ?? env.DATABASE_URL_UNPOOLED;
  if (!direct || !env.DATABASE_URL) throw new MigrationError("deployment migration database URLs are not configured");
  if (new URL(direct).hostname.includes("-pooler.")) throw new MigrationError("migration database URL must use a direct unpooled Neon host");
  const directEndpoint = normalizedNeonEndpoint(direct);
  const applicationEndpoint = normalizedNeonEndpoint(env.DATABASE_URL);
  if (
    directEndpoint.hostname !== applicationEndpoint.hostname ||
    directEndpoint.port !== applicationEndpoint.port ||
    directEndpoint.pathname !== applicationEndpoint.pathname
  ) throw new MigrationError("migration database URL does not match this deployment database branch");
  return direct;
}

export async function runStoreMigrations({ databaseUrl = migrationDatabaseUrl(), migrationsDirectory = path.resolve("sql/migrations"), ClientClass = Client } = {}) {
  const client = new ClientClass({ connectionString: databaseUrl });
  try {
    await client.connect();
    return await applyStoreMigrations({ client, migrations: await readMigrations(migrationsDirectory) });
  } catch (error) {
    if (error instanceof MigrationError) throw error;
    throw new MigrationError("Store migration database connection or execution failed");
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  runStoreMigrations().catch((error) => {
    console.error(`Store migration failed: ${error instanceof MigrationError ? error.message : "migration execution failed"}`);
    process.exitCode = 1;
  });
}
