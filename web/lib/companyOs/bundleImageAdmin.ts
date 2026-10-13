import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";

export type BundleImage = { url: string; sha256: string; width: number; height: number; mediaType: "image/webp" };
type ImageDb = { query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }> };
type ImageSource = "upload" | "polar";
type StoredImage = BundleImage & { source: ImageSource };
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 60 * 1024;
const IMAGE_TIMEOUT_MS = 10_000;
const RASTER_FORMATS = new Set(["jpeg", "png", "webp", "avif"]);
const digest = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export class BundleImageError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function storePublicOrigin(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.FAIVR_STORE_ORIGIN?.trim()
    || (env.VERCEL_ENV === "production" ? "https://faivr.ai" : (env.VERCEL_URL?.trim() ? `https://${env.VERCEL_URL.trim()}` : "https://faivr.ai"));
  let url: URL;
  try { url = new URL(configured); } catch { throw new BundleImageError("store_public_origin_invalid", 500); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new BundleImageError("store_public_origin_invalid", 500);
  return url.origin;
}

export async function normalizeBundleImage(input: Buffer) {
  if (!input.length || input.length > MAX_INPUT_BYTES) throw new BundleImageError("bundle_image_input_limits_exceeded");
  let metadata: Metadata;
  try { metadata = await sharp(input, { failOn: "error", limitInputPixels: 16_000_000 }).metadata(); } catch { throw new BundleImageError("bundle_image_invalid"); }
  if (!metadata.format || !RASTER_FORMATS.has(metadata.format)) throw new BundleImageError("bundle_image_unsupported");
  const bytes = await sharp(input, { failOn: "error", limitInputPixels: 16_000_000 }).rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toBuffer();
  const output = await sharp(bytes).metadata();
  if (!output.width || !output.height || output.width > 256 || output.height > 256 || bytes.length > MAX_OUTPUT_BYTES) throw new BundleImageError("bundle_image_limits_exceeded");
  return { bytes, contentSha256: digest(bytes), width: output.width, height: output.height, mediaType: "image/webp" as const };
}

export function imageMetadata(row: { contentSha256: string; width: number; height: number }, env?: NodeJS.ProcessEnv): BundleImage {
  return { url: `${storePublicOrigin(env)}/api/company-os/v1/catalog-images/${encodeURIComponent(row.contentSha256)}.webp`, sha256: row.contentSha256, width: row.width, height: row.height, mediaType: "image/webp" };
}

function storedImage(row: Record<string, unknown>): StoredImage {
  return { ...imageMetadata({ contentSha256: String(row.content_sha256), width: Number(row.width), height: Number(row.height) }), source: row.source as ImageSource };
}

export async function currentBundleImage(db: ImageDb, bundleId: string): Promise<StoredImage | null> {
  const result = await db.query("SELECT i.source,b.content_sha256,b.width,b.height FROM company_os_bundle_images i JOIN company_os_bundle_image_blobs b ON b.content_sha256=i.content_sha256 WHERE i.bundle_id=$1", [bundleId]);
  return result.rowCount ? storedImage(result.rows[0]) : null;
}

export async function setBundleImage(db: ImageDb, bundleId: string, input: Buffer, source: ImageSource): Promise<StoredImage> {
  const bundle = await db.query("SELECT id FROM company_os_function_bundles WHERE id=$1", [bundleId]);
  if (!bundle.rowCount) throw new BundleImageError("bundle_not_found", 404);
  const normalized = await normalizeBundleImage(input);
  await db.query("INSERT INTO company_os_bundle_image_blobs(content_sha256,media_type,width,height,byte_length,bytes) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(content_sha256) DO NOTHING", [normalized.contentSha256, normalized.mediaType, normalized.width, normalized.height, normalized.bytes.length, normalized.bytes]);
  const result = await db.query(
    "INSERT INTO company_os_bundle_images(bundle_id,content_sha256,source) VALUES($1,$2,$3) ON CONFLICT(bundle_id) DO UPDATE SET content_sha256=EXCLUDED.content_sha256,source=EXCLUDED.source,updated_at=now() WHERE EXCLUDED.source='upload' OR company_os_bundle_images.source<>'upload' RETURNING source,content_sha256",
    [bundleId, normalized.contentSha256, source],
  );
  if (result.rowCount) return { ...imageMetadata(normalized), source: result.rows[0].source as ImageSource };
  const retained = await currentBundleImage(db, bundleId);
  if (!retained) throw new BundleImageError("bundle_image_store_failed", 500);
  return retained;
}

function isSafeHttpsUrl(value: string, allowedPolarMediaHost = false) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !host || host === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
    // Polar's public media service also returns unsigned S3 GetObject URLs.
    const publicS3Host = /^(?:[a-z0-9][a-z0-9.-]*\.)?s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(host);
    return !allowedPolarMediaHost || host === "polar.sh" || host.endsWith(".polar.sh") || publicS3Host;
  } catch { return false; }
}

export function polarProductImageUrl(product: unknown): string | null {
  if (!product || typeof product !== "object") return null;
  const medias = (product as Record<string, unknown>).medias;
  if (!Array.isArray(medias)) return null;
  for (const media of medias) {
    if (!media || typeof media !== "object") continue;
    const entry = media as Record<string, unknown>;
    const url = entry.public_url;
    if (typeof url === "string" && isSafeHttpsUrl(url, true) && (typeof entry.mime_type !== "string" || entry.mime_type.startsWith("image/"))) return url;
  }
  return null;
}

async function fetchWithTimeout(fetcher: FetchLike, url: string, init: RequestInit, failure: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: "error" });
    return { response, finish: () => clearTimeout(timer), controller };
  } catch {
    clearTimeout(timer);
    throw new BundleImageError(failure, 502);
  }
}

async function boundedBytes(response: Response, controller?: AbortController) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_INPUT_BYTES) throw new BundleImageError("polar_product_image_too_large", 502);
  const reader = response.body?.getReader();
  if (!reader) throw new BundleImageError("polar_product_image_download_failed", 502);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_INPUT_BYTES) {
        controller?.abort();
        await reader.cancel();
        throw new BundleImageError("polar_product_image_too_large", 502);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/** Fetch once from Polar during an explicit admin operation, never during a catalog read. */
export async function fetchPolarProductImage(input: { apiOrigin: string; accessToken: string; productId: string; fetcher?: FetchLike }) {
  if (!isSafeHttpsUrl(input.apiOrigin)) throw new BundleImageError("polar_api_origin_invalid", 500);
  const fetcher = input.fetcher ?? fetch;
  const productRequest = await fetchWithTimeout(fetcher, `${input.apiOrigin}/v1/products/${encodeURIComponent(input.productId)}`, { headers: { Authorization: `Bearer ${input.accessToken}`, "Polar-Version": "2026-10", Accept: "application/json" } }, "polar_product_lookup_failed");
  let product: unknown;
  try {
    if (!productRequest.response.ok) throw new BundleImageError("polar_product_lookup_failed", 502);
    product = JSON.parse((await boundedBytes(productRequest.response, productRequest.controller)).toString("utf8"));
  } catch (error) {
    if (error instanceof BundleImageError) throw error;
    throw new BundleImageError("polar_product_lookup_failed", 502);
  } finally { productRequest.finish(); }
  const imageUrl = polarProductImageUrl(product);
  if (!imageUrl) throw new BundleImageError("polar_product_image_missing", 404);
  const imageRequest = await fetchWithTimeout(fetcher, imageUrl, { headers: { Accept: "image/avif,image/webp,image/png,image/jpeg" } }, "polar_product_image_download_failed");
  try {
    if (!imageRequest.response.ok) throw new BundleImageError("polar_product_image_download_failed", 502);
    return await boundedBytes(imageRequest.response, imageRequest.controller);
  } finally { imageRequest.finish(); }
}
