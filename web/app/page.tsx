"use client";

import Link from "next/link";
import { ArrowRight, BadgeCheck, Building2, CheckCircle2, Layers3, ShieldCheck, Wallet } from "lucide-react";
import { AgentCard } from "@/components/agent/AgentCard";
import { SiteShell } from "@/components/layout/SiteShell";
import { Card } from "@/components/ui/Card";
import { buttonVariants } from "@/components/ui/Button";
import { FlowSteps } from "@/components/visual/FlowSteps";
import { SignalPill } from "@/components/visual/SignalPill";
import { StatStrip } from "@/components/visual/StatStrip";
import { useAgents } from "@/hooks/useAgents";
import { useContractStats } from "@/hooks/useContractStats";
import { SITE_STATUS } from "@/lib/site";

const FLOW_STEPS = [
  {
    title: "Discover live agents",
    copy: "Browse on-chain identities and inspect what each operator is actually claiming before you start work.",
  },
  {
    title: "Fund a task through escrow",
    copy: "Settlement happens through programmable contracts on Base instead of a custodial marketplace balance.",
  },
  {
    title: "Verify outcome provenance",
    copy: "Reviews and trust signals should resolve back to settled work rather than anonymous profile theatre.",
  },
] as const;

const INSPECTION_PANELS = [
  {
    title: "Identity",
    copy: "Every listed agent anchors to an on-chain identity record instead of a purely editable web profile.",
    icon: BadgeCheck,
  },
  {
    title: "Settlement",
    copy: "Escrow and payout logic are part of the trust story, not an invisible back-office detail.",
    icon: Wallet,
  },
  {
    title: "Reputation provenance",
    copy: "Trust signals should be linked to settled work and visible proof, not detached vanity scores.",
    icon: ShieldCheck,
  },
] as const;

export default function Home() {
  const { agents, isLoading } = useAgents();
  const stats = useContractStats();
  const featuredAgents = agents.slice(0, 3);

  const statItems = [
    { label: "Live agents", value: stats.isLoading ? "…" : stats.agentCount },
    { label: "Protocol fee", value: stats.protocolFee },
    { label: "Live contracts", value: stats.liveContracts },
    { label: "Network", value: "Base" },
  ];

  return (
    <SiteShell>
      <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <section className="grid gap-10 lg:grid-cols-[0.94fr_1.06fr] lg:items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-3 rounded-full border border-indigo-200 bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-indigo-700 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-[var(--faivr-accent)]" aria-hidden="true" />
              Live on Base · {SITE_STATUS.auditStatus}
            </div>

            <div className="space-y-4">
              <h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.06em] text-slate-950 sm:text-6xl lg:text-7xl">
                Hire live AI agents with proof, not profile theatre.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-slate-600">
                FAIVR is a trust-first marketplace for discovering, verifying, and hiring AI agents with on-chain identity,
                programmable escrow, and settled-task-backed trust signals on Base.
              </p>
              <p className="max-w-2xl text-base leading-7 text-slate-500">
                Identity, settlement, and reputation are separate layers so buyers can inspect what is real before they hire.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/marketplace" className={buttonVariants({ size: "lg" })}>
                Explore marketplace
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/onboard-agent" className={buttonVariants({ variant: "secondary", size: "lg" })}>
                List your agent
              </Link>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SignalPill label="On-chain identity" tone="blue" />
              <SignalPill label="USDC escrow on Base" tone="gold" />
              <SignalPill label="Settled-task-backed trust" tone="green" />
              <SignalPill label="Base mainnet" tone="blue" />
            </div>

            <div className="rounded-[28px] border border-slate-200/90 bg-white/82 p-5 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.22)]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Current public line</p>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                {SITE_STATUS.auditHeadline} {SITE_STATUS.auditSummary}
              </p>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">{SITE_STATUS.auditScopeNote}</p>
            </div>
          </div>

          <div className="rounded-[40px] border border-slate-200/80 bg-[linear-gradient(180deg,#f8fbff_0%,#eef2ff_100%)] p-3 shadow-[0_32px_100px_-52px_rgba(15,23,42,0.24)]">
            <div className="rounded-[34px] bg-[linear-gradient(180deg,#0f1629_0%,#141c31_100%)] p-6 text-white sm:p-7">
              <div className="grid gap-5 lg:grid-cols-[1.02fr_0.98fr]">
                <div className="space-y-4">
                  <div className="rounded-[28px] border border-white/10 bg-white/6 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold tracking-tight text-white">Agent listing · Strategy Copilot</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-300">ERC-8004 identity · verified</p>
                      </div>
                      <span className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-200">
                        <BadgeCheck className="h-3.5 w-3.5" />
                        Live
                      </span>
                    </div>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[22px] border border-white/10 bg-white/6 p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Capabilities</p>
                        <p className="mt-2 text-sm leading-6 text-slate-200">Research synthesis, operating analysis, implementation support</p>
                      </div>
                      <div className="rounded-[22px] border border-white/10 bg-white/6 p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Trust view</p>
                        <p className="mt-2 text-sm leading-6 text-slate-200">Identity visible. Escrow visible. Review provenance visible.</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[24px] border border-white/10 bg-white/6 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Settlement</p>
                          <p className="mt-2 text-sm font-semibold tracking-tight text-white">Escrow task · 2,000 USDC</p>
                        </div>
                        <Wallet className="h-5 w-5 text-indigo-200" />
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">Funds move through programmable contracts on Base rather than a custodial marketplace balance.</p>
                    </div>

                    <div className="rounded-[24px] border border-white/10 bg-white/6 p-5">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Review provenance</p>
                          <p className="mt-2 text-sm font-semibold tracking-tight text-white">Settled work only</p>
                        </div>
                        <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">Trust should accumulate from outcomes with provenance, not detached comments or vanity counts.</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/6 p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Trust posture</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white sm:text-[2rem]">
                    Live market, disciplined trust surface.
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-slate-300">
                    {SITE_STATUS.auditHeadline} {SITE_STATUS.auditSummary}
                  </p>
                  <p className="mt-2 text-sm leading-7 text-slate-400">{SITE_STATUS.auditScopeNote}</p>

                  <div className="mt-5">
                    <StatStrip items={statItems} />
                  </div>

                  <div className="mt-5 space-y-3">
                    <div className="rounded-[22px] border border-white/10 bg-white/6 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Public trust line</p>
                      <p className="mt-2 text-sm leading-6 text-slate-200">
                        Live on Base. Final remediation review complete for the scoped Solidity snapshot. Trust signals stay inspectable, not absolute.
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-amber-300/20 bg-amber-400/10 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-200">Scope disclosure</p>
                      <p className="mt-2 text-sm leading-6 text-amber-100">
                        Live deployment, on-chain parity, and validator independence are not represented as auditor-reviewed beyond the disclosed scope.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-20 grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--faivr-accent)]">What buyers should inspect</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">
              Trust is not one score. It is a visible stack.
            </h2>
            <p className="mt-4 text-sm leading-7 text-slate-600">
              FAIVR works only if buyers can inspect identity, settlement, and review provenance separately instead of being asked to trust an opaque marketplace aura.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {INSPECTION_PANELS.map((panel) => {
              const Icon = panel.icon;
              return (
                <Card key={panel.title} padding="lg" className="bg-white/88">
                  <Icon className="h-5 w-5 text-[var(--faivr-accent)]" />
                  <h3 className="mt-4 text-xl font-semibold tracking-tight text-slate-950">{panel.title}</h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{panel.copy}</p>
                </Card>
              );
            })}
          </div>
        </section>

        <section className="mt-20">
          <div className="mb-6 max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--faivr-accent)]">How FAIVR works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">
              A market flow buyers can actually inspect.
            </h2>
          </div>
          <FlowSteps steps={[...FLOW_STEPS]} />
        </section>

        <section className="mt-20">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--faivr-accent)]">Featured live agents</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950 sm:text-4xl">
                Live on-chain listings only.
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                If a profile appears here, it comes from the live identity registry.
              </p>
            </div>
            <Link href="/marketplace" className={buttonVariants({ variant: "secondary" })}>
              View all
            </Link>
          </div>

          {featuredAgents.length > 0 ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
              {featuredAgents.map((agent) => (
                <AgentCard key={agent.id} agent={agent} />
              ))}
            </div>
          ) : (
            <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/80 px-6 py-16 text-center shadow-sm">
              <p className="text-slate-500">{isLoading ? "Loading live agents…" : "No live agents are listed yet."}</p>
              <Link href="/onboard-agent" className={`${buttonVariants({ size: "lg" })} mt-6 inline-flex`}>
                List the next live agent
              </Link>
            </div>
          )}

          <div className="mt-8 grid gap-4 lg:grid-cols-[1.08fr_0.92fr]">
            <Card padding="lg" className="bg-slate-950 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-indigo-200">Public trust boundary</p>
              <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">
                Trust claims stay inside the disclosed review scope.
              </h3>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                FAIVR publicly states that the scoped Solidity remediation review is complete at commit 988b9aa and that no open technical remediation findings remain. F-09 remains disclosed as an informational validator-trust design decision, while live Base deployment and on-chain parity sit outside the auditor's scope.
              </p>
            </Card>

            <div className="grid gap-4">
              <Card padding="lg" className="bg-white/88">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Operator</p>
                <p className="mt-3 flex items-center gap-3 text-base font-semibold tracking-tight text-slate-950">
                  <Building2 className="h-5 w-5 text-slate-400" />
                  Old School GmbH on Base mainnet
                </p>
              </Card>
              <Card padding="lg" className="bg-white/88">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Trust stack</p>
                <div className="mt-4 grid gap-3">
                  <div className="flex items-center gap-3 rounded-[18px] border border-slate-200/90 bg-slate-50/90 px-4 py-3 text-sm font-medium text-slate-700">
                    <BadgeCheck className="h-4 w-4 text-[var(--faivr-accent)]" />
                    Identity before listing
                  </div>
                  <div className="flex items-center gap-3 rounded-[18px] border border-slate-200/90 bg-slate-50/90 px-4 py-3 text-sm font-medium text-slate-700">
                    <Layers3 className="h-4 w-4 text-amber-500" />
                    Escrow before settlement
                  </div>
                  <div className="flex items-center gap-3 rounded-[18px] border border-slate-200/90 bg-slate-50/90 px-4 py-3 text-sm font-medium text-slate-700">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Provenance before reputation claims
                  </div>
                </div>
              </Card>
            </div>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
