#!/usr/bin/env node
import { parseArgs } from "node:util";
import pg from "pg";

const { positionals, values } = parseArgs({ allowPositionals: true, options: { help: { type: "boolean" } } });
const [command, tag] = positionals;
if (values.help || !command) {
  console.log("Use the configured store-admin environment (DATABASE_URL):\n  node scripts/store-release-admin.mjs set-stable truchsess-iso-YYYY.MM.DD\n  node scripts/store-release-admin.mjs clear");
  process.exit(0);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be provided by the store-admin environment");
if ((command !== "set-stable" && command !== "clear") || (command === "set-stable" && (!tag || positionals.length !== 2)) || (command === "clear" && positionals.length !== 1)) throw new Error("Use set-stable <truchsess-iso-tag> or clear");
if (command === "set-stable" && !/^truchsess-iso-[A-Za-z0-9._-]+$/.test(tag)) throw new Error("stable tag must start with truchsess-iso-");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const pinnedTag = command === "clear" ? null : tag;
  await pool.query("INSERT INTO company_os_release_channels(channel,pinned_tag,updated_at) VALUES('stable',$1,now()) ON CONFLICT(channel) DO UPDATE SET pinned_tag=EXCLUDED.pinned_tag,updated_at=now()", [pinnedTag]);
  console.log(JSON.stringify({ channel: "stable", pinnedTag }));
} finally { await pool.end(); }
