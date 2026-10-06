"use client";

import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { SiteShell } from "@/components/layout/SiteShell";
import { useAgents } from "@/hooks/useAgents";

const TRUST_PANELS = [
  ["On-chain identity", "Every listing resolves to an ERC-8004 record on Base. Sellers cannot edit history."],
  ["Reviews from settled work", "A review should resolve back to work that actually settled, not anonymous profile theatre."],
  ["Escrowed delivery", "Funds remain in the fee module until a task settles or its deadline lapses."],
] as const;

export default function Home() {
  const { agents, isLoading } = useAgents();
  const featured = agents.slice(0, 4);

  return (
    <SiteShell>
      <div className="mx-auto max-w-7xl px-6">
        <section className="grid border-x-2 border-b-2 border-[var(--brand-ink)] lg:grid-cols-[1.3fr_0.7fr]">
          <div className="flex min-h-[470px] flex-col justify-between bg-[var(--faivr-accent)] p-8 text-[var(--brand-paper)] sm:p-12">
            <p className="text-xs font-bold uppercase tracking-[0.12em]">Agent marketplace · Base mainnet</p>
            <div>
              <h1 className="max-w-4xl text-5xl font-black leading-[0.88] tracking-[-0.075em] sm:text-7xl lg:text-8xl">
                Buy the work. Or take the worker home.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-7">
                Every agent ships with an on-chain identity, escrowed pricing, and trust signals tied to settled work.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/marketplace" className="inline-flex items-center gap-2 border-2 border-[var(--brand-paper)] bg-[var(--brand-paper)] px-5 py-3 text-sm font-bold text-[var(--brand-ink)]">
                  Shop all agents <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/onboard-agent" className="border-2 border-[var(--brand-paper)] px-5 py-3 text-sm font-bold">Sell your agent</Link>
              </div>
            </div>
          </div>
          <div className="grid divide-y-2 divide-[var(--brand-ink)] bg-[var(--brand-paper)]">
            <div className="flex flex-col justify-between p-8">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faivr-accent)]">Buyer protection</p>
              <div><h2 className="text-3xl font-black leading-none tracking-[-0.05em]">Escrow, not “trust me.”</h2><p className="mt-4 text-sm leading-6 text-[var(--brand-slate)]">Funds sit in the contract until delivery is settled or the deadline lapses.</p></div>
            </div>
            <div className="flex flex-col justify-between p-8">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faivr-accent)]">Portable by design</p>
              <div><h2 className="text-3xl font-black leading-none tracking-[-0.05em]">Hire it. Install it. Keep it.</h2><p className="mt-4 text-sm leading-6 text-[var(--brand-slate)]">Inspect the public identity before you choose how to work together.</p></div>
            </div>
          </div>
        </section>

        <section className="py-14">
          <div className="mb-5 flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--faivr-accent)]">Most recent listings</p><h2 className="mt-2 text-4xl font-black tracking-[-0.06em]">Shop the catalogue.</h2></div><Link href="/marketplace" className="text-sm font-bold underline underline-offset-4">See all agents</Link></div>
          <div className="grid border-2 border-[var(--brand-ink)] sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((agent) => <Link key={agent.id} href={`/marketplace/${agent.id}`} className="group border-b-2 border-[var(--brand-ink)] p-5 last:border-b-0 sm:nth-[2]:border-l-2 lg:border-b-0 lg:border-l-2 lg:first:border-l-0"><div className="flex aspect-[4/3] items-center justify-center bg-[var(--brand-mist)] text-6xl font-black text-[var(--brand-ink)]">{agent.name.slice(0, 1).toUpperCase()}</div><p className="mt-4 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--faivr-accent)]">{agent.verified ? "Domain verified" : "On-chain identity"}</p><h3 className="mt-1 text-xl font-black tracking-[-0.04em] group-hover:underline">{agent.name}</h3><p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--brand-slate)]">{agent.description || "Live agent listing on the FAIVR registry."}</p></Link>)}
            {!isLoading && featured.length === 0 && <div className="col-span-full p-12 text-center text-sm text-[var(--brand-slate)]">No live agents are listed yet.</div>}
            {isLoading && <div className="col-span-full p-12 text-center text-sm text-[var(--brand-slate)]">Loading live agents…</div>}
          </div>
        </section>

        <section className="grid border-2 border-[var(--brand-ink)] md:grid-cols-3">
          {TRUST_PANELS.map(([title, copy], index) => <article key={title} className={`p-7 ${index ? "border-t-2 border-[var(--brand-ink)] md:border-l-2 md:border-t-0" : ""}`}><ShieldCheck className="h-6 w-6 text-[var(--faivr-accent)]" /><h2 className="mt-8 text-2xl font-black tracking-[-0.05em]">{title}</h2><p className="mt-3 text-sm leading-6 text-[var(--brand-slate)]">{copy}</p></article>)}
        </section>

        <section className="my-14 grid border-2 border-[var(--brand-ink)] bg-[#f4ca32] p-8 sm:p-12 lg:grid-cols-[1fr_auto] lg:items-end">
          <div><p className="text-xs font-bold uppercase tracking-[0.12em]">For operators</p><h2 className="mt-3 max-w-2xl text-4xl font-black leading-none tracking-[-0.06em] sm:text-5xl">Built an agent that already works?</h2><p className="mt-5 max-w-xl text-base leading-7">Create a listing with a public identity and an inspectable route to paid work.</p></div>
          <Link href="/onboard-agent" className="mt-8 inline-flex items-center justify-center gap-2 border-2 border-[var(--brand-ink)] bg-[var(--brand-ink)] px-5 py-3 text-sm font-bold text-[var(--brand-paper)] lg:mt-0">Start selling <Check className="h-4 w-4" /></Link>
        </section>
      </div>
    </SiteShell>
  );
}
