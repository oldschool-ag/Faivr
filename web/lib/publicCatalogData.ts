import type { PoolClient } from "pg";

export type PublicWorker = {
  id: string; slug: string; name: string; role: string; version: string;
  publisherName: string; publisherKeyId: string; digest: string; permissions: string[];
};
export type PublicFunction = {
  slug: string; name: string; description: string;
  monthlyPriceCents: number; currency: string; workers: PublicWorker[];
};
export type PublicCatalogState = { functions: PublicFunction[]; unavailable: boolean };
export type CatalogDb = Pick<PoolClient, "query">;

// Publication is an explicit admin decision. Public reads never join customer,
// appliance, billing, subscription or receipt tables and never select their IDs.
export const PUBLIC_CATALOG_SQL = `
  SELECT b.id AS bundle_id,b.name AS bundle_name,b.description,
         b.monthly_price_cents,b.currency,
         p.id AS package_id,p.slug AS worker_slug,p.name AS worker_name,p.summary,
         v.version,v.publisher_key_id,v.artifact_sha256,
         pub.name AS publisher_name,v.manifest->'permissions' AS permissions
  FROM company_os_function_bundles b
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
      monthlyPriceCents: row.monthly_price_cents, currency: row.currency, workers: [],
    };
    item.workers.push({
      id: row.package_id, slug: row.worker_slug, name: row.worker_name,
      role: row.summary, version: row.version, publisherName: row.publisher_name,
      publisherKeyId: row.publisher_key_id, digest: row.artifact_sha256,
      permissions: Array.isArray(row.permissions)
        ? row.permissions.filter((permission: unknown): permission is string => typeof permission === "string") : [],
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
