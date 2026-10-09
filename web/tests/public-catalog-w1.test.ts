import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { createStoreDb } from "./helpers/companyOsStoreDb";
import { loadPublicCatalog, queryPublicCatalog } from "@/lib/publicCatalogData";
import { removePackageFromBundle, renamePublicPublisher, setBundlePublic } from "@/lib/publicCatalogAdmin";
import { describePermission } from "@/lib/publicPermissions";

describe("W1 public catalog boundary", () => {
  let pool: ReturnType<typeof createStoreDb>["pool"];
  const digest = `sha256:${"a".repeat(64)}`;
  beforeEach(async () => {
    pool=createStoreDb().pool;
    await pool.query(readFileSync(new URL("../sql/migrations/20261006_public_catalog.sql",import.meta.url),"utf8"));
    await pool.query("INSERT INTO company_os_publishers(key_id,public_key,status,name) VALUES('key-test','fixture','active','Old School GmbH')");
    await pool.query("INSERT INTO company_os_function_bundles(id,name,description,monthly_price_cents,currency,status) VALUES('fixture-function','Fixture function','Test only',1234,'chf','active')");
    await pool.query("INSERT INTO company_os_packages(id,slug,name,summary,status) VALUES('faivr.agent.fixture','fixture','Fixture worker','Test role','active')");
    await pool.query("INSERT INTO company_os_bundle_packages(bundle_id,package_id) VALUES('fixture-function','faivr.agent.fixture')");
    const versionId=randomUUID();
    await pool.query("INSERT INTO company_os_package_versions(id,package_id,version,status,manifest,publisher_key_id,publisher_signature,artifact_sha256,published_at) VALUES($1,'faivr.agent.fixture','1.0.0','published',$2,'key-test','published-signature',$3,now())",[versionId,JSON.stringify({permissions:["workspace.read"],privateField:"never expose"}),digest]);
    await pool.query("INSERT INTO company_os_package_artifacts(version_id,artifact,artifact_bytes,artifact_sha256) VALUES($1,$2,1,$3)",[versionId,Buffer.from('x'),digest]);
  });
  it("defaults existing entries to private and requires explicit publication",async()=>{
    expect(await queryPublicCatalog(pool)).toEqual([]);
    await setBundlePublic(pool,"fixture-function",true);
    const data=await queryPublicCatalog(pool);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({slug:"fixture-function",monthlyPriceCents:1234,currency:"chf"});
    expect(Object.keys(data[0]).sort()).toEqual(["currency","description","monthlyPriceCents","name","slug","workers"]);
    expect(Object.keys(data[0].workers[0]).sort()).toEqual(["digest","id","name","permissions","publisherKeyId","publisherName","role","slots","slug","version"]);
    expect(data[0].workers[0].slots).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/privateField|subscription|tenant|polar|artifact_url|signature/i);
  });
  it("hides private bundles and private members",async()=>{
    await setBundlePublic(pool,"fixture-function",true);
    await pool.query("UPDATE company_os_packages SET public_listing=false");
    expect(await queryPublicCatalog(pool)).toEqual([]);
    await pool.query("UPDATE company_os_packages SET public_listing=true");
    await setBundlePublic(pool,"fixture-function",false);
    expect(await queryPublicCatalog(pool)).toEqual([]);
  });
  it("refuses publication before a signed published package/artifact exists",async()=>{
    await pool.query("UPDATE company_os_package_versions SET status='draft'");
    await expect(setBundlePublic(pool,"fixture-function",true)).rejects.toThrow("published signed version");
    expect(await queryPublicCatalog(pool)).toEqual([]);
  });
  it("removes a package without deleting it and refuses to empty a public bundle",async()=>{
    await setBundlePublic(pool,"fixture-function",true);
    await pool.query("INSERT INTO company_os_packages(id,slug,name,summary,status,public_listing) VALUES('faivr.agent.second','second','Second','Second role','active',true)");
    await pool.query("INSERT INTO company_os_bundle_packages(bundle_id,package_id) VALUES('fixture-function','faivr.agent.second')");
    await expect(removePackageFromBundle(pool,"fixture-function","faivr.agent.fixture")).resolves.toMatchObject({removed:true});
    expect((await pool.query("SELECT 1 FROM company_os_bundle_packages WHERE bundle_id='fixture-function' AND package_id='faivr.agent.fixture' ")).rowCount).toBe(0);
    expect((await pool.query("SELECT public_listing FROM company_os_packages WHERE id='faivr.agent.fixture' ")).rows[0].public_listing).toBe(false);
    expect((await pool.query("SELECT 1 FROM company_os_packages WHERE id='faivr.agent.fixture' ")).rowCount).toBe(1);
    await expect(removePackageFromBundle(pool,"fixture-function","faivr.agent.second")).rejects.toThrow("Cannot empty a public bundle");
  });
  it("excludes withdrawn packages and inactive publishers even after a bundle was public",async()=>{
    await setBundlePublic(pool,"fixture-function",true);
    await pool.query("UPDATE company_os_publishers SET status='revoked'");
    expect(await queryPublicCatalog(pool)).toEqual([]);
    await pool.query("UPDATE company_os_publishers SET status='active'");
    await pool.query("UPDATE company_os_package_versions SET status='withdrawn'");
    expect(await queryPublicCatalog(pool)).toEqual([]);
  });
  it("renames only the selected publisher through the admin operation",async()=>{
    await pool.query("UPDATE company_os_publishers SET name='Old School AG'");
    await renamePublicPublisher(pool,"key-test","Old School GmbH");
    await setBundlePublic(pool,"fixture-function",true);
    expect((await queryPublicCatalog(pool))[0].workers[0].publisherName).toBe("Old School GmbH");
    await expect(renamePublicPublisher(pool,"missing","anything")).rejects.toThrow("not found");
  });
  it("provides an explicit unavailable state without leaking database errors",async()=>{
    expect(await loadPublicCatalog(()=>{throw new Error("private connection detail");})).toEqual({functions:[],unavailable:true});
  });
});

describe("W1 permission explanations",()=>{
  it.each([
    ["workspace.read","Read its own workspace"],["workspace.write","Write files in its own workspace"],
    ["exec.sandbox","Run commands in its own sandbox"],["net.allowlist","Reach the internet only through your allowlist"],
    ["net.domain:example.test","Reach example.test"],["net.domain:{website}","Reach one website you choose"],
    ["browser.use","Open web pages and take screenshots in its sandbox"],["repo.read:{repository}","Read one repository you choose"],
    ["repo.write:{repository}","Push branches and open pull requests in one repository you choose (never merges)"],
    ["knowledge.read:{product}","Read the knowledge of one product you choose"],["knowledge.write:{product}","Update the knowledge of one product you choose"],
    ["workboard.read","Read the workboard"],["workboard.write","Change the workboard"],["delegate:Fixture","Hand work to Fixture"],
    ["model.lane:standard","Use your standard model"],["model.lane:frontier","Use your strongest model"],
  ])("renders %s",(permission,words)=>expect(describePermission(permission)).toBe(words));
  it("marks optional slots and preserves unknown vocabulary",()=>{
    expect(describePermission("net.domain:{website}",true)).toBe("Reach one website you choose (optional)");
    expect(describePermission("future.access")).toBe("future.access (not yet described)");
  });
  it("renders an install question instead of a raw slot placeholder",()=>{
    const rendered=describePermission("repo.read:{code-repository}",true,"Which repository holds the product's code and documents?");
    expect(rendered).toBe("Read one repository you choose at install: Which repository holds the product's code and documents? (optional)");
    expect(rendered).not.toContain("{code-repository}");
  });
});
