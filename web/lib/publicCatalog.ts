import "server-only";
import { unstable_cache } from "next/cache";
import { getPgPool } from "@/lib/postgres";

export type PublicWorker = { id: string; name: string; role: string; version: string; publisherName: string; publisherKeyId: string; digest: string; permissions: string[] };
export type PublicFunction = { slug: string; name: string; description: string; monthlyPriceCents: number; currency: string; workers: PublicWorker[] };

async function queryPublicCatalog(): Promise<PublicFunction[]> {
  const bundles = await getPgPool().query("SELECT id,name,description,monthly_price_cents,currency FROM company_os_function_bundles WHERE status='active' AND public_listing=true ORDER BY name");
  const rows = await getPgPool().query("SELECT bp.bundle_id,p.id,p.name,p.summary,v.version,v.publisher_key_id,v.artifact_sha256,pub.name publisher_name,v.manifest FROM company_os_bundle_packages bp JOIN company_os_packages p ON p.id=bp.package_id JOIN LATERAL (SELECT * FROM company_os_package_versions WHERE package_id=p.id AND status='published' ORDER BY published_at DESC LIMIT 1) v ON true LEFT JOIN company_os_publishers pub ON pub.key_id=v.publisher_key_id");
  return bundles.rows.map((bundle) => ({ slug: bundle.id, name: bundle.name, description: bundle.description, monthlyPriceCents: bundle.monthly_price_cents, currency: bundle.currency, workers: rows.rows.filter((row) => row.bundle_id === bundle.id).map((row) => ({ id: row.id, name: row.name, role: row.summary, version: row.version, publisherName: row.publisher_name, publisherKeyId: row.publisher_key_id, digest: row.artifact_sha256, permissions: Array.isArray(row.manifest?.permissions) ? row.manifest.permissions : [] })) }));
}
export const getPublicCatalog = unstable_cache(async () => { try { return await queryPublicCatalog(); } catch { return []; } }, ["public-faivr-catalog"], { revalidate: 600 });
