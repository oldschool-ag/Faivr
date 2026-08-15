#!/usr/bin/env node
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import pg from "../web/node_modules/pg/lib/index.js";

const [manifestArg,artifactArg]=process.argv.slice(2);
const validateOnly=process.env.FAIVR_VALIDATE_ONLY==="1";
const artifactUrlInput=process.env.FAIVR_ARTIFACT_URL?.trim();
const packageOriginInput=process.env.FAIVR_PACKAGE_ORIGIN?.trim();
if(!manifestArg||!artifactArg||!artifactUrlInput||!packageOriginInput||(!validateOnly&&!process.env.DATABASE_URL)|| (validateOnly&&!process.env.FAIVR_PUBLISHER_PUBLIC_KEY_PATH)){
  console.error("Usage: [DATABASE_URL=... | FAIVR_VALIDATE_ONLY=1 FAIVR_PUBLISHER_PUBLIC_KEY_PATH=...] FAIVR_PACKAGE_ORIGIN=https://... FAIVR_ARTIFACT_URL=https://... node scripts/import-company-os-bundle.mjs manifest.json artifact.tar.gz");
  process.exit(2);
}

const canonical=(v)=>v===null?"null":typeof v==="string"?JSON.stringify(v):typeof v==="boolean"?(v?"true":"false"):typeof v==="number"?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(",")}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
const sha256=(value)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const semver=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const modelIdPattern=/^faivr\.agent\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const digestPattern=/^sha256:[a-f0-9]{64}$/;
const contentDigestPattern=/^[a-f0-9]{64}$/;
const base64url=/^[A-Za-z0-9_-]+$/;
const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/(?:sk_live_|rk_live_|AKIA)[A-Za-z0-9_\-]{12,}/,/\b(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}/i];
const exactKeys=(value,keys,label)=>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join("\n")!==[...keys].sort().join("\n"))throw new Error(`invalid ${label} fields`);};
const sortedUniqueStrings=(value,label)=>{if(!Array.isArray(value)||value.some(v=>typeof v!=="string"||!v)||new Set(value).size!==value.length||value.join("\n")!==[...value].sort().join("\n"))throw new Error(`${label} must be stable-sorted unique strings`);};
const cleanPath=(value)=>typeof value==="string"&&value.length>0&&!value.includes("\\")&&!value.startsWith("/")&&!value.split("/").includes("..")&&!value.includes("//");
const octal=(field)=>{const value=field.toString("ascii").replace(/\0.*$/s,"").trim();if(!/^[0-7]*$/.test(value))throw new Error("invalid tar numeric field");return value?Number.parseInt(value,8):0;};

function inspectTarGz(compressed){
  const maxCompressed=Number(process.env.FAIVR_MAX_PACKAGE_BYTES??50*1024*1024);
  if(!Number.isSafeInteger(maxCompressed)||maxCompressed<=0||compressed.length>maxCompressed)throw new Error("portable bundle exceeds compressed size limit");
  const tar=gunzipSync(compressed,{maxOutputLength:maxCompressed*4});
  const seen=new Set(),files=new Map();let offset=0,totalPayload=0;
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);offset+=512;
    if(header.every(byte=>byte===0))break;
    const name=header.subarray(0,100).toString("utf8").replace(/\0.*$/s,"");
    const prefix=header.subarray(345,500).toString("utf8").replace(/\0.*$/s,"");
    const path=prefix?`${prefix}/${name}`:name;
    const size=octal(header.subarray(124,136)),type=String.fromCharCode(header[156]||48),storedChecksum=octal(header.subarray(148,156));
    const checksumHeader=Buffer.from(header);checksumHeader.fill(32,148,156);
    if(storedChecksum!==checksumHeader.reduce((sum,byte)=>sum+byte,0))throw new Error(`invalid tar checksum at ${path}`);
    if(!cleanPath(path)||seen.has(path))throw new Error(`unsafe or duplicate archive path: ${path}`);
    if(type!=="0"&&type!=="5")throw new Error(`unsupported archive entry type at ${path}`);
    if(type==="5"&&size!==0)throw new Error(`directory has payload bytes: ${path}`);
    const rootFile=path==="AGENT.md"||path==="agent-definition.json";
    const nested=/^(?:skills|tools|workflows|docs|assets)\/[A-Za-z0-9._/-]+$/.test(path);
    const directory=/^(?:skills|tools|workflows|docs|assets)(?:\/[A-Za-z0-9._/-]+)?\/?$/.test(path);
    if((type==="0"&&!rootFile&&!nested)||(type==="5"&&!directory))throw new Error(`archive path outside portable layout: ${path}`);
    if(offset+size>tar.length)throw new Error(`truncated archive entry: ${path}`);
    const body=tar.subarray(offset,offset+size);offset+=Math.ceil(size/512)*512;seen.add(path);
    if(type==="0"){
      totalPayload+=size;if(totalPayload>maxCompressed*4)throw new Error("portable bundle exceeds expanded size limit");
      if(secretPatterns.some(pattern=>pattern.test(body.toString("utf8"))))throw new Error(`potential secret detected in ${path}`);
      files.set(path,{path,sha256:sha256(body).slice("sha256:".length),bytes:size});
    }
  }
  if(!files.has("AGENT.md")||!files.has("agent-definition.json"))throw new Error("required root payload files are missing");
  return files;
}

function validateManifest(raw,artifact,files){
  exactKeys(raw,["schemaVersion","modelId","version","displayName","summary","publisher","packageDigest","artifactBytes","entrypoint","companyOsCompatibility","permissions","dependencies","managedPaths","tenantDataIncluded","monthlyPrice","contents","signature"],"manifest");
  exactKeys(raw.publisher,["publisherId","name"],"publisher");
  exactKeys(raw.companyOsCompatibility,["minVersion","maxVersion"],"companyOsCompatibility");
  exactKeys(raw.monthlyPrice,["billingPeriod","amountCents","stripePriceId","activationState"],"monthlyPrice");
  exactKeys(raw.signature,["keyId","algorithm","value"],"signature");
  if(raw.schemaVersion!=="faivr-portable-agent-bundle.v1"||!modelIdPattern.test(raw.modelId)||!semver.test(raw.version)||typeof raw.displayName!=="string"||!raw.displayName||typeof raw.summary!=="string"||!raw.summary)throw new Error("invalid portable manifest identity");
  if(typeof raw.publisher.publisherId!=="string"||!raw.publisher.publisherId||typeof raw.publisher.name!=="string"||!raw.publisher.name)throw new Error("invalid publisher");
  if(!digestPattern.test(raw.packageDigest)||raw.packageDigest!==sha256(artifact)||!Number.isSafeInteger(raw.artifactBytes)||raw.artifactBytes!==artifact.length)throw new Error("artifact size or digest mismatch");
  if(raw.entrypoint!=="agent-definition.json"||!semver.test(raw.companyOsCompatibility.minVersion)||(raw.companyOsCompatibility.maxVersion!==null&&!semver.test(raw.companyOsCompatibility.maxVersion)))throw new Error("invalid entrypoint or compatibility range");
  sortedUniqueStrings(raw.permissions,"permissions");sortedUniqueStrings(raw.dependencies,"dependencies");
  const managedRoot=`agents/${raw.modelId}/${raw.version}`;
  if(!Array.isArray(raw.managedPaths)||raw.managedPaths.length!==1||raw.managedPaths[0]!==managedRoot)throw new Error("invalid managedPaths root");
  if(raw.tenantDataIncluded!==false)throw new Error("tenant data must not be included");
  const price=raw.monthlyPrice;
  if(price.billingPeriod!=="month"||!Number.isSafeInteger(price.amountCents)||price.amountCents<=0||!(["price_required","configured"].includes(price.activationState))||(price.activationState==="price_required"&&price.stripePriceId!==null)||(price.activationState==="configured"&&(typeof price.stripePriceId!=="string"||!price.stripePriceId.startsWith("price_"))))throw new Error("invalid monthly price state");
  if(!Array.isArray(raw.contents)||raw.contents.length!==files.size)throw new Error("contents must exhaustively enumerate regular files");
  const paths=[];
  for(const entry of raw.contents){exactKeys(entry,["path","sha256","bytes"],"contents entry");if(!cleanPath(entry.path)||!contentDigestPattern.test(entry.sha256)||!Number.isSafeInteger(entry.bytes)||entry.bytes<0)throw new Error("invalid contents entry");const actual=files.get(entry.path);if(!actual||actual.sha256!==entry.sha256||actual.bytes!==entry.bytes)throw new Error(`contents mismatch at ${entry.path}`);paths.push(entry.path);}
  if(new Set(paths).size!==paths.length||paths.join("\n")!==[...paths].sort().join("\n")||!paths.includes(raw.entrypoint))throw new Error("contents paths must be stable, unique, and bind entrypoint");
  if(raw.signature.algorithm!=="Ed25519"||typeof raw.signature.keyId!=="string"||!raw.signature.keyId||typeof raw.signature.value!=="string"||!base64url.test(raw.signature.value))throw new Error("invalid signature envelope");
}

const raw=JSON.parse(await readFile(manifestArg,"utf8"));
const artifact=await readFile(artifactArg);
const files=inspectTarGz(artifact);validateManifest(raw,artifact,files);
const artifactUrl=new URL(artifactUrlInput),allowedOrigin=new URL(packageOriginInput);
if(artifactUrl.protocol!=="https:"||allowedOrigin.protocol!=="https:"||artifactUrl.origin!==allowedOrigin.origin)throw new Error("artifact URL must use the configured FAIVR package origin");
const {signature,...signedManifest}=raw;

let client=null,publicKey;
try{
  if(validateOnly)publicKey=await readFile(process.env.FAIVR_PUBLISHER_PUBLIC_KEY_PATH,"utf8");
  else{
    client=new pg.Client({connectionString:process.env.DATABASE_URL});await client.connect();await client.query("BEGIN");
    const publisher=await client.query("SELECT public_key FROM company_os_publishers WHERE key_id=$1 AND status='active'",[signature.keyId]);
    if(!publisher.rowCount)throw new Error("publisher key is not enrolled");publicKey=publisher.rows[0].public_key;
  }
  if(!verify(null,Buffer.from(canonical(signedManifest)),createPublicKey(publicKey),Buffer.from(signature.value,"base64url")))throw new Error("invalid publisher signature");
  if(validateOnly){console.log(JSON.stringify({valid:true,modelId:raw.modelId,version:raw.version,digest:raw.packageDigest,artifactBytes:raw.artifactBytes,artifactUrl:artifactUrl.href}));}
  else{
    const slug=raw.modelId.slice("faivr.agent.".length).replace(/[._]+/g,"-");
    await client.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,summary=EXCLUDED.summary",[raw.modelId,slug,raw.displayName,raw.summary]);
    const imported=await client.query("INSERT INTO company_os_package_versions(package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,'published',$3,$4,$5,$6,$7,$8,$9,$10,now()) ON CONFLICT(package_id,version) DO UPDATE SET package_id=EXCLUDED.package_id WHERE company_os_package_versions.artifact_sha256=EXCLUDED.artifact_sha256 AND company_os_package_versions.publisher_signature=EXCLUDED.publisher_signature RETURNING id",[raw.modelId,raw.version,JSON.stringify(raw),signature.keyId,signature.value,artifactUrl.href,raw.packageDigest,raw.monthlyPrice.amountCents,raw.monthlyPrice.stripePriceId,raw.companyOsCompatibility.minVersion]);
    if(!imported.rowCount)throw new Error("published version conflicts with different signed material");
    await client.query("COMMIT");console.log(JSON.stringify({imported:true,modelId:raw.modelId,version:raw.version,digest:raw.packageDigest,artifactBytes:raw.artifactBytes,artifactUrl:artifactUrl.href}));
  }
}catch(e){if(client)await client.query("ROLLBACK");throw e;}finally{if(client)await client.end();}
