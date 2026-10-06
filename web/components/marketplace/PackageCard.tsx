import Link from "next/link";
import { canPurchasePackage, type PublicPackage } from "@/data/publicPackages";

export function PackageCard({ item }: { item: PublicPackage }) {
  const installable = canPurchasePackage(item);
  return (
    <article className="flex flex-col border-2 border-[var(--brand-ink)] bg-[var(--brand-paper)] p-5">
      <div className="flex aspect-[4/3] items-center justify-center bg-[var(--brand-mist)] text-6xl font-black">{item.name.slice(0, 1)}</div>
      <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--faivr-accent)]">{item.category}</p>
      <h2 className="mt-1 text-2xl font-black tracking-[-0.05em]">{item.name}</h2>
      <p className="mt-3 flex-1 text-sm leading-6 text-[var(--brand-slate)]">{item.summary}</p>
      <p className="mt-5 text-lg font-black">{item.price}</p>
      {installable ? <Link href={`/package/${item.slug}`} className="mt-4 block bg-[var(--brand-ink)] px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.1em] text-[var(--brand-paper)]">View package</Link> : <span className="mt-4 block border-2 border-[var(--brand-ink)] px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.1em]">Coming soon</span>}
    </article>
  );
}
