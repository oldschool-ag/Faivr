type GithubAsset = { id: number; name: string; size: number; url: string };
type GithubRelease = { tag_name: string; target_commitish: string; published_at: string | null; body: string | null; draft: boolean; prerelease: boolean; assets: GithubAsset[] };
type CachedRelease = GithubRelease;

const repository = "oldschool-ag/truchsess";
const tagPrefix = "truchsess-iso-";
const cacheTtlMs = 5 * 60 * 1000;
const downloadLifetimeSeconds = 10 * 60;
const cache = new Map<string, { expiresAt: number; release: CachedRelease }>();

export class ReleaseLookupError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

function token() {
  const value = process.env.TRUCHSESS_RELEASES_TOKEN?.trim();
  if (!value) throw new ReleaseLookupError(503, "release_service_unavailable");
  return value;
}

function githubHeaders() {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token()}`, "X-GitHub-Api-Version": "2022-11-28" };
}

function isChecksumAsset(asset: GithubAsset) {
  return /(?:^|[-_.])(?:sha256sums?|checksums?)(?:\.txt)?$/i.test(asset.name) || /\.sha256$/i.test(asset.name);
}

function isUpdateAsset(asset: GithubAsset) {
  return !/\.iso$/i.test(asset.name) && !isChecksumAsset(asset) && (/(?:closure|nar)/i.test(asset.name) || /\.release\.json$/i.test(asset.name) || /\.(?:sig|asc|minisig)$/i.test(asset.name));
}

function releaseIsEligible(release: GithubRelease) {
  return !release.draft && release.tag_name.startsWith(tagPrefix);
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: githubHeaders(), cache: "no-store" });
  if (!response.ok) throw new ReleaseLookupError(response.status === 404 ? 404 : 502, "release_lookup_failed");
  return response.json() as Promise<T>;
}

async function newestPublishedRelease() {
  const releases: GithubRelease[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await githubJson<GithubRelease[]>(`https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  return releases.filter(releaseIsEligible).sort((left, right) => Date.parse(right.published_at ?? "") - Date.parse(left.published_at ?? ""))[0];
}

export async function stableTag(pool: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<{ pinned_tag: string | null }> }> }) {
  const result = await pool.query("SELECT pinned_tag FROM company_os_release_channels WHERE channel='stable'");
  return result.rows[0]?.pinned_tag ?? null;
}

async function releaseForTag(tag: string | null): Promise<CachedRelease> {
  const cacheKey = tag ?? "newest";
  const existing = cache.get(cacheKey);
  if (existing && existing.expiresAt > Date.now()) return existing.release;
  const release = tag
    ? await githubJson<GithubRelease>(`https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(tag)}`)
    : await newestPublishedRelease();
  if (!release || !releaseIsEligible(release)) throw new ReleaseLookupError(404, "release_not_found");
  cache.set(cacheKey, { expiresAt: Date.now() + cacheTtlMs, release });
  return release;
}

async function immutableCommitForTag(tag: string) {
  const ref = await githubJson<{ object: { type: string; sha: string } }>(`https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`);
  if (ref.object.type === "commit") return ref.object.sha;
  if (ref.object.type !== "tag") throw new ReleaseLookupError(502, "release_tag_resolution_failed");
  const annotated = await githubJson<{ object: { type: string; sha: string } }>(`https://api.github.com/repos/${repository}/git/tags/${ref.object.sha}`);
  if (annotated.object.type !== "commit") throw new ReleaseLookupError(502, "release_tag_resolution_failed");
  return annotated.object.sha;
}

export function signedUrlExpiry(urlText: string) {
  const url = new URL(urlText);
  const jwt = url.searchParams.get("jwt"), se = url.searchParams.get("se");
  if (!jwt || !se) throw new ReleaseLookupError(502, "release_asset_url_expiry_unknown");
  const payload = jwt.split(".")[1];
  if (!payload) throw new ReleaseLookupError(502, "release_asset_url_expiry_unknown");
  let exp: unknown;
  try { exp = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).exp; } catch { throw new ReleaseLookupError(502, "release_asset_url_expiry_unknown"); }
  const expiry = Math.min(typeof exp === "number" ? exp * 1000 : NaN, Date.parse(se));
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry - Date.now() > downloadLifetimeSeconds * 1000) throw new ReleaseLookupError(502, "release_asset_url_expiry_invalid");
  return new Date(expiry).toISOString();
}

async function redirectUrl(asset: GithubAsset) {
  const response = await fetch(asset.url, { headers: { ...githubHeaders(), Accept: "application/octet-stream" }, redirect: "manual", cache: "no-store" });
  const location = response.headers.get("location");
  if (response.status < 300 || response.status >= 400 || !location) throw new ReleaseLookupError(502, "release_asset_url_failed");
  const url = new URL(location);
  if (url.protocol !== "https:") throw new ReleaseLookupError(502, "release_asset_url_failed");
  return url.toString();
}

function checksumMap(text: string) {
  const entries = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const standard = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    const bsd = line.match(/^SHA256 \((.+)\) = ([a-fA-F0-9]{64})$/);
    if (standard) entries.set(standard[2], `sha256:${standard[1].toLowerCase()}`);
    if (bsd) entries.set(bsd[1], `sha256:${bsd[2].toLowerCase()}`);
  }
  return entries;
}

async function checksums(release: GithubRelease) {
  const maps = await Promise.all(release.assets.filter(isChecksumAsset).map(async checksum => {
    const url = await redirectUrl(checksum);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new ReleaseLookupError(502, "release_checksums_failed");
    return checksumMap(await response.text());
  }));
  if (!maps.length) throw new ReleaseLookupError(502, "release_checksums_missing");
  return new Map(maps.flatMap(map => Array.from(map.entries())));
}

export async function latestTruchsessRelease(pool: Parameters<typeof stableTag>[0]) {
  const pinnedTag = await stableTag(pool);
  const release = await releaseForTag(pinnedTag);
  const digestByName = await checksums(release);
  const assets = await Promise.all(release.assets.filter(isUpdateAsset).map(async (asset) => {
    const sha256 = digestByName.get(asset.name);
    if (!sha256) throw new ReleaseLookupError(502, "release_asset_checksum_missing");
    const downloadUrl = await redirectUrl(asset);
    return { name: asset.name, size: asset.size, sha256, downloadUrl, downloadUrlExpiresAt: signedUrlExpiry(downloadUrl) };
  }));
  if (!assets.length) throw new ReleaseLookupError(502, "release_assets_missing");
  return {
    channel: "stable",
    tag: release.tag_name,
    version: await immutableCommitForTag(release.tag_name),
    publishedAt: release.published_at,
    releaseNotes: (release.body ?? "").slice(0, 1000),
    totalDownloadBytes: assets.reduce((total, asset) => total + asset.size, 0),
    assets,
  };
}

export function resetTruchsessReleaseCacheForTests() { cache.clear(); }
