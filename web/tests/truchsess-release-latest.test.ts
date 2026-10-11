import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as unknown as import("pg").Pool }));
vi.mock("@/lib/postgres", () => ({ getPgPool: () => holder.pool }));

import { GET as latestRelease } from "@/app/api/company-os/v1/releases/latest/route";
import { enrol, } from "@/app/api/company-os/v1/storeHandlers";
import { createStoreDb, ed25519Pair, signedRequest, type Appliance } from "./helpers/companyOsStoreDb";
import { issueEnrolmentCode } from "@/lib/companyOs/privateStore";
import { resetTruchsessReleaseCacheForTests, signedUrlExpiry } from "@/lib/companyOs/truchsessReleases";

const tag = "truchsess-iso-2026.10.11";
const assetApi = "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/42";
const checksumApi = "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/43";
function signedUrl(path: string, seconds = 300) {
  const jwt = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds })).toString("base64url")}.x`;
  return `https://objects.github.test/${path}?jwt=${jwt}&se=${encodeURIComponent(new Date(Date.now() + seconds * 1000).toISOString())}`;
}

function githubRelease(options: { noChecksumFiles?: boolean; closureDigest?: string | null } = {}) {
  return { tag_name: tag, target_commitish: "main", published_at: "2026-10-11T10:00:00Z", body: "Release notes", draft: false, prerelease: true, assets: [
    { id: 1, name: "truchsess.iso", size: 99, url: "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/1" },
    { id: 42, name: "truchsess-closure.nar", size: 12, url: assetApi, digest: options.closureDigest === undefined ? `sha256:${"a".repeat(64)}` : options.closureDigest },
    ...options.noChecksumFiles ? [] : [{ id: 43, name: "truchsess-closure.nar.sha256", size: 80, url: checksumApi }],
    { id: 44, name: "truchsess-closure.nar.sig", size: 8, url: "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/44", digest: `sha256:${"b".repeat(64)}` },
    { id: 45, name: "truchsess-system.release.json", size: 10, url: "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/45", digest: `sha256:${"c".repeat(64)}` },
    { id: 46, name: "truchsess-system.release.json.sig", size: 8, url: "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/46", digest: `sha256:${"d".repeat(64)}` },
  ] };
}

function githubFetch(options: { closureLifetimeSeconds?: number; omitSignatureChecksum?: boolean; varyingUrls?: boolean; noChecksumFiles?: boolean; closureDigest?: string | null; checksumText?: string } = {}) {
  let redirectNumber = 0;
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/releases?per_page=100")) return new Response(JSON.stringify([{ ...githubRelease(options), tag_name: "truchsess-iso-older", published_at: "2026-10-10T13:22:00Z" }, githubRelease(options)]), { status: 200 });
    if (url.endsWith(`/releases/tags/${tag}`)) return new Response(JSON.stringify(githubRelease(options)), { status: 200 });
    if (url.endsWith(`/git/ref/tags/${tag}`)) return new Response(JSON.stringify({ object: { type: "commit", sha: "f".repeat(40) } }), { status: 200 });
    if (url === assetApi) return new Response(null, { status: 302, headers: { location: signedUrl(`closure-${options.varyingUrls ? ++redirectNumber : "current"}`, options.closureLifetimeSeconds ?? 300) } });
    if (url.endsWith("/assets/44")) return new Response(null, { status: 302, headers: { location: signedUrl(`closure.sig-${options.varyingUrls ? ++redirectNumber : "current"}`) } });
    if (url.endsWith("/assets/45") || url.endsWith("/assets/46")) return new Response(null, { status: 302, headers: { location: signedUrl("manifest") } });
    if (url === checksumApi) return new Response(null, { status: 302, headers: { location: signedUrl("checksums") } });
    if (url.startsWith("https://objects.github.test/checksums?")) return new Response(options.checksumText ?? ("a".repeat(64) + "  truchsess-closure.nar\n" + (options.omitSignatureChecksum ? "" : "b".repeat(64) + "  truchsess-closure.nar.sig\n")), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  });
}

async function body(response: Response) { return response.json() as Promise<Record<string, unknown>>; }

describe("latest Truchsess release", () => {
  let appliance: Appliance;
  let enrolmentCode: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const created = createStoreDb();
    holder.pool = created.pool;
    process.env.TRUCHSESS_RELEASES_TOKEN = "test-token";
    const issued = await issueEnrolmentCode({ label: "T66 box", createdBy: "test" });
    enrolmentCode = issued.code;
    appliance = { tenantId: issued.tenantId, instanceId: "", keyId: "", keys: ed25519Pair() };
    fetchMock = githubFetch();
    vi.stubGlobal("fetch", fetchMock);
    resetTruchsessReleaseCacheForTests();
    const response = await enrol(new NextRequest("https://store.faivr.test/api/company-os/v1/enrol", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentCode, appliancePublicKeyPem: appliance.keys.publicPem, label: "T66 box" }) }));
    const enrolled = await body(response);
    appliance.instanceId = enrolled.instanceId as string;
    appliance.keyId = enrolled.keyId as string;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    delete process.env.TRUCHSESS_RELEASES_TOKEN;
    resetTruchsessReleaseCacheForTests();
    await holder.pool.end();
  });

  it("serves newest stable release assets only to an enrolled signed box", async () => {
    const response = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    const payload = await body(response);
    expect(response.status).toBe(200);
    expect(payload.tag).toBe(tag);
    expect(payload.version).toBe("f".repeat(40));
    expect(payload.releaseNotes).toBe("Release notes");
    expect(payload.assets).toEqual(expect.arrayContaining([expect.objectContaining({ name: "truchsess-closure.nar", sha256: `sha256:${"a".repeat(64)}` })]));
    expect(JSON.stringify(payload)).not.toContain("truchsess.iso");
    const expiration = new Date(((payload.assets as Array<{ downloadUrlExpiresAt: string }>)[0]).downloadUrlExpiresAt).getTime();
    expect(expiration - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(expiration - Date.now()).toBeGreaterThan(4 * 60 * 1000);
    const foreign = { ...appliance, instanceId: randomUUID(), keyId: "ed25519-foreign" };
    expect((await latestRelease(signedRequest(foreign, "GET", "/api/company-os/v1/releases/latest?channel=stable"))).status).toBe(401);
  });

  it("serves a pinned stable tag and returns a plain unavailable response without a token", async () => {
    await holder.pool.query("INSERT INTO company_os_release_channels(channel,pinned_tag) VALUES('stable',$1)", [tag]);
    const pinned = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    expect(pinned.status).toBe(200);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/releases/tags/${tag}`))).toBe(true);
    resetTruchsessReleaseCacheForTests();
    delete process.env.TRUCHSESS_RELEASES_TOKEN;
    const missing = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    expect(missing.status).toBe(503);
    expect(await body(missing)).toEqual({ error: "release_service_unavailable" });
  });

  it.each([60, 70])("serves GitHub links lasting %i minutes with their actual expiry", async (minutes) => {
    fetchMock = githubFetch({ closureLifetimeSeconds: minutes * 60 });
    vi.stubGlobal("fetch", fetchMock);
    const response = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    expect(response.status).toBe(200);
    const [asset] = (await body(response)).assets as Array<{ downloadUrl: string; downloadUrlExpiresAt: string }>;
    expect(asset.downloadUrlExpiresAt).toBe(signedUrlExpiry(asset.downloadUrl));
    expect(Date.parse(asset.downloadUrlExpiresAt) - Date.now()).toBeGreaterThan((minutes * 60 - 2) * 1000);
  });

  it("refuses a GitHub link lasting 71 minutes", async () => {
    fetchMock = githubFetch({ closureLifetimeSeconds: 71 * 60 });
    vi.stubGlobal("fetch", fetchMock);
    const response = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ error: "release_unavailable" });
  });

  it.each([true, false])("serves GitHub digests with absent checksum entries (no files: %s)", async (noChecksumFiles) => {
    fetchMock = githubFetch({ omitSignatureChecksum: true, noChecksumFiles });
    vi.stubGlobal("fetch", fetchMock);
    const response = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    expect(response.status).toBe(200);
    const assets = (await body(response)).assets as Array<{ name: string; sha256: string }>;
    expect(assets.map(asset => asset.sha256)).toEqual(["a", "b", "c", "d"].map(char => `sha256:${char.repeat(64)}`));
    expect(assets).toHaveLength(4);
    expect(assets.some(asset => /\.iso$|\.sha256$/.test(asset.name))).toBe(false);
    if (noChecksumFiles) expect(fetchMock.mock.calls.some(([url]) => url === checksumApi)).toBe(false);
  });

  it.each([
    "e".repeat(64) + "  truchsess-closure.nar\n",
    "e".repeat(64) + "  truchsess-closure.nar\n" + "a".repeat(64) + "  truchsess-closure.nar\n",
  ])("refuses any checksum entry that conflicts with the GitHub digest", async (checksumText) => {
    fetchMock = githubFetch({ checksumText });
    vi.stubGlobal("fetch", fetchMock);
    const response = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ error: "release_unavailable" });
  });

  it.each([null, "sha256:bad", `sha512:${"a".repeat(64)}`])("refuses missing or malformed GitHub digests even with matching checksum files (%s)", async (closureDigest) => {
    fetchMock = githubFetch({ closureDigest });
    vi.stubGlobal("fetch", fetchMock);
    const response = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ error: "release_unavailable" });
  });

  it("caches release metadata but requests fresh signed URLs with no-store responses", async () => {
    fetchMock = githubFetch({ varyingUrls: true });
    vi.stubGlobal("fetch", fetchMock);
    const first = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    const second = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    const [firstAsset] = (await body(first)).assets as Array<{ downloadUrl: string }>;
    const [secondAsset] = (await body(second)).assets as Array<{ downloadUrl: string }>;
    expect(first.headers.get("Cache-Control")).toBe("private, no-store");
    expect(second.headers.get("Cache-Control")).toBe("private, no-store");
    expect(firstAsset.downloadUrl).not.toBe(secondAsset.downloadUrl);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("/releases?per_page=100")).length).toBe(1);
  });

  it("returns 401 when signed identity headers are absent", async () => {
    expect((await latestRelease(new NextRequest("https://store.faivr.test/api/company-os/v1/releases/latest?channel=stable"))).status).toBe(401);
  });
});
