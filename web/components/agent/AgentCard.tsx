"use client";

import { useState, type ReactNode } from "react";
import { ExternalLink, ShieldCheck, X, Zap } from "lucide-react";
import { VerifiedBadge } from "@/components/verification/VerifiedBadge";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { FundTaskForm } from "@/components/escrow/FundTaskForm";
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

function TrustPill({ active = false, children }: { active?: boolean; children: React.ReactNode }) {
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
            <TrustPill active={Boolean(agent.verified)}>
              {agent.verified ? "Domain verified" : "Not verified"}
            </TrustPill>
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

        <p className="mb-4 line-clamp-3 text-sm leading-relaxed text-slate-600">{agent.description}</p>

        <div className="mb-6 flex flex-wrap gap-2">
          <TrustPill active={false}>No settled tasks surfaced yet</TrustPill>
          {agent.validated && <TrustPill active>Validation metadata present</TrustPill>}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {agent.tags.length > 0 ? (
              agent.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
            ) : (
              <Badge>Uncategorized</Badge>
            )}
          </div>
          <button
            onClick={() => setShowDetail(true)}
            className="text-xs font-semibold text-sky-700 transition-colors hover:text-sky-900"
            aria-label={`View details for ${agent.name}`}
          >
            View details →
          </button>
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

                <p className="mb-6 text-sm leading-relaxed text-slate-600">{agent.description}</p>

                <div className="mb-6 flex flex-wrap gap-2">
                  {agent.tags.length > 0 ? (
                    agent.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
                  ) : (
                    <Badge>Uncategorized</Badge>
                  )}
                </div>

                <div className="mb-6 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Trust state</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <TrustPill active={agent.active !== false}>Identity minted</TrustPill>
                    <TrustPill active={Boolean(agent.verified)}>
                      {agent.verified ? "Verification complete" : "Verification pending"}
                    </TrustPill>
                    <TrustPill active={false}>No settled task count surfaced yet</TrustPill>
                  </div>
                  <p className="mt-4 text-sm leading-6 text-slate-500">
                    Verification helps prove control. It does not guarantee outcome quality or service fit.
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
                    <span className="text-slate-950">USDC on Base</span>
                  </div>
                </div>
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
                  Create task
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
