import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { applyStoreMigrations, assertSafeMigration, migrationDatabaseUrl, migrationSha256, readMigrations } from "./run-store-migrations.mjs";

function fakeClient({ recorded = [], legacy = false, legacyAll = false } = {}) {
  const calls = [];
  const ledger = new Map(recorded.map((item) => [item.filename, item.sha256]));
  return { calls, async query(sql, params = []) {
    calls.push([sql, params]);
    if (sql.startsWith("SELECT filename")) return { rows: [...ledger].map(([filename, sha256]) => ({ filename, sha256 })) };
    if (sql.includes("to_regclass")) {
      if (legacyAll && sql.includes("company_os_release_channels")) return { rows: [{ relation: "company_os_release_channels" }] };
      return { rows: [{ relation: legacy || legacyAll ? "company_os_package_versions" : null }] };
    }
    if (sql.includes("information_schema.columns")) {
      if (legacyAll && sql.includes("company_os_function_bundles")) return { rows: [
        { table_name: "company_os_function_bundles", column_name: "public_listing", data_type: "boolean", is_nullable: "NO", column_default: "false" },
        { table_name: "company_os_packages", column_name: "public_listing", data_type: "boolean", is_nullable: "NO", column_default: "false" },
      ] };
      if (legacyAll && sql.includes("company_os_release_channels")) return { rows: [
        { column_name: "channel", data_type: "text", is_nullable: "NO", column_default: null },
        { column_name: "pinned_tag", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "updated_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
      ] };
      return { rows: legacy || legacyAll ? [{ table_name: "company_os_package_versions", column_name: "release_notes", data_type: "text", is_nullable: "YES", column_default: null }] : [] };
    }
    if (sql.includes("pg_constraint")) {
      if (legacyAll && sql.includes("company_os_release_channels")) return { rows: [
        { contype: "p", definition: "PRIMARY KEY (channel)" },
        { contype: "c", definition: "CHECK ((channel = 'stable'::text))" },
      ] };
      return { rows: legacy || legacyAll ? [{ definition: "CHECK ((release_notes IS NULL) OR (char_length(release_notes) <= 1000))" }] : [] };
    }
    if (sql.startsWith("INSERT INTO schema_migrations")) { ledger.set(params[0], params[1]); return { rows: [] }; }
    return { rows: [] };
  } };
}
const migration = (filename, sql) => ({ filename, sql, sha256: migrationSha256(sql) });

test("applies a new migration once and skips it on the second run", async () => {
  const client = fakeClient();
  const item = migration("20261012_example.sql", "CREATE TABLE example(id text);");
  const first = await applyStoreMigrations({ client, migrations: [item], log: () => {} });
  const second = await applyStoreMigrations({ client, migrations: [item], log: () => {} });
  assert.deepEqual(first.applied, [item.filename]);
  assert.deepEqual(second.skipped, [item.filename]);
  assert.ok(client.calls.some(([sql]) => sql.includes("pg_advisory_lock")));
});

test("preflights every recorded hash before applying a pending migration", async () => {
  const changed = migration("20261014_changed.sql", "CREATE TABLE changed(id text);");
  const pending = migration("20261012_pending.sql", "CREATE TABLE pending(id text);");
  const client = fakeClient({ recorded: [{ filename: changed.filename, sha256: "different" }] });
  await assert.rejects(() => applyStoreMigrations({ client, migrations: [pending, changed], log: () => {} }), /was changed after it was applied/);
  assert.equal(client.calls.some(([sql]) => sql === pending.sql), false);
});

test("refuses destructive or opaque SQL without a real outer marker", () => {
  assert.throws(() => assertSafeMigration("x.sql", "DROP TABLE example;"), /destructive|opaque/);
  assert.throws(() => assertSafeMigration("x.sql", "DELETE FROM example /* WHERE id=1 */;"), /destructive|opaque/);
  assert.throws(() => assertSafeMigration("x.sql", "DELETE FROM example note='WHERE';"), /destructive|opaque/);
  assert.throws(() => assertSafeMigration("x.sql", "DELETE FROM probe RETURNING (SELECT 1 WHERE true);"), /destructive|opaque/);
  assert.throws(() => assertSafeMigration("x.sql", "SELECT $body$\n-- allow-destructive: fake marker inside data\n$body$; DROP TABLE probe;"), /destructive|opaque/);
  assert.throws(() => assertSafeMigration("x.sql", "DO $$ BEGIN DELETE FROM probe; END $$;"), /destructive|opaque/);
  assert.doesNotThrow(() => assertSafeMigration("x.sql", "DELETE FROM example WHERE note='WHERE';"));
  assert.doesNotThrow(() => assertSafeMigration("x.sql", "-- allow-destructive: remove obsolete table\nDROP TABLE example;"));
});

test("enforces the destructive gate even when callers bypass readMigrations", async () => {
  const client = fakeClient();
  const item = migration("20261012_bad.sql", "TRUNCATE example;");
  await assert.rejects(() => applyStoreMigrations({ client, migrations: [item], log: () => {} }), /destructive|opaque/);
});

test("backfills legacy F7 only after its compatible schema inspection", async () => {
  const client = fakeClient({ legacy: true });
  const item = { filename: "20261009_package_version_updates.sql", sql: "legacy migration bytes", sha256: "ed8893b646cc0624e61930297870ca0ad734ee6192979c9ad8efb2b346fe72f3" };
  const result = await applyStoreMigrations({ client, migrations: [item], log: () => {} });
  assert.deepEqual(result.backfilled, [item.filename]);
  assert.equal(client.calls.some(([sql]) => sql === item.sql), false);
});

test("backfills all released migrations from their unchanged source bytes", async () => {
  const migrations = await readMigrations(path.resolve("sql/migrations"));
  assert.deepEqual(migrations.map((item) => item.filename), [
    "20261006_public_catalog.sql",
    "20261009_package_version_updates.sql",
    "20261011_truchsess_release_channels.sql",
  ]);
  assert.equal(migrations[1].sha256, "ed8893b646cc0624e61930297870ca0ad734ee6192979c9ad8efb2b346fe72f3");
  const client = fakeClient({ legacyAll: true });
  const first = await applyStoreMigrations({ client, migrations, log: () => {} });
  const second = await applyStoreMigrations({ client, migrations, log: () => {} });
  assert.deepEqual(first.backfilled, migrations.map((item) => item.filename));
  assert.deepEqual(first.applied, []);
  assert.deepEqual(second.skipped, migrations.map((item) => item.filename));
});

test("requires a direct URL on the same Neon deployment branch", () => {
  assert.equal(migrationDatabaseUrl({ DATABASE_URL_UNPOOLED: "postgres://u@ep-blue.aws.neon.tech/db", DATABASE_URL: "postgres://u@ep-blue-pooler.aws.neon.tech/db" }), "postgres://u@ep-blue.aws.neon.tech/db");
  assert.equal(migrationDatabaseUrl({ STORE_MIGRATIONS_DATABASE_URL: "postgres://u@ep-preview.aws.neon.tech/db", DATABASE_URL: "postgres://u@ep-preview-pooler.aws.neon.tech/db" }), "postgres://u@ep-preview.aws.neon.tech/db");
  assert.throws(() => migrationDatabaseUrl({ DATABASE_URL_UNPOOLED: "postgres://u@ep-blue-pooler.aws.neon.tech/db", DATABASE_URL: "postgres://u@ep-blue-pooler.aws.neon.tech/db" }), /unpooled/);
  assert.throws(() => migrationDatabaseUrl({ DATABASE_URL_UNPOOLED: "postgres://u@ep-other.aws.neon.tech/db", DATABASE_URL: "postgres://u@ep-blue-pooler.aws.neon.tech/db" }), /does not match/);
  assert.throws(() => migrationDatabaseUrl({ DATABASE_URL_UNPOOLED: "postgres://u@ep-blue.aws.neon.tech/production", DATABASE_URL: "postgres://u@ep-blue-pooler.aws.neon.tech/preview" }), /does not match/);
  assert.throws(() => migrationDatabaseUrl({ DATABASE_URL_UNPOOLED: "postgres://u@ep-blue.aws.neon.tech:5433/db", DATABASE_URL: "postgres://u@ep-blue-pooler.aws.neon.tech:5432/db" }), /does not match/);
  assert.equal(migrationDatabaseUrl({ DATABASE_URL_UNPOOLED: "postgres://u@ep-blue.aws.neon.tech/preview%2Dbranch", DATABASE_URL: "postgres://u@ep-blue-pooler.aws.neon.tech/preview-branch" }), "postgres://u@ep-blue.aws.neon.tech/preview%2Dbranch");
});
