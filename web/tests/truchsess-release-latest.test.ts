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
const closureDigest = "a".repeat(64);
const closureSignatureDigest = "b".repeat(64);
const manifestDigest = "c".repeat(64);
const manifestSignatureDigest = "d".repeat(64);
function signedUrl(path: string, seconds = 300) {
  const jwt = `x.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds })).toString("base64url")}.x`;
  return `https://objects.github.test/${path}?jwt=${jwt}&se=${encodeURIComponent(new Date(Date.now() + seconds * 1000).toISOString())}`;
}

function githubRelease(options: { includeChecksum?: boolean } = {}) {
  const includeChecksum = options.includeChecksum ?? true;
  return { tag_name: tag, target_commitish: "main", published_at: "2026-10-11T10:00:00Z", body: "Release notes", draft: false, prerelease: true, assets: [
    { id: 1, name: "truchsess.iso", size: 99, url: "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/1" },
    { id: 42, name: "truchsess-system-20261011-8f10bc7.closure.zst", size: 12, url: assetApi, digest: `sha256:${closureDigest}` },
    ...(includeChecksum ? [{ id: 43, name: "truchsess-system-20261011-8f10bc7.closure.zst.sha256", size: 80, url: checksumApi }] : []),
    { id: 44, name: "truchsess-system-20261011-8f10bc7.closure.zst.sig", size: 8, url: "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/44", digest: `sha256:${closureSignatureDigest}` },
    { id: 45, name: "truchsess-system-20261011-8f10bc7.release.json", size: 8, url: "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/45", digest: `sha256:${manifestDigest}` },
    { id: 46, name: "truchsess-system-20261011-8f10bc7.release.json.sig", size: 8, url: "https://api.github.com/repos/oldschool-ag/truchsess/releases/assets/46", digest: `sha256:${manifestSignatureDigest}` },
  ] };
}

function githubFetch(options: { closureLifetimeSeconds?: number; includeChecksum?: boolean; mismatchChecksum?: boolean; varyingUrls?: boolean } = {}) {
  let redirectNumber = 0;
  const release = () => githubRelease({ includeChecksum: options.includeChecksum });
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/releases?per_page=100")) return new Response(JSON.stringify([{ ...release(), tag_name: "truchsess-iso-older", published_at: "2026-10-10T13:22:00Z" }, release()]), { status: 200 });
    if (url.endsWith(`/releases/tags/${tag}`)) return new Response(JSON.stringify(release()), { status: 200 });
    if (url.endsWith(`/git/ref/tags/${tag}`)) return new Response(JSON.stringify({ object: { type: "commit", sha: "f".repeat(40) } }), { status: 200 });
    if (url === assetApi) return new Response(null, { status: 302, headers: { location: signedUrl(`closure-${options.varyingUrls ? ++redirectNumber : "current"}`, options.closureLifetimeSeconds ?? 300) } });
    if (url.endsWith("/assets/44")) return new Response(null, { status: 302, headers: { location: signedUrl(`closure.sig-${options.varyingUrls ? ++redirectNumber : "current"}`) } });
    if (url.endsWith("/assets/45")) return new Response(null, { status: 302, headers: { location: signedUrl("release.json") } });
    if (url.endsWith("/assets/46")) return new Response(null, { status: 302, headers: { location: signedUrl("release.json.sig") } });
    if (url === checksumApi) return new Response(null, { status: 302, headers: { location: signedUrl("checksums") } });
    if (url.startsWith("https://objects.github.test/checksums?")) return new Response(`${options.mismatchChecksum ? "e".repeat(64) : closureDigest}  truchsess-system-20261011-8f10bc7.closure.zst\n`, { status: 200 });
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
    expect(payload.assets).toEqual(expect.arrayContaining([expect.objectContaining({ name: "truchsess-system-20261011-8f10bc7.closure.zst", sha256: `sha256:${closureDigest}` })]));
    expect(payload.assets).toHaveLength(4);
    expect(JSON.stringify(payload)).not.toContain("truchsess.iso");
    const expiration = new Date(((payload.assets as Array<{ downloadUrlExpiresAt: string }>)[0]).downloadUrlExpiresAt).getTime();
    expect(expiration - Date.now()).toBeLessThanOrEqual(70 * 60 * 1000);
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

  it("accepts a real-shaped GitHub redirect with a one-hour JWT expiry", () => {
    expect(new Date(signedUrlExpiry(signedUrl("closure", 3600))).getTime() - Date.now()).toBeGreaterThan(59 * 60 * 1000);
  });

  it("returns unavailable at the route when a provider URL exceeds seventy minutes", async () => {
    fetchMock = githubFetch({ closureLifetimeSeconds: 71 * 60 });
    vi.stubGlobal("fetch", fetchMock);
    const response = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    expect(response.status).toBe(502);
    expect(await body(response)).toEqual({ error: "release_unavailable" });
  });

  it("serves digest-only assets when no checksum file is published", async () => {
    fetchMock = githubFetch({ includeChecksum: false });
    vi.stubGlobal("fetch", fetchMock);
    const response = await latestRelease(signedRequest(appliance, "GET", "/api/company-os/v1/releases/latest?channel=stable"));
    const payload = await body(response);
    expect(response.status).toBe(200);
    expect(payload.assets).toHaveLength(4);
    expect((payload.assets as Array<{ sha256: string }>).every(asset => asset.sha256.startsWith("sha256:"))).toBe(true);
  });

  it("returns unavailable when GitHub's digest differs from a checksum file", async () => {
    fetchMock = githubFetch({ mismatchChecksum: true });
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
