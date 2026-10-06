import { notFound } from "next/navigation";
import { MarketplaceLayout } from "@/components/marketplace/MarketplaceLayout";
import { canPurchasePackage, getPublicPackage, publicPackages } from "@/data/publicPackages";

export function generateStaticParams() { return publicPackages.map(({ slug }) => ({ slug })); }

export default async function PackagePage({ params }: { params: Promise<{ slug: string }> }) {
  const item = getPublicPackage((await params).slug);
  if (!item) notFound();
  const installable = canPurchasePackage(item);
  return <MarketplaceLayout><div className="mx-auto max-w-5xl px-6 py-12"><p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faivr-accent)]">{item.category} · Old School GmbH</p><h1 className="mt-3 text-6xl font-black tracking-[-0.07em]">{item.name}</h1><p className="mt-6 max-w-2xl text-xl leading-8 text-[var(--brand-slate)]">{item.summary}</p><div className="mt-10 grid border-2 border-[var(--brand-ink)] md:grid-cols-2"><div className="p-7"><h2 className="text-xl font-black">Included</h2><ul className="mt-5 space-y-3 text-sm">{item.deliverables.map((deliverable) => <li key={deliverable}>— {deliverable}</li>)}</ul></div><div className="border-t-2 border-[var(--brand-ink)] p-7 md:border-l-2 md:border-t-0"><p className="text-2xl font-black">{item.price}</p>{installable ? <button className="mt-6 w-full bg-[var(--brand-ink)] px-4 py-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--brand-paper)]">Request this package</button> : <p className="mt-6 border-2 border-[var(--brand-ink)] px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.1em]">Coming soon — not available for purchase</p>}</div></div></div></MarketplaceLayout>;
}
