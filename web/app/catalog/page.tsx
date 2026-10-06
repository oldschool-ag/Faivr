import { MarketplaceLayout } from "@/components/marketplace/MarketplaceLayout";
import { PackageCard } from "@/components/marketplace/PackageCard";
import { publicPackages } from "@/data/publicPackages";

export default function CatalogPage() {
  return <MarketplaceLayout><div className="mx-auto max-w-7xl px-6 py-12"><p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faivr-accent)]">Public catalog · Old School GmbH</p><h1 className="mt-3 max-w-3xl text-5xl font-black tracking-[-0.07em] sm:text-7xl">Pick the package. Inspect the delivery.</h1><p className="mt-5 max-w-2xl text-lg leading-7 text-[var(--brand-slate)]">Only packages in this catalogue are public. A coming-soon package has no purchase path.</p><div className="mt-10 grid gap-4 md:grid-cols-3">{publicPackages.map((item) => <PackageCard key={item.slug} item={item} />)}</div></div></MarketplaceLayout>;
}
