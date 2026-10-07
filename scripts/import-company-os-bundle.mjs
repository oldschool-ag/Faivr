#!/usr/bin/env node
// Import one signed Truchsess export into the private store (T6a export gate output -> T6b catalog entry).
//
//   node scripts/import-company-os-bundle.mjs <manifest.json> <artifact.tar.gz>
//   node scripts/import-company-os-bundle.mjs <package>.truchsess-bundle.tar          (the pack-bundle file: manifest + payload)
//
// Environment:
//   DATABASE_URL                      the store database (omit with FAIVR_VALIDATE_ONLY=1)
//   FAIVR_PACKAGE_ORIGIN              the HTTPS origin the artifact URL must use
//   FAIVR_ARTIFACT_URL                where the artifact is hosted; optional with FAIVR_STORE_ARTIFACT_INLINE=1
//   FAIVR_STORE_ARTIFACT_INLINE=1     store the signed payload bytes in the database (the private store serves them itself)
//   FAIVR_STORE_BUNDLE=<bundle id>    attach the package to this function bundle (created with company-os-store-admin.mjs)
//   FAIVR_VALIDATE_ONLY=1 FAIVR_PUBLISHER_PUBLIC_KEY_PATH=<pem>   offline proof without a database
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import pg from "../web/node_modules/pg/lib/index.js";

const [firstArg,secondArg]=process.argv.slice(2);
const validateOnly=process.env.FAIVR_VALIDATE_ONLY==="1";
const inlineArtifact=process.env.FAIVR_STORE_ARTIFACT_INLINE==="1";
const bundleId=process.env.FAIVR_STORE_BUNDLE?.trim()||null;
const artifactUrlInput=process.env.FAIVR_ARTIFACT_URL?.trim();
const packageOriginInput=process.env.FAIVR_PACKAGE_ORIGIN?.trim();
const bundleFileInput=firstArg&&firstArg.endsWith(".truchsess-bundle.tar")&&!secondArg?firstArg:null;
if(!firstArg||(!bundleFileInput&&!secondArg)||!packageOriginInput||(!artifactUrlInput&&!inlineArtifact)||(!validateOnly&&!process.env.DATABASE_URL)|| (validateOnly&&!process.env.FAIVR_PUBLISHER_PUBLIC_KEY_PATH)){
  console.error("Usage: [DATABASE_URL=... | FAIVR_VALIDATE_ONLY=1 FAIVR_PUBLISHER_PUBLIC_KEY_PATH=...] FAIVR_PACKAGE_ORIGIN=https://... [FAIVR_ARTIFACT_URL=https://... | FAIVR_STORE_ARTIFACT_INLINE=1] [FAIVR_STORE_BUNDLE=<bundle id>] node scripts/import-company-os-bundle.mjs (manifest.json artifact.tar.gz | package.truchsess-bundle.tar)");
  process.exit(2);
}

const canonical=(v)=>v===null?"null":typeof v==="string"?JSON.stringify(v):typeof v==="boolean"?(v?"true":"false"):typeof v==="number"?JSON.stringify(v):Array.isArray(v)?`[${v.map(canonical).join(",")}]`:`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
const sha256=(value)=>`sha256:${createHash("sha256").update(value).digest("hex")}`;
const semver=/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const modelIdPattern=/^faivr\.agent\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const digestPattern=/^sha256:[a-f0-9]{64}$/;
const contentDigestPattern=/^[a-f0-9]{64}$/;
const base64url=/^[A-Za-z0-9_-]+$/;
const bundleIdPattern=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slotIdPattern=/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const secretPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/(?:sk_live_|rk_live_|AKIA)[A-Za-z0-9_\-]{12,}/,/\b(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"']{8,}/i];
const exactKeys=(value,keys,label)=>{if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).sort().join("\n")!==[...keys].sort().join("\n"))throw new Error(`invalid ${label} fields`);};
// T6b: permission strings are carried verbatim, in the order the signed manifest declares them.
// The appliance owns the closed vocabulary and re-validates them at install; the store only
// wants unique, non-empty strings.
const uniqueStrings=(value,label)=>{if(!Array.isArray(value)||value.some(v=>typeof v!=="string"||!v||v.length>256||/\s/.test(v))||new Set(value).size!==value.length)throw new Error(`${label} must be unique non-empty strings`);};
const validateSlots=(slots,permissions)=>{
  if(slots===undefined)slots=[];
  if(!Array.isArray(slots))throw new Error("slots must be an array");
  const ids=new Set();
  for(const slot of slots){
    exactKeys(slot,["id","question","kind","required"],"slot");
    if(typeof slot.id!=="string"||!slotIdPattern.test(slot.id)||typeof slot.question!=="string"||slot.question.length<1||slot.question.length>200||!(["repository","product","website"].includes(slot.kind))||typeof slot.required!=="boolean")throw new Error("invalid slot");
    if(ids.has(slot.id))throw new Error("slot ids must be unique");
    ids.add(slot.id);
  }
  for(const permission of permissions){
    const placeholder=permission.match(/:\{([^{}]+)\}$/)?.[1];
    if(placeholder&&!ids.has(placeholder))throw new Error(`permission references unknown slot ${placeholder}`);
  }
  return slots;
};
const cleanPath=(value)=>typeof value==="string"&&value.length>0&&!value.includes("\\")&&!value.startsWith("/")&&!value.split("/").includes("..")&&!value.includes("//");
const octal=(field)=>{const value=field.toString("ascii").replace(/\0.*$/s,"").trim();if(!/^[0-7]*$/.test(value))throw new Error("invalid tar numeric field");return value?Number.parseInt(value,8):0;};

function tarEntries(tar){
  const entries=[];let offset=0;
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);offset+=512;
    if(header.every(byte=>byte===0))break;
    const name=header.subarray(0,100).toString("utf8").replace(/\0.*$/s,"");
    const prefix=header.subarray(345,500).toString("utf8").replace(/\0.*$/s,"");
    const path=prefix?`${prefix}/${name}`:name;
    const size=octal(header.subarray(124,136)),type=String.fromCharCode(header[156]||48),storedChecksum=octal(header.subarray(148,156));
    const checksumHeader=Buffer.from(header);checksumHeader.fill(32,148,156);
    if(storedChecksum!==checksumHeader.reduce((sum,byte)=>sum+byte,0))throw new Error(`invalid tar checksum at ${path}`);
    if(offset+size>tar.length)throw new Error(`truncated archive entry: ${path}`);
    const body=tar.subarray(offset,offset+size);offset+=Math.ceil(size/512)*512;
    // PAX extended headers (type x/g) carry no payload of ours; skip them like the appliance's reader does
    if(type==="x"||type==="g")continue;
    entries.push({path,size,type,body});
  }
  return entries;
}

function inspectTarGz(compressed){
  const maxCompressed=Number(process.env.FAIVR_MAX_PACKAGE_BYTES??50*1024*1024);
  if(!Number.isSafeInteger(maxCompressed)||maxCompressed<=0||compressed.length>maxCompressed)throw new Error("portable bundle exceeds compressed size limit");
  const tar=gunzipSync(compressed,{maxOutputLength:maxCompressed*4});
  const seen=new Set(),files=new Map();let totalPayload=0;
  for(const {path,size,type,body} of tarEntries(tar)){
    if(!cleanPath(path)||seen.has(path))throw new Error(`unsafe or duplicate archive path: ${path}`);
    if(type!=="0"&&type!=="5")throw new Error(`unsupported archive entry type at ${path}`);
    if(type==="5"&&size!==0)throw new Error(`directory has payload bytes: ${path}`);
    const rootFile=path==="AGENT.md"||path==="agent-definition.json";
    const nested=/^(?:skills|tools|workflows|docs|assets)\/[A-Za-z0-9._/-]+$/.test(path);
    const directory=/^(?:skills|tools|workflows|docs|assets)(?:\/[A-Za-z0-9._/-]+)?\/?$/.test(path);
    if((type==="0"&&!rootFile&&!nested)||(type==="5"&&!directory))throw new Error(`archive path outside portable layout: ${path}`);
    seen.add(path);
    if(type==="0"){
      totalPayload+=size;if(totalPayload>maxCompressed*4)throw new Error("portable bundle exceeds expanded size limit");
      if(secretPatterns.some(pattern=>pattern.test(body.toString("utf8"))))throw new Error(`potential secret detected in ${path}`);
      files.set(path,{path,sha256:sha256(body).slice("sha256:".length),bytes:size});
    }
  }
  if(!files.has("AGENT.md")||!files.has("agent-definition.json"))throw new Error("required root payload files are missing");
  return files;
}

/** The appliance's pack-bundle file: exactly bundle-index.json, manifest.json and package.tar.gz. */
function readBundleFile(bytes){
  const maxMember=64*1024*1024;
  const members=new Map();
  for(const {path,type,body,size} of tarEntries(bytes)){
    if(type!=="0")throw new Error(`bundle file member ${path} is not a regular file`);
    if(!["bundle-index.json","manifest.json","package.tar.gz"].includes(path))throw new Error(`bundle file has a foreign member: ${path}`);
    if(members.has(path))throw new Error(`bundle file repeats ${path}`);
    if(size>maxMember)throw new Error(`bundle file member ${path} exceeds ${maxMember} bytes`);
    members.set(path,Buffer.from(body));
  }
  for(const name of ["bundle-index.json","manifest.json","package.tar.gz"])if(!members.has(name))throw new Error(`bundle file lacks ${name}`);
  const index=JSON.parse(members.get("bundle-index.json").toString("utf8"));
  if(index.schemaVersion!=="truchsess-signed-bundle-file.v1")throw new Error("bundle index schemaVersion is not truchsess-signed-bundle-file.v1");
  const manifestBytes=members.get("manifest.json"),artifact=members.get("package.tar.gz");
  if(sha256(manifestBytes).slice("sha256:".length)!==index.manifestSha256)throw new Error("bundle index manifestSha256 does not match manifest.json");
  if(sha256(artifact)!==index.packageDigest)throw new Error("bundle index packageDigest does not match package.tar.gz");
  const manifest=JSON.parse(manifestBytes.toString("utf8"));
  if(manifest.modelId!==index.modelId||manifest.version!==index.version||manifest.packageDigest!==index.packageDigest)throw new Error("bundle index and manifest disagree on the package identity");
  return {manifest,artifact};
}

function validateManifest(raw,artifact,files){
  const manifestKeys=["schemaVersion","modelId","version","displayName","summary","publisher","packageDigest","artifactBytes","entrypoint","companyOsCompatibility","permissions","dependencies","managedPaths","tenantDataIncluded","monthlyPrice","contents","signature"];
  exactKeys(raw,raw.slots===undefined?manifestKeys:[...manifestKeys,"slots"],"manifest");
  exactKeys(raw.publisher,["publisherId","name"],"publisher");
  exactKeys(raw.companyOsCompatibility,["minVersion","maxVersion"],"companyOsCompatibility");
  exactKeys(raw.monthlyPrice,["billingPeriod","amountCents","stripePriceId","activationState"],"monthlyPrice");
  exactKeys(raw.signature,["keyId","algorithm","value"],"signature");
  if(raw.schemaVersion!=="faivr-portable-agent-bundle.v1"||!modelIdPattern.test(raw.modelId)||!semver.test(raw.version)||typeof raw.displayName!=="string"||!raw.displayName||typeof raw.summary!=="string"||!raw.summary)throw new Error("invalid portable manifest identity");
  if(typeof raw.publisher.publisherId!=="string"||!raw.publisher.publisherId||typeof raw.publisher.name!=="string"||!raw.publisher.name)throw new Error("invalid publisher");
  if(!digestPattern.test(raw.packageDigest)||raw.packageDigest!==sha256(artifact)||!Number.isSafeInteger(raw.artifactBytes)||raw.artifactBytes!==artifact.length)throw new Error("artifact size or digest mismatch");
  if(raw.entrypoint!=="agent-definition.json"||!semver.test(raw.companyOsCompatibility.minVersion)||(raw.companyOsCompatibility.maxVersion!==null&&!semver.test(raw.companyOsCompatibility.maxVersion)))throw new Error("invalid entrypoint or compatibility range");
  uniqueStrings(raw.permissions,"permissions");uniqueStrings(raw.dependencies,"dependencies");validateSlots(raw.slots,raw.permissions);
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

let raw,artifact;
if(bundleFileInput){({manifest:raw,artifact}=readBundleFile(await readFile(bundleFileInput)));}
else{raw=JSON.parse(await readFile(firstArg,"utf8"));artifact=await readFile(secondArg);}
const files=inspectTarGz(artifact);validateManifest(raw,artifact,files);
if(bundleId!==null&&!bundleIdPattern.test(bundleId))throw new Error("FAIVR_STORE_BUNDLE must be a lower-case bundle id");
const allowedOrigin=new URL(packageOriginInput);
if(allowedOrigin.protocol!=="https:")throw new Error("FAIVR_PACKAGE_ORIGIN must be an HTTPS origin");
// With the payload stored inline the URL is the stable name the store serves the bytes under.
const artifactUrl=artifactUrlInput?new URL(artifactUrlInput):new URL(`${allowedOrigin.origin}/company-os/v1/packages/${raw.modelId}/${raw.version}/${raw.packageDigest.slice("sha256:".length)}.tar.gz`);
if(artifactUrl.protocol!=="https:"||artifactUrl.origin!==allowedOrigin.origin)throw new Error("artifact URL must use the configured FAIVR package origin");
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
  if(validateOnly){console.log(JSON.stringify({valid:true,modelId:raw.modelId,version:raw.version,digest:raw.packageDigest,artifactBytes:raw.artifactBytes,artifactUrl:artifactUrl.href,permissions:raw.permissions,slots:raw.slots??[],bundle:bundleId,inlineArtifact}));}
  else{
    const slug=raw.modelId.slice("faivr.agent.".length).replace(/[._]+/g,"-");
    await client.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES($1,$2,$3,$4,'active') ON CONFLICT(id) DO UPDATE SET slug=EXCLUDED.slug,name=EXCLUDED.name,summary=EXCLUDED.summary",[raw.modelId,slug,raw.displayName,raw.summary]);
    const imported=await client.query("INSERT INTO company_os_package_versions(package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_url,artifact_sha256,monthly_price_cents,stripe_price_id,min_company_os_version,published_at) VALUES($1,$2,'published',$3,$4,$5,$6,$7,$8,$9,$10,now()) ON CONFLICT(package_id,version) DO UPDATE SET package_id=EXCLUDED.package_id WHERE company_os_package_versions.artifact_sha256=EXCLUDED.artifact_sha256 AND company_os_package_versions.publisher_signature=EXCLUDED.publisher_signature RETURNING id",[raw.modelId,raw.version,JSON.stringify(raw),signature.keyId,signature.value,artifactUrl.href,raw.packageDigest,raw.monthlyPrice.amountCents,raw.monthlyPrice.stripePriceId,raw.companyOsCompatibility.minVersion]);
    if(!imported.rowCount)throw new Error("published version conflicts with different signed material");
    const versionId=imported.rows[0].id;
    if(inlineArtifact){
      // the store serves these exact bytes on GET /installations/{id}/package; the appliance re-hashes them
      await client.query("INSERT INTO company_os_package_artifacts(version_id,artifact,artifact_bytes,artifact_sha256) VALUES($1,$2,$3,$4) ON CONFLICT(version_id) DO UPDATE SET artifact=EXCLUDED.artifact,artifact_bytes=EXCLUDED.artifact_bytes,artifact_sha256=EXCLUDED.artifact_sha256,uploaded_at=now() WHERE company_os_package_artifacts.artifact_sha256=EXCLUDED.artifact_sha256",[versionId,artifact,artifact.length,raw.packageDigest]);
    }
    if(bundleId){
      const bundle=await client.query("SELECT id FROM company_os_function_bundles WHERE id=$1",[bundleId]);
      if(!bundle.rowCount)throw new Error(`function bundle ${bundleId} does not exist; create it with scripts/company-os-store-admin.mjs create-bundle first`);
      await client.query("INSERT INTO company_os_bundle_packages(bundle_id,package_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[bundleId,raw.modelId]);
    }
    await client.query("COMMIT");console.log(JSON.stringify({imported:true,modelId:raw.modelId,version:raw.version,versionId,digest:raw.packageDigest,artifactBytes:raw.artifactBytes,artifactUrl:artifactUrl.href,inlineArtifact,bundle:bundleId,permissions:raw.permissions,slots:raw.slots??[]}));
  }
}catch(e){if(client)await client.query("ROLLBACK");throw e;}finally{if(client)await client.end();}
