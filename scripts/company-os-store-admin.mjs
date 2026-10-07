#!/usr/bin/env node
// Old School's publisher-side administration of the private Truchsess store (T6b).
//
//   DATABASE_URL=... node scripts/company-os-store-admin.mjs <command> [options]
//
//   enrol-publisher   --public-key <ed25519-....pub> --publisher-id old-school --name "Old School AG"
//                     registers (or refreshes) the publisher key; the key id is derived from the key
//   create-bundle     --id design-review --name "Design review" --description "..." --amount-cents 4900 [--currency chf] [--polar-product <uuid>] [--stripe-price price_...]
//                     one Polar product (one monthly recurring price) per function bundle; the Stripe price is the second
//                     provider's reference. Without the active provider's reference the bundle is listed but cannot be subscribed
//   set-price         --id design-review [--polar-product <uuid>] [--stripe-price price_...] [--amount-cents 4900]
//   add-package       --bundle design-review --model-id faivr.agent.<slug>
//   remove-package    --bundle design-review --package faivr.agent.<slug>
//   issue-code        --label "Bernd's appliance" [--tenant <uuid>] [--days 14] [--by bernd@example] [--owner-email bernd@example]
//                     prints the one-time enrolment code ONCE; only its hash is stored. The owner email, if given, pre-fills the
//                     billing provider's checkout for that tenant (one provider customer per owner)
//   list              bundles, packages, appliances, subscriptions
//
// Nothing here touches Polar or Stripe: the CEO creates the product (Polar, sandbox first) or the price (Stripe) in the provider's dashboard
// and pastes its id. Nothing here touches the chain.
import { createHash, createPublicKey, randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "../web/node_modules/pg/lib/index.js";

const [command, ...rest] = process.argv.slice(2);
const options = {};
for (let i = 0; i < rest.length; i += 1) {
  if (rest[i].startsWith("--")) {
    const key = rest[i].slice(2);
    const value = rest[i + 1] !== undefined && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
    options[key] = value;
  }
}
const need = (name) => {
  if (!options[name]) {
    console.error(`--${name} is required`);
    process.exit(2);
  }
  return options[name];
};
const bundleIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const modelIdPattern = /^faivr\.agent\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function keyIdFor(pem) {
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error(`publisher key must be Ed25519, got ${key.asymmetricKeyType}`);
  const der = key.export({ type: "spki", format: "der" });
  return { keyId: `ed25519-${createHash("sha256").update(der.subarray(der.length - 32)).digest("hex").slice(0, 16)}`, pem: key.export({ type: "spki", format: "pem" }).toString() };
}

function enrolmentCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const groups = [];
  for (let g = 0; g < 4; g += 1) {
    let group = "";
    for (let i = 0; i < 5; i += 1) group += alphabet[randomInt(alphabet.length)];
    groups.push(group);
  }
  return `TRS-${groups.join("-")}`;
}

if (!command || !process.env.DATABASE_URL) {
  console.error("Usage: DATABASE_URL=... node scripts/company-os-store-admin.mjs enrol-publisher|create-bundle|set-price|add-package|remove-package|issue-code|list [options]");
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  if (command === "enrol-publisher") {
    const pem = await readFile(need("public-key"), "utf8");
    if (pem.includes("PRIVATE KEY")) throw new Error("that is a private key; register the .pub file");
    const { keyId, pem: normalized } = keyIdFor(pem);
    await client.query(
      "INSERT INTO company_os_publishers(key_id,public_key,status,publisher_id,name) VALUES($1,$2,'active',$3,$4) ON CONFLICT(key_id) DO UPDATE SET public_key=EXCLUDED.public_key,status='active',publisher_id=EXCLUDED.publisher_id,name=EXCLUDED.name",
      [keyId, normalized, need("publisher-id"), need("name")],
    );
    console.log(JSON.stringify({ publisherEnrolled: true, keyId, publisherId: options["publisher-id"], name: options.name }));
  } else if (command === "create-bundle" || command === "set-price") {
    const id = need("id");
    if (!bundleIdPattern.test(id)) throw new Error("bundle id must be lower-case words joined by hyphens");
    const price = options["stripe-price"] ?? null;
    if (price !== null && !/^price_[A-Za-z0-9]+$/.test(price)) throw new Error("the Stripe price id has the form price_...");
    const product = options["polar-product"] ?? null;
    if (product !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(product)) throw new Error("the Polar product id is the UUID shown by 'Copy Product ID' in the Polar dashboard");
    if (command === "create-bundle") {
      const amount = Number.parseInt(need("amount-cents"), 10);
      if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("--amount-cents must be a whole number of minor units");
      await client.query(
        "INSERT INTO company_os_function_bundles(id,name,description,stripe_price_id,polar_product_id,monthly_price_cents,currency) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,stripe_price_id=COALESCE(EXCLUDED.stripe_price_id,company_os_function_bundles.stripe_price_id),polar_product_id=COALESCE(EXCLUDED.polar_product_id,company_os_function_bundles.polar_product_id),monthly_price_cents=EXCLUDED.monthly_price_cents,currency=EXCLUDED.currency,updated_at=now()",
        [id, need("name"), need("description"), price, product, amount, (options.currency ?? "chf").toLowerCase()],
      );
    } else {
      if (price === null && product === null) throw new Error("--polar-product or --stripe-price is required");
      const amount = options["amount-cents"] !== undefined ? Number.parseInt(options["amount-cents"], 10) : null;
      const updated = await client.query(
        "UPDATE company_os_function_bundles SET stripe_price_id=COALESCE($2,stripe_price_id),polar_product_id=COALESCE($3,polar_product_id),monthly_price_cents=COALESCE($4,monthly_price_cents),updated_at=now() WHERE id=$1 RETURNING id",
        [id, price, product, amount],
      );
      if (!updated.rowCount) throw new Error(`bundle ${id} does not exist`);
    }
    const row = (await client.query("SELECT id,name,polar_product_id,stripe_price_id,monthly_price_cents,currency FROM company_os_function_bundles WHERE id=$1", [id])).rows[0];
    // subscribable under the active provider (FAIVR_BILLING_PROVIDER, polar by default); the value itself is not echoed
    const usesStripe = (process.env.FAIVR_BILLING_PROVIDER ?? "polar").trim().toLowerCase() === "stripe";
    console.log(JSON.stringify({ bundle: row, subscribable: Boolean(usesStripe ? row.stripe_price_id : row.polar_product_id) }));
  } else if (command === "add-package") {
    const bundle = need("bundle"), modelId = need("model-id");
    if (!modelIdPattern.test(modelId)) throw new Error("model id must be faivr.agent.<slug>");
    const exists = await client.query("SELECT 1 FROM company_os_packages WHERE id=$1", [modelId]);
    if (!exists.rowCount) throw new Error(`package ${modelId} is not imported yet; run scripts/import-company-os-bundle.mjs first`);
    const bundleRow = await client.query("SELECT 1 FROM company_os_function_bundles WHERE id=$1", [bundle]);
    if (!bundleRow.rowCount) throw new Error(`bundle ${bundle} does not exist`);
    await client.query("INSERT INTO company_os_bundle_packages(bundle_id,package_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [bundle, modelId]);
    console.log(JSON.stringify({ bundle, modelId, added: true }));
  } else if (command === "remove-package") {
    const bundle = need("bundle"), packageId = need("package");
    if (!modelIdPattern.test(packageId)) throw new Error("package must be faivr.agent.<slug>");
    const bundleRow = await client.query("SELECT id,public_listing FROM company_os_function_bundles WHERE id=$1", [bundle]);
    if (!bundleRow.rowCount) throw new Error(`bundle ${bundle} does not exist`);
    const member = await client.query("SELECT 1 FROM company_os_bundle_packages WHERE bundle_id=$1 AND package_id=$2", [bundle, packageId]);
    if (!member.rowCount) throw new Error(`package ${packageId} is not in bundle ${bundle}`);
    const count = await client.query("SELECT count(*)::int AS members FROM company_os_bundle_packages WHERE bundle_id=$1", [bundle]);
    if (bundleRow.rows[0].public_listing && Number(count.rows[0].members) <= 1) throw new Error("cannot empty a public bundle");
    await client.query("DELETE FROM company_os_bundle_packages WHERE bundle_id=$1 AND package_id=$2", [bundle, packageId]);
    await client.query("UPDATE company_os_packages SET public_listing=false WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM company_os_bundle_packages bp JOIN company_os_function_bundles b ON b.id=bp.bundle_id WHERE bp.package_id=$1 AND b.public_listing=true)", [packageId]);
    console.log(JSON.stringify({ bundle, packageId, removed: true }));
  } else if (command === "issue-code") {
    const label = need("label");
    const tenantId = options.tenant ?? randomUUID();
    const days = Number.parseInt(options.days ?? "14", 10);
    const code = enrolmentCode();
    const ownerEmail = options["owner-email"] ?? null;
    if (ownerEmail !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error("--owner-email must be an email address");
    await client.query(
      "INSERT INTO company_os_enrolment_codes(code_hash,tenant_id,label,created_by,expires_at,owner_email) VALUES($1,$2,$3,$4,now()+($5::text||' days')::interval,$6)",
      [createHash("sha256").update(code).digest("hex"), tenantId, label, options.by ?? process.env.USER ?? "store-admin", String(days), ownerEmail],
    );
    console.log(JSON.stringify({ enrolmentCode: code, tenantId, label, expiresInDays: days, ownerEmail, note: "shown once; only the hash is stored" }));
  } else if (command === "list") {
    const bundles = (await client.query("SELECT b.id,b.name,b.polar_product_id,b.stripe_price_id,b.monthly_price_cents,b.currency,b.status,(SELECT array_agg(package_id ORDER BY package_id) FROM company_os_bundle_packages WHERE bundle_id=b.id) AS packages FROM company_os_function_bundles b ORDER BY b.id")).rows;
    const packages = (await client.query("SELECT p.id,p.name,v.version,v.artifact_sha256,v.publisher_key_id,(SELECT count(*) FROM company_os_package_artifacts a WHERE a.version_id=v.id)::int AS inline_artifacts FROM company_os_packages p JOIN company_os_package_versions v ON v.package_id=p.id AND v.status='published' ORDER BY p.id,v.published_at DESC")).rows;
    const appliances = (await client.query("SELECT tenant_id,instance_id,key_id,label,enrolled_at,last_contact_at,revoked_at FROM company_os_instance_keys ORDER BY enrolled_at NULLS LAST")).rows;
    const subscriptions = (await client.query("SELECT id,tenant_id,bundle_id,subscription_state,billing_provider,provider_subscription_id,created_at,cancel_effective_at FROM company_os_bundle_subscriptions ORDER BY created_at DESC LIMIT 50")).rows;
    const codes = (await client.query("SELECT label,tenant_id,created_at,expires_at,used_at,instance_id FROM company_os_enrolment_codes ORDER BY created_at DESC LIMIT 50")).rows;
    console.log(JSON.stringify({ bundles, packages, appliances, subscriptions, enrolmentCodes: codes }, null, 2));
  } else {
    throw new Error(`unknown command ${command}`);
  }
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end();
}
