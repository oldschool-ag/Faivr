import "server-only";
import { createHash } from "node:crypto";
import sharp, { type Sharp } from "sharp";

export type BundleImage = { url: string; sha256: string; width: number; height: number; mediaType: "image/webp" };
type ImageDb = {
  query: (text: string, values?: unknown[]) => Promise<{ rowCount: number | null; rows: Array<Record<string, unknown>> }>;
};
const MAX_BYTES = 60 * 1024;
const sha256 = (bytes: Buffer) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export class BundleImageError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function normalizeBundleImage(input: Buffer) {
  if (input.subarray(0, 512).toString("utf8").toLowerCase().includes("<svg") || input.subarray(0, 512).toString("utf8").toLowerCase().includes("<html")) throw new BundleImageError("bundle_image_unsupported");
  let image: Sharp;
  try { image = sharp(input, { failOn: "error", limitInputPixels: 16_000_000 }); await image.metadata(); } catch { throw new BundleImageError("bundle_image_invalid"); }
  const bytes = await image.rotate().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 82, effort: 6 }).toBuffer();
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height || metadata.width > 256 || metadata.height > 256 || bytes.length > MAX_BYTES) throw new BundleImageError("bundle_image_limits_exceeded");
  return { bytes, sha256: sha256(bytes), width: metadata.width, height: metadata.height, mediaType: "image/webp" as const };
}

export async function setBundleImage(db: ImageDb, bundleId: string, input: Buffer, source: "upload" | "polar") {
  const normalized = await normalizeBundleImage(input);
  const bundle = await db.query("SELECT id FROM company_os_function_bundles WHERE id=$1", [bundleId]);
  if (!bundle.rowCount) throw new BundleImageError("bundle_not_found", 404);
  await db.query("INSERT INTO company_os_bundle_images(bundle_id,content_sha256,media_type,width,height,byte_length,bytes,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(bundle_id) DO UPDATE SET content_sha256=EXCLUDED.content_sha256,media_type=EXCLUDED.media_type,width=EXCLUDED.width,height=EXCLUDED.height,byte_length=EXCLUDED.byte_length,bytes=EXCLUDED.bytes,source=EXCLUDED.source,updated_at=now()", [bundleId, normalized.sha256, normalized.mediaType, normalized.width, normalized.height, normalized.bytes.length, normalized.bytes, source]);
  return { ...imageMetadata(normalized), source };
}

export function imageMetadata(row: { content_sha256?: unknown; width?: unknown; height?: unknown; media_type?: unknown }): BundleImage {
  const sha = String(row.content_sha256);
  return { url: `/api/company-os/v1/catalog-images/${encodeURIComponent(sha)}.webp`, sha256: sha, width: Number(row.width), height: Number(row.height), mediaType: "image/webp" };
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Fetch once from Polar during an explicit admin operation, never during a catalog read. */
export async function fetchPolarProductImage(input: { apiOrigin: string; accessToken: string; productId: string; fetcher?: FetchLike }) {
  const fetcher = input.fetcher ?? fetch;
  const productResponse = await fetcher(`${input.apiOrigin}/v1/products/${encodeURIComponent(input.productId)}`, {
    headers: { Authorization: `Bearer ${input.accessToken}`, "Polar-Version": "2026-10", Accept: "application/json" },
  });
  if (!productResponse.ok) throw new BundleImageError("polar_product_lookup_failed", 502);
  const imageUrl = polarProductImageUrl(await productResponse.json());
  if (!imageUrl) throw new BundleImageError("polar_product_image_missing", 404);
  const imageResponse = await fetcher(imageUrl, { headers: { Accept: "image/avif,image/webp,image/png,image/jpeg" } });
  if (!imageResponse.ok) throw new BundleImageError("polar_product_image_download_failed", 502);
  return Buffer.from(await imageResponse.arrayBuffer());
}

export function polarProductImageUrl(product: unknown): string | null {
  if (!product || typeof product !== "object") return null;
  const record = product as Record<string, unknown>;
  const candidates: unknown[] = [record.image_url, record.image, ...(Array.isArray(record.medias) ? record.medias : []), ...(Array.isArray(record.media) ? record.media : [])];
  for (const candidate of candidates) {
    const value = typeof candidate === "string" ? candidate : candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>).public_url ?? (candidate as Record<string, unknown>).url : null;
    if (typeof value === "string" && /^https:\/\//.test(value)) return value;
  }
  return null;
}
