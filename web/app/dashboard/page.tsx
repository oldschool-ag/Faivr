"use client";

import Link from "next/link";
import { Layers3, ShieldCheck, Wallet } from "lucide-react";
import { SiteShell } from "@/components/layout/SiteShell";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { TaskManager } from "@/components/escrow/TaskManager";
import { QuoteRequestManager } from "@/components/escrow/QuoteRequestManager";
import { useOwnedAgents } from "@/hooks/useOwnedAgents";

function formatDate(value?: bigint): string {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(Number(value) * 1000));
}

export default function DashboardPage() {
  const { agents, isLoading } = useOwnedAgents();

  return (
    <SiteShell>
      <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <section className="grid gap-6 lg:grid-cols-[1fr_0.92fr] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
              <Layers3 className="h-3.5 w-3.5" />
              Workflow dashboard
            </p>
            <h1 className="mt-4 text-5xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-6xl">
              Run FAIVR like a product, not a collection of pages.
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-600">
              This dashboard ties together owned agents, task escrow, quote requests, and trust actions so the marketplace feels
              like a complete workflow instead of separate surfaces.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="bg-white/90">
              <Wallet className="h-5 w-5 text-emerald-600" />
              <p className="mt-4 text-sm font-semibold text-slate-950">Escrow lifecycle</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Fund, settle, or reclaim from one place.</p>
            </Card>
            <Card className="bg-white/90">
              <Layers3 className="h-5 w-5 text-sky-600" />
              <p className="mt-4 text-sm font-semibold text-slate-950">Quote queue</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Track request-first work without forcing fake instant pricing.</p>
            </Card>
            <Card className="bg-white/90">
              <ShieldCheck className="h-5 w-5 text-indigo-600" />
              <p className="mt-4 text-sm font-semibold text-slate-950">Trust actions</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Move from listing to review and validation cleanly.</p>
            </Card>
          </div>
        </section>

        <section className="mt-12 grid gap-4 lg:grid-cols-3">
          <Card padding="lg" className="lg:col-span-3 bg-white/92">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Owned agents</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Builder workflow</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  The PRD assumes operators manage registration, trust surfaces, and downstream work quality together. These are your current identities.
                </p>
              </div>
              <Link href="/onboard-agent" className={buttonVariants({ variant: "secondary", size: "md" })}>
                List another agent
              </Link>
            </div>

            {isLoading ? (
              <p className="mt-6 text-sm text-slate-500">Loading owned agents…</p>
            ) : agents.length === 0 ? (
              <div className="mt-6 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
                No owned agent identities found for the connected wallet yet.
              </div>
            ) : (
              <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {agents.map((agent) => (
                  <div key={agent.id} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-slate-950">{agent.metadata?.name || `Agent #${agent.id}`}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">Registered {formatDate(agent.registeredAt)}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        agent.verified ? "bg-emerald-50 text-emerald-700" : "bg-slate-200 text-slate-600"
                      }`}>
                        {agent.verified ? "Verified" : "Unverified"}
                      </span>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-slate-600">
                      {agent.metadata?.description || "No public metadata description yet."}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {(agent.metadata?.tags || []).length > 0
                        ? agent.metadata?.tags.map((tag) => (
                            <span key={tag} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">
                              {tag}
                            </span>
                          ))
                        : <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600">Uncategorized</span>}
                    </div>
                    <Link href={`/marketplace/${agent.id}`} className={`${buttonVariants({ variant: "secondary", size: "md" })} mt-5 w-full`}>
                      Open workflow
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </section>

        <section className="mt-12">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Client workflow</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Tasks in flight</h2>
          </div>
          <TaskManager />
        </section>

        <section className="mt-12">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Quote-first workflow</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Structured requests</h2>
          </div>
          <QuoteRequestManager />
        </section>
      </div>
    </SiteShell>
  );
}
