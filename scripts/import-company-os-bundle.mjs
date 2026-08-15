#!/usr/bin/env node
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import pg from "../web/node_modules/pg/lib/index.js";

const [bundleArg]=process.argv.slice(2);
if(!bundleArg||!process.env.DATABASE_URL){console.error("Usage: DATABASE_URL=... node scripts/import-company-os-bundle.mjs bundle.json");process.exit(2);}
const canonical=(v)=>v===null?"null":typeof v==="string"?JSON.stringify(v):typeof v==="boolean"?(v?"true":"false"):typeof v==="number"?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(",")}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
const raw=JSON.parse(await readFile(resolve(bundleArg),"utf8"));
const {signature,...unsigned}=raw;
if(raw.schemaVersion!=="faivr-portable-agent-bundle.v1"||!raw.model?.id||!raw.version?.version||!raw.artifact?.path||!raw.artifact?.url||!signature?.keyId||!signature?.value)throw new Error("invalid portable bundle envelope");
const artifactUrl=new URL(raw.artifact.url),allowedOrigin=process.env.FAIVR_PACKAGE_ORIGIN?.trim();
if(artifactUrl.protocol!=="https:"||!allowedOrigin||artifactUrl.origin!==new URL(allowedOrigin).origin)throw new Error("artifact URL must use the configured FAIVR package origin");
if(!/^faivr\.agent\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(raw.model.id)||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(raw.version.version))throw new Error("invalid model/version identifier");
const allowed=/^(agents|skills|tools|workflows|docs|assets)\/[A-Za-z0-9._/-]+$/;
for(const path of raw.manifest?.managedPaths??[])if(!allowed.test(path)||path.includes(".."))throw new Error(`managed path not allowed: ${path}`);
const artifact=await readFile(resolve(dirname(resolve(bundleArg)),raw.artifact.path));
const text=artifact.toString("utf8");
const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/(?:sk_live_|rk_live_|AKIA)[A-Za-z0-9_\-]{12,}/,/\b(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}/i];
if(secretPatterns.some(pattern=>pattern.test(text)))throw new Error("potential secret detected in portable bundle");
const digest=`sha256:${createHash("sha256").update(artifact).digest("hex")}`;
if(digest!==raw.artifact.sha256)throw new Error("artifact digest mismatch");
const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
try{await client.query("BEGIN");const publisher=await client.query("SELECT public_key FROM company_os_publishers WHERE key_id=$1 AND status='active'",[signature.keyId]);if(!publisher.rowCount)throw new Error("publisher key is not enrolled");if(!verify(null,Buffer.from(canonical(unsigned)),createPublicKey(publisher.rows[0].public_key),Buffer.from(signature.value,"base64url")))throw new Error("invalid publisher signature");await client.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,summary=EXCLUDED.summary",[raw.model.id,raw.model.slug,raw.model.name,raw.model.summary]);const imported=await client.query("INSERT INTO company_os_package_versions(package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,'published',$3,$4,$5,$6,$7,$8,$9,$10,now()) ON CONFLICT(package_id,version) DO UPDATE SET package_id=EXCLUDED.package_id WHERE company_os_package_versions.artifact_sha256=EXCLUDED.artifact_sha256 AND company_os_package_versions.publisher_signature=EXCLUDED.publisher_signature RETURNING id",[raw.model.id,raw.version.version,JSON.stringify(raw.manifest),signature.keyId,signature.value,raw.artifact.url,digest,raw.version.monthlyPriceCents,raw.version.stripePriceId??null,raw.version.minCompanyOsVersion]);if(!imported.rowCount)throw new Error("published version conflicts with different signed material");await client.query("COMMIT");console.log(JSON.stringify({imported:true,modelId:raw.model.id,version:raw.version.version,digest}));}catch(e){await client.query("ROLLBACK");throw e;}finally{await client.end();}
