#!/usr/bin/env node
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import pg from "../web/node_modules/pg/lib/index.js";

const [bundleArg]=process.argv.slice(2);
const artifactUrlInput=process.env.FAIVR_ARTIFACT_URL?.trim();
if(!bundleArg||!process.env.DATABASE_URL||!process.env.FAIVR_PACKAGE_ORIGIN||!artifactUrlInput){
  console.error("Usage: DATABASE_URL=... FAIVR_PACKAGE_ORIGIN=https://... FAIVR_ARTIFACT_URL=https://... node scripts/import-company-os-bundle.mjs bundle.json");
  process.exit(2);
}

const canonical=(v)=>v===null?"null":typeof v==="string"?JSON.stringify(v):typeof v==="boolean"?(v?"true":"false"):typeof v==="number"?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(",")}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/(?:sk_live_|rk_live_|AKIA)[A-Za-z0-9_\-]{12,}/,/\b(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}/i];
const cleanArchivePath=(value)=>typeof value==="string"&&!value.includes("\\")&&!value.startsWith("/")&&!value.split("/").includes("..")&&!value.includes("//");
const octal=(field)=>{const value=field.toString("ascii").replace(/\0.*$/s,"").trim();if(!/^[0-7]*$/.test(value))throw new Error("invalid tar numeric field");return value?Number.parseInt(value,8):0;};

function inspectTarGz(compressed,expectedManifest){
  const maxCompressed=Number(process.env.FAIVR_MAX_PACKAGE_BYTES??50*1024*1024);
  if(!Number.isSafeInteger(maxCompressed)||maxCompressed<=0||compressed.length>maxCompressed)throw new Error("portable bundle exceeds compressed size limit");
  const tar=gunzipSync(compressed,{maxOutputLength:maxCompressed*4});
  const seen=new Set();let offset=0,manifest=null,payloadFiles=0,totalPayload=0;
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);offset+=512;
    if(header.every(byte=>byte===0))break;
    const name=header.subarray(0,100).toString("utf8").replace(/\0.*$/s,"");
    const prefix=header.subarray(345,500).toString("utf8").replace(/\0.*$/s,"");
    const path=prefix?`${prefix}/${name}`:name;
    const size=octal(header.subarray(124,136));
    const type=String.fromCharCode(header[156]||48);
    const storedChecksum=octal(header.subarray(148,156));
    const checksumHeader=Buffer.from(header);checksumHeader.fill(32,148,156);
    const computedChecksum=checksumHeader.reduce((sum,byte)=>sum+byte,0);
    if(storedChecksum!==computedChecksum)throw new Error(`invalid tar checksum at ${path}`);
    if(!cleanArchivePath(path)||seen.has(path))throw new Error(`unsafe or duplicate archive path: ${path}`);
    if(type!=="0"&&type!=="5")throw new Error(`unsupported archive entry type at ${path}`);
    if(type==="5"&&size!==0)throw new Error(`directory has payload bytes: ${path}`);
    const rootPayload=/^payload\/(?:AGENTS\.md|SOUL\.md|IDENTITY\.md|role\.md|config\.schema\.json|permissions\.json)$/.test(path);
    const nestedPayload=/^payload\/(?:skills|tools|workflows|docs|assets)\/[A-Za-z0-9._/-]+$/.test(path);
    if(type==="0"&&path!=="manifest.json"&&!rootPayload&&!nestedPayload)throw new Error(`archive path outside portable layout: ${path}`);
    if(offset+size>tar.length)throw new Error(`truncated archive entry: ${path}`);
    const body=tar.subarray(offset,offset+size);offset+=Math.ceil(size/512)*512;seen.add(path);
    if(type==="0"){
      totalPayload+=size;if(totalPayload>maxCompressed*4)throw new Error("portable bundle exceeds expanded size limit");
      if(secretPatterns.some(pattern=>pattern.test(body.toString("utf8"))))throw new Error(`potential secret detected in ${path}`);
      if(path==="manifest.json"){if(size>1024*1024)throw new Error("manifest exceeds size limit");manifest=JSON.parse(body.toString("utf8"));}else payloadFiles+=1;
    }
  }
  if(!manifest||payloadFiles===0||canonical(manifest)!==canonical(expectedManifest))throw new Error("archive manifest/payload mismatch");
}

const raw=JSON.parse(await readFile(resolve(bundleArg),"utf8"));
const {signature,...unsignedEnvelope}=raw;
if(raw.schemaVersion!=="faivr-portable-agent-bundle.v1"||!raw.model?.id||!raw.version?.version||!raw.artifact?.path||!raw.artifact?.sha256||!Number.isSafeInteger(raw.artifact?.size)||!signature?.keyId||!signature?.value)throw new Error("invalid portable bundle envelope");
if(!/^faivr\.agent\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(raw.model.id)||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(raw.version.version))throw new Error("invalid model/version identifier");
const allowedManaged=/^(agents|skills|tools|workflows|docs|assets)\/[A-Za-z0-9._/-]+$/;
for(const path of raw.manifest?.managedPaths??[])if(!allowedManaged.test(path)||!cleanArchivePath(path))throw new Error(`managed path not allowed: ${path}`);

const artifact=await readFile(resolve(dirname(resolve(bundleArg)),raw.artifact.path));
if(artifact.length!==raw.artifact.size)throw new Error("artifact size mismatch");
const digest=`sha256:${createHash("sha256").update(artifact).digest("hex")}`;
if(digest!==raw.artifact.sha256)throw new Error("artifact digest mismatch");
inspectTarGz(artifact,raw.manifest);

const artifactUrl=new URL(artifactUrlInput),allowedOrigin=new URL(process.env.FAIVR_PACKAGE_ORIGIN.trim());
if(artifactUrl.protocol!=="https:"||allowedOrigin.protocol!=="https:"||artifactUrl.origin!==allowedOrigin.origin)throw new Error("artifact URL must use the configured FAIVR package origin");
const {url:_ignoredUrl,...signedArtifact}=unsignedEnvelope.artifact;
const signedEnvelope={...unsignedEnvelope,artifact:signedArtifact};

const client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();
try{
  await client.query("BEGIN");
  const publisher=await client.query("SELECT public_key FROM company_os_publishers WHERE key_id=$1 AND status='active'",[signature.keyId]);
  if(!publisher.rowCount)throw new Error("publisher key is not enrolled");
  if(!verify(null,Buffer.from(canonical(signedEnvelope)),createPublicKey(publisher.rows[0].public_key),Buffer.from(signature.value,"base64url")))throw new Error("invalid publisher signature");
  await client.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,summary=EXCLUDED.summary",[raw.model.id,raw.model.slug,raw.model.name,raw.model.summary]);
  const imported=await client.query("INSERT INTO company_os_package_versions(package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,'published',$3,$4,$5,$6,$7,$8,$9,$10,now()) ON CONFLICT(package_id,version) DO UPDATE SET package_id=EXCLUDED.package_id WHERE company_os_package_versions.artifact_sha256=EXCLUDED.artifact_sha256 AND company_os_package_versions.publisher_signature=EXCLUDED.publisher_signature RETURNING id",[raw.model.id,raw.version.version,JSON.stringify(raw.manifest),signature.keyId,signature.value,artifactUrl.href,digest,raw.version.monthlyPriceCents,raw.version.stripePriceId??null,raw.version.minCompanyOsVersion]);
  if(!imported.rowCount)throw new Error("published version conflicts with different signed material");
  await client.query("COMMIT");console.log(JSON.stringify({imported:true,modelId:raw.model.id,version:raw.version.version,digest,artifactUrl:artifactUrl.href}));
}catch(e){await client.query("ROLLBACK");throw e;}finally{await client.end();}
