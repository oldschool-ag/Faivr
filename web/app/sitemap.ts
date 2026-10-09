import type { MetadataRoute } from "next";
import { getPublicCatalog } from "@/lib/publicCatalog";
import { comingSoonFunctions } from "@/data/catalog-coming-soon";

const base = "https://faivr.ai";
const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const available = await getPublicCatalog();
  const paths = new Set(["/", "/catalog", "/how-it-works", "/trust", "/docs", "/imprint", "/privacy"]);
  for (const item of available) {
    paths.add(`/catalog/${item.slug}`);
    for (const agent of item.workers) paths.add(`/agents/${agent.slug}`);
  }
  for (const item of comingSoonFunctions) {
    paths.add(`/catalog/${item.slug}`);
    for (const agent of item.agents) paths.add(`/agents/${slugify(agent)}`);
  }
  return Array.from(paths).map(route => ({ url: base + route }));
}
