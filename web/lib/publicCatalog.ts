import "server-only";
import { unstable_cache } from "next/cache";
import { getPgPool } from "@/lib/postgres";
import { loadPublicCatalog } from "@/lib/publicCatalogData";

export type { PublicWorker, PublicFunction, PublicCatalogState } from "@/lib/publicCatalogData";

export const getPublicCatalogState = unstable_cache(
  () => loadPublicCatalog(getPgPool),
  ["public-faivr-catalog-v2"],
  { revalidate: 600 },
);

export async function getPublicCatalog() {
  return (await getPublicCatalogState()).functions;
}
