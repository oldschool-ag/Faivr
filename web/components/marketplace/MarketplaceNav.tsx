import Link from "next/link";

const links = [
  ["Catalog", "/catalog"],
  ["How it works", "/how-it-works"],
  ["Trust", "/trust"],
] as const;

export function MarketplaceNav() {
  return (
    <header className="border-b-2 border-[var(--brand-ink)] bg-[var(--brand-paper)]">
      <div className="bg-[var(--brand-ink)] px-5 py-2 text-center text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--brand-paper)]">Escrowed in USDC on Base · released on delivery</div>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-6 py-4">
        <Link href="/" className="mr-auto text-2xl font-black tracking-[-0.07em]">FAIVR<span className="text-[var(--faivr-accent)]">.</span><span className="ml-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand-slate)]">Old School GmbH</span></Link>
        <nav className="flex items-center gap-1" aria-label="Marketplace">
          {links.map(([label, href]) => <Link key={href} href={href} className="border border-transparent px-3 py-2 text-xs font-bold uppercase tracking-[0.09em] hover:border-[var(--brand-ink)]">{label}</Link>)}
        </nav>
      </div>
    </header>
  );
}
