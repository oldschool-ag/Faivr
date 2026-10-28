import type { PoolClient } from "pg";

/** F24: `multiple` (repository slots only) lets the box offer several repositories of one product; it passes through unchanged. */
export type PublicSlot = { id: string; question: string; kind: "repository" | "product" | "website"; required: boolean; multiple?: boolean };
export type PublicWorker = {
  id: string; slug: string; name: string; role: string; version: string;
  publisherName: string; publisherKeyId: string; digest: string; permissions: string[]; slots: PublicSlot[];
};
export type PublicFunction = {
  slug: string; name: string; description: string;
  monthlyPriceCents: number; currency: string; image: { url: string; sha256: string; width: number; height: number; mediaType: "image/webp" } | null; workers: PublicWorker[];
};
export type PublicCatalogState = { functions: PublicFunction[]; unavailable: boolean };
export type CatalogDb = Pick<PoolClient, "query">;

// Publication is an explicit admin decision. Public reads never join customer,
// appliance, billing, subscription or receipt tables and never select their IDs.
export const PUBLIC_CATALOG_SQL = `
  SELECT b.id AS bundle_id,b.name AS bundle_name,b.description,
         b.monthly_price_cents,b.currency,blob.content_sha256,blob.width,blob.height,blob.media_type,
         p.id AS package_id,p.slug AS worker_slug,p.name AS worker_name,p.summary,
         v.version,v.publisher_key_id,v.artifact_sha256,
         pub.name AS publisher_name,v.manifest->'permissions' AS permissions,v.manifest->'slots' AS slots
  FROM company_os_function_bundles b
  LEFT JOIN company_os_bundle_images i ON i.bundle_id=b.id
  LEFT JOIN company_os_bundle_image_blobs blob ON blob.content_sha256=i.content_sha256
  JOIN company_os_bundle_packages bp ON bp.bundle_id=b.id
  JOIN company_os_packages p ON p.id=bp.package_id
  JOIN company_os_package_versions v ON v.package_id=p.id
  JOIN company_os_publishers pub ON pub.key_id=v.publisher_key_id
  JOIN company_os_package_artifacts a ON a.version_id=v.id AND a.artifact_sha256=v.artifact_sha256
  WHERE b.status='active' AND b.public_listing=true
    AND p.status='active' AND p.public_listing=true
    AND v.status='published' AND v.publisher_signature<>'' AND v.published_at IS NOT NULL
    AND pub.status='active' AND pub.name IS NOT NULL AND pub.name<>''
  ORDER BY v.published_at DESC,b.name,b.id,p.id,v.version DESC
`;

/** A slot as the signed manifest declares it; the object is passed through unchanged, `multiple` included. */
export function isPublicSlot(slot: unknown): slot is PublicSlot {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) return false;
  const value = slot as Record<string, unknown>;
  if (typeof value.id !== "string" || typeof value.question !== "string" || !(["repository", "product", "website"] as string[]).includes(String(value.kind)) || typeof value.required !== "boolean") return false;
  if ("multiple" in value && (typeof value.multiple !== "boolean" || value.kind !== "repository")) return false;
  return true;
}

export const publicCatalogImagePath = (sha256: string) => `/api/company-os/v1/catalog-images/${encodeURIComponent(sha256)}.webp`;

export async function queryPublicCatalog(client: CatalogDb): Promise<PublicFunction[]> {
  const { rows } = await client.query(PUBLIC_CATALOG_SQL);
  const functions = new Map<string, PublicFunction>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.bundle_id}:${row.package_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item: PublicFunction = functions.get(row.bundle_id) ?? {
      slug: row.bundle_id, name: row.bundle_name, description: row.description,
      monthlyPriceCents: row.monthly_price_cents, currency: row.currency,
      image: row.content_sha256 ? { url: publicCatalogImagePath(String(row.content_sha256)), sha256: String(row.content_sha256), width: Number(row.width), height: Number(row.height), mediaType: "image/webp" } : null, workers: [],
    };
    item.workers.push({
      id: row.package_id, slug: row.worker_slug, name: row.worker_name,
      role: row.summary, version: row.version, publisherName: row.publisher_name,
      publisherKeyId: row.publisher_key_id, digest: row.artifact_sha256,
      permissions: Array.isArray(row.permissions)
        ? row.permissions.filter((permission: unknown): permission is string => typeof permission === "string") : [],
      slots: Array.isArray(row.slots) ? row.slots.filter(isPublicSlot) : [],
    });
    functions.set(item.slug, item);
  }
  return Array.from(functions.values());
}

export async function loadPublicCatalog(getClient: () => CatalogDb): Promise<PublicCatalogState> {
  try {
    return { functions: await queryPublicCatalog(getClient()), unavailable: false };
  } catch {
    // The public page reports a short availability note, without leaking DB errors.
    return { functions: [], unavailable: true };
  }
}
