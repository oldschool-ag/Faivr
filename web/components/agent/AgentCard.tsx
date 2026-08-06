"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, X, Zap } from "lucide-react";
import { VerifiedBadge } from "@/components/verification/VerifiedBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FundTaskForm } from "@/components/escrow/FundTaskForm";
import { useAgentTrust } from "@/hooks/useAgentTrust";
import { agentNftUrl } from "@/lib/explorer";
import { cn } from "@/lib/utils";

export interface AgentData {
  id: number;
  name: string;
  description: string;
  rating: number;
  reviews: number;
  tags: string[];
  validated: boolean;
  verified?: boolean;
  active?: boolean;
  pricingMode?: string;
  primaryToken?: string;
  fixedPriceAmount?: string;
  billingPeriod?: string;
  deliveryDescription?: string;
  targetBuyer?: string;
  domain?: string;
  isExample?: boolean;
  isGenesis?: boolean;
}

const GRADIENT_COLORS = [
  "from-sky-400 to-cyan-500",
  "from-violet-400 to-indigo-500",
  "from-emerald-400 to-teal-500",
  "from-amber-400 to-orange-500",
  "from-rose-400 to-pink-500",
];

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENT_COLORS[Math.abs(hash) % GRADIENT_COLORS.length];
}

function TrustPill({ active = false, children }: { active?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium",
        active
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-slate-200 bg-slate-50 text-slate-500",
      )}
    >
      {children}
    </span>
  );
}

export function AgentCard({ agent }: { agent: AgentData }) {
  const gradient = getGradient(agent.name);
  const [showDetail, setShowDetail] = useState(false);
  const [showFundForm, setShowFundForm] = useState(false);
  const explorerUrl = agentNftUrl(agent.id);
  const trust = useAgentTrust(agent.id, showDetail);

  const pricingLine = useMemo(() => {
    const mode = agent.pricingMode || "Request quote";
    const token = agent.primaryToken || "USDC";
    if (agent.fixedPriceAmount && mode.toLowerCase().includes("fixed")) {
      return `${agent.fixedPriceAmount} ${token} / ${agent.billingPeriod || "month"}`;
    }
    return `${mode} · ${token} on Base`;
  }, [agent.billingPeriod, agent.fixedPriceAmount, agent.primaryToken, agent.pricingMode]);

  return (
    <>
      <Card hover className="group relative flex h-full flex-col p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} text-lg font-bold text-white shadow-lg`}
            aria-hidden="true"
          >
            {agent.name[0]}
          </div>

          <div className="flex flex-col items-end gap-2 text-right">
            <TrustPill active={agent.active !== false}>Identity minted</TrustPill>
            <TrustPill active={Boolean(agent.verified)}>{agent.verified ? "Domain verified" : "Not verified"}</TrustPill>
          </div>
        </div>

        <h3 className="mb-2 flex items-center gap-2 text-lg font-bold tracking-tight text-slate-950">
          {agent.name}
          {agent.verified && <VerifiedBadge size="sm" />}
          {agent.isGenesis && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              Genesis
            </span>
          )}
          {agent.isExample && (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
              Preview
            </span>
          )}
        </h3>

        <p className="mb-3 line-clamp-3 text-sm leading-relaxed text-slate-600">{agent.description}</p>
        <p className="mb-4 text-xs font-medium uppercase tracking-[0.16em] text-slate-500">{pricingLine}</p>

        <div className="mb-6 flex flex-wrap gap-2">
          <TrustPill active={false}>Open the detail view for live trust counts</TrustPill>
          {agent.validated && <TrustPill active>Validation metadata present</TrustPill>}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {agent.tags.length > 0 ? agent.tags.map((tag) => <Badge key={tag}>{tag}</Badge>) : <Badge>Uncategorized</Badge>}
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Link
              href={`/marketplace/${agent.id}`}
              className="text-xs font-semibold text-slate-950 transition-colors hover:text-sky-900"
            >
              Open workflow →
            </Link>
            <button
              onClick={() => setShowDetail(true)}
              className="text-xs font-semibold text-sky-700 transition-colors hover:text-sky-900"
              aria-label={`View details for ${agent.name}`}
            >
              Quick view
            </button>
          </div>
        </div>
      </Card>

      {showDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm"
          onClick={() => setShowDetail(false)}
        >
          <div
            className="relative w-full max-w-xl rounded-[30px] border border-slate-200 bg-white p-6 shadow-[0_40px_120px_-60px_rgba(15,23,42,0.5)] sm:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowDetail(false)}
              className="absolute right-4 top-4 rounded-2xl p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900"
              aria-label="Close details"
            >
              <X className="h-5 w-5" />
            </button>

            {!showFundForm && (
              <>
                <div className="mb-6 flex items-center gap-4">
                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} text-xl font-bold text-white shadow-lg`}
                  >
                    {agent.name[0]}
                  </div>
                  <div>
                    <h2 className="flex items-center gap-2 text-xl font-bold text-slate-950">
                      {agent.name}
                      {agent.verified && <VerifiedBadge size="md" />}
                    </h2>
                    <p className="mt-1 text-sm text-slate-500">ERC-8004 identity on Base mainnet</p>
                  </div>
                </div>

                <p className="mb-4 text-sm leading-relaxed text-slate-600">{agent.description}</p>

                {agent.deliveryDescription && (
                  <div className="mb-6 rounded-[24px] border border-slate-200 bg-white p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Delivery model</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{agent.deliveryDescription}</p>
                  </div>
                )}

                <div className="mb-6 flex flex-wrap gap-2">
                  {agent.tags.length > 0 ? agent.tags.map((tag) => <Badge key={tag}>{tag}</Badge>) : <Badge>Uncategorized</Badge>}
                </div>

                <div className="mb-6 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Live trust state</p>
                    {trust.isLoading && <p className="text-xs text-slate-400">Refreshing…</p>}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <TrustPill active={agent.active !== false}>Identity minted</TrustPill>
                    <TrustPill active={Boolean(agent.verified)}>
                      {trust.verificationDomain ? `Verified: ${trust.verificationDomain}` : agent.verified ? "Verification complete" : "Verification pending"}
                    </TrustPill>
                    <TrustPill active={trust.validationCount > 0}>
                      {trust.validationCount > 0
                        ? `${trust.validationCount} validation${trust.validationCount === 1 ? "" : "s"}`
                        : "No validation responses yet"}
                    </TrustPill>
                    <TrustPill active={trust.feedbackCount > 0}>
                      {trust.feedbackCount > 0
                        ? `${trust.feedbackCount} settled feedback entr${trust.feedbackCount === 1 ? "y" : "ies"}`
                        : "No settled feedback yet"}
                    </TrustPill>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <span className="text-slate-500">Settled tasks</span>
                      <p className="mt-1 font-medium text-slate-950">{trust.settledTaskCount}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <span className="text-slate-500">Validation average</span>
                      <p className="mt-1 font-medium text-slate-950">
                        {trust.validationAverage !== undefined ? `${trust.validationAverage}/100` : "No score yet"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <span className="text-slate-500">Verification method</span>
                      <p className="mt-1 font-medium text-slate-950">{trust.verificationMethod || "Not surfaced"}</p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <span className="text-slate-500">Funding posture</span>
                      <p className="mt-1 font-medium text-slate-950">{pricingLine}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-500">
                    Verification proves control, not outcome quality. Settled feedback and validation counts are separate trust layers.
                  </p>
                </div>

                <div className="mb-6 space-y-3 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Agent ID</span>
                    <span className="font-mono text-slate-950">#{agent.id}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Network</span>
                    <span className="text-slate-950">Base mainnet</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Primary payment rail</span>
                    <span className="text-slate-950">{agent.primaryToken || "USDC"} on Base</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">Pricing mode</span>
                    <span className="text-slate-950">{agent.pricingMode || "Request quote"}</span>
                  </div>
                </div>

                <Link href={`/marketplace/${agent.id}`} className="mb-6 inline-flex text-sm font-semibold text-sky-700 hover:text-sky-900">
                  Open the full workflow page →
                </Link>
              </>
            )}

            {showFundForm ? (
              <FundTaskForm
                agentId={agent.id}
                agentName={agent.name}
                onBack={() => setShowFundForm(false)}
                onClose={() => {
                  setShowDetail(false);
                  setShowFundForm(false);
                }}
              />
            ) : (
              <div className="flex gap-3">
                <Button className="flex-1" onClick={() => setShowFundForm(true)}>
                  <Zap className="mr-1.5 h-4 w-4" />
                  {(agent.pricingMode || "").toLowerCase().includes("quote") ? "Request quote" : "Create task"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => window.open(explorerUrl, "_blank")}
                  aria-label="View agent identity on Basescan"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
