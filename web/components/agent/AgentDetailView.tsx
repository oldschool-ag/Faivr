"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, ExternalLink, FileCheck2, Layers3, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { useAccount } from "wagmi";
import { VerifyAgentModal } from "@/components/verification/VerifyAgentModal";
import { FeedbackComposer } from "@/components/reputation/FeedbackComposer";
import { RequestValidationPanel } from "@/components/validation/RequestValidationPanel";
import { FundTaskForm } from "@/components/escrow/FundTaskForm";
import { SiteShell } from "@/components/layout/SiteShell";
import { Card } from "@/components/ui/Card";
import { Button, buttonVariants } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useAgentProfile } from "@/hooks/useAgentProfile";
import { useAgentTrust } from "@/hooks/useAgentTrust";
import { addressUrl, agentNftUrl } from "@/lib/explorer";

function formatDate(value?: bigint): string {
  if (!value) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(Number(value) * 1000));
}

function shortAddress(value?: string): string {
  if (!value) return "Unknown";
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function trustTier(validationCount: number, feedbackCount: number, verified?: boolean): string {
  if (verified && validationCount > 0 && feedbackCount > 0) return "High context";
  if (verified || validationCount > 0 || feedbackCount > 0) return "Emerging";
  return "Early";
}

export function AgentDetailView({ agentId }: { agentId: number }) {
  const { address } = useAccount();
  const { profile, isLoading } = useAgentProfile(agentId);
  const trust = useAgentTrust(agentId, true);
  const [showVerify, setShowVerify] = useState(false);
  const [activeFlow, setActiveFlow] = useState<"overview" | "hire" | "review">("overview");

  const agentName = profile?.metadata?.name || `Agent #${agentId}`;
  const description = profile?.metadata?.description || "No public description is attached to this identity yet.";
  const ownerMatch = useMemo(
    () => Boolean(address && profile?.owner && address.toLowerCase() === profile.owner.toLowerCase()),
    [address, profile?.owner],
  );
  const tier = trustTier(trust.validationCount, trust.feedbackCount, profile?.verified);

  return (
    <SiteShell>
      <div className="mx-auto max-w-7xl px-6 py-12 sm:py-16">
        <Link href="/marketplace" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Back to marketplace
        </Link>

        <section className="mt-6 grid gap-8 lg:grid-cols-[1fr_0.92fr]">
          <div className="space-y-6">
            <div className="rounded-[34px] border border-slate-200/80 bg-white/90 p-7 shadow-[0_28px_80px_-48px_rgba(15,23,42,0.28)]">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
                    <Sparkles className="h-3.5 w-3.5" />
                    Agent workflow
                  </div>
                  <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em] text-slate-950 sm:text-5xl">{agentName}</h1>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">{description}</p>
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-slate-700">
                    <BadgeCheck className="h-3.5 w-3.5 text-[var(--faivr-accent)]" />
                    {tier}
                  </span>
                  <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
                    profile?.active !== false ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                  }`}>
                    {profile?.active !== false ? "Active identity" : "Inactive identity"}
                  </span>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                {(profile?.metadata?.tags || []).length > 0
                  ? profile?.metadata?.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
                  : <Badge>Uncategorized</Badge>}
                {profile?.verified && <Badge>Verified</Badge>}
                {trust.validationCount > 0 && <Badge>{trust.validationCount} validations</Badge>}
                {trust.feedbackCount > 0 && <Badge>{trust.feedbackCount} feedback entries</Badge>}
              </div>

              <div className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Card className="bg-slate-50/90">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Owner</p>
                  <p className="mt-3 text-sm font-semibold text-slate-950">{shortAddress(profile?.owner)}</p>
                  {profile?.owner && (
                    <a href={addressUrl(profile.owner as `0x${string}`)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-sky-700 hover:text-sky-900">
                      View owner
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </Card>
                <Card className="bg-slate-50/90">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Registered</p>
                  <p className="mt-3 text-sm font-semibold text-slate-950">{formatDate(profile?.registeredAt)}</p>
                  <a href={agentNftUrl(agentId)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-sky-700 hover:text-sky-900">
                    View identity NFT
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Card>
                <Card className="bg-slate-50/90">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Validation average</p>
                  <p className="mt-3 text-sm font-semibold text-slate-950">
                    {trust.validationAverage !== undefined ? `${trust.validationAverage}/100` : "No score yet"}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">Separate from verification and separate from buyer feedback.</p>
                </Card>
                <Card className="bg-slate-50/90">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Buyer feedback</p>
                  <p className="mt-3 text-sm font-semibold text-slate-950">
                    {trust.feedbackAverage !== undefined ? `${trust.feedbackAverage.toFixed(1)}/5` : "No score yet"}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{trust.feedbackCount} public entries with settled-task provenance intent.</p>
                </Card>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Card padding="lg" className="bg-white/88">
                <BadgeCheck className="h-5 w-5 text-[var(--faivr-accent)]" />
                <h2 className="mt-4 text-lg font-semibold text-slate-950">Identity</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Registered on Base and inspectable on-chain before a buyer trusts any copy or claims around this listing.
                </p>
              </Card>
              <Card padding="lg" className="bg-white/88">
                <Wallet className="h-5 w-5 text-emerald-600" />
                <h2 className="mt-4 text-lg font-semibold text-slate-950">Settlement</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Funding can move through escrow, or through a quote-first flow when instant pricing would be misleading.
                </p>
              </Card>
              <Card padding="lg" className="bg-white/88">
                <ShieldCheck className="h-5 w-5 text-indigo-600" />
                <h2 className="mt-4 text-lg font-semibold text-slate-950">Reputation provenance</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Verification, validation, and review are separate trust layers so buyers can inspect what each signal actually means.
                </p>
              </Card>
            </div>

            <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
              {[
                { id: "overview", label: "Overview" },
                { id: "hire", label: "Hire / Fund" },
                { id: "review", label: "Review / Validate" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveFlow(tab.id as "overview" | "hire" | "review")}
                  className={activeFlow === tab.id ? "rounded-full bg-slate-950 px-5 py-2 text-sm font-medium text-white" : "rounded-full px-5 py-2 text-sm font-medium text-slate-500 hover:text-slate-950"}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeFlow === "overview" ? (
              <div className="grid gap-4 lg:grid-cols-[1.02fr_0.98fr]">
                <Card padding="lg" className="bg-white/92">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">What the buyer receives</p>
                  <p className="mt-3 text-sm leading-7 text-slate-700">
                    {profile?.metadata?.deliveryDescription || "Delivery terms are not yet public. Buyers should request specific deliverables before funding work."}
                  </p>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Pricing mode</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">
                        {profile?.metadata?.fixedPriceAmount
                          ? `${profile.metadata.fixedPriceAmount} ${profile.metadata.primaryToken || "USDC"} / ${profile.metadata.billingPeriod || "month"}`
                          : profile?.metadata?.pricingMode || "Request quote"}
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Primary rail</p>
                      <p className="mt-2 text-sm font-semibold text-slate-950">{profile?.metadata?.primaryToken || "USDC"} on Base</p>
                    </div>
                  </div>
                  {profile?.metadata?.targetBuyer && (
                    <div className="mt-3 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Target buyer</p>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{profile.metadata.targetBuyer}</p>
                    </div>
                  )}
                </Card>

                <Card padding="lg" className="bg-slate-950 text-white">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-200">Trust posture</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em]">Inspect the stack, not just the badge.</h2>
                  <div className="mt-5 space-y-3 text-sm leading-6 text-slate-300">
                    <div className="rounded-[22px] border border-white/10 bg-white/6 px-4 py-4">
                      <p className="font-semibold text-white">Verification</p>
                      <p className="mt-1">
                        {profile?.verified
                          ? `${trust.verificationMethod || "Verification"} for ${trust.verificationDomain || "a public surface"}`
                          : "No public verification surface confirmed yet."}
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-white/10 bg-white/6 px-4 py-4">
                      <p className="font-semibold text-white">Validation</p>
                      <p className="mt-1">
                        {trust.validationCount > 0
                          ? `${trust.validationCount} validation responses with an average score of ${trust.validationAverage}/100.`
                          : "No validator response has been anchored yet."}
                      </p>
                    </div>
                    <div className="rounded-[22px] border border-white/10 bg-white/6 px-4 py-4">
                      <p className="font-semibold text-white">Feedback</p>
                      <p className="mt-1">
                        {trust.feedbackCount > 0
                          ? `${trust.feedbackCount} feedback entries and ${trust.settledTaskCount} settled task records visible in the trust surface.`
                          : "No settled-task-backed buyer feedback is visible yet."}
                      </p>
                    </div>
                  </div>
                </Card>
              </div>
            ) : activeFlow === "hire" ? (
              <div className="space-y-5">
                <Card padding="lg" className="bg-white/92">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Hiring flow</p>
                  <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-slate-950">Define the task before you move money.</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                    The fuller FAIVR flow is: inspect identity, draft a concrete task brief, fund escrow only when pricing is honest,
                    then anchor review or reclaim based on the outcome.
                  </p>
                </Card>
                <div className="rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_22px_60px_-36px_rgba(15,23,42,0.28)]">
                  <FundTaskForm
                    agentId={agentId}
                    agentName={agentName}
                    pricingMode={profile?.metadata?.pricingMode}
                    onBack={() => setActiveFlow("overview")}
                    onClose={() => setActiveFlow("overview")}
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[1.02fr_0.98fr]">
                <RequestValidationPanel agentId={agentId} agentName={agentName} />
                <FeedbackComposer agentId={agentId} agentName={agentName} />
              </div>
            )}
          </div>

          <div className="space-y-4">
            <Card padding="lg" className="bg-white/92">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Operator actions</p>
              <div className="mt-4 space-y-3">
                <Button className="w-full" variant="accent" onClick={() => setActiveFlow("hire")}>
                  <Wallet className="h-4 w-4" />
                  Start hiring flow
                </Button>
                <Button className="w-full" variant="secondary" onClick={() => setShowVerify(true)}>
                  <FileCheck2 className="h-4 w-4" />
                  Verify operator surface
                </Button>
                <Button className="w-full" variant="secondary" onClick={() => setActiveFlow("review")}>
                  <ShieldCheck className="h-4 w-4" />
                  Request validation or leave review
                </Button>
                <Link href="/dashboard" className={buttonVariants({ variant: "secondary", size: "md" })}>
                  <Layers3 className="h-4 w-4" />
                  Open workflow dashboard
                </Link>
              </div>
              {ownerMatch && (
                <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
                  Your connected wallet owns this identity. Verification and validation requests are most useful when the metadata,
                  delivery model, and public operator surface are all kept in sync.
                </p>
              )}
            </Card>

            <Card padding="lg" className="bg-white/92">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workflow fit</p>
              <div className="mt-4 space-y-3 text-sm leading-6 text-slate-600">
                <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="font-semibold text-slate-950">1. Inspect</p>
                  <p className="mt-1">Check identity, verification, and validation before assuming the operator can deliver.</p>
                </div>
                <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="font-semibold text-slate-950">2. Specify</p>
                  <p className="mt-1">Use a concrete brief so the escrow or quote request has an auditable scope.</p>
                </div>
                <div className="rounded-[20px] border border-slate-200 bg-slate-50 px-4 py-4">
                  <p className="font-semibold text-slate-950">3. Settle or review</p>
                  <p className="mt-1">After delivery, settle, reclaim, and record feedback as separate trust signals.</p>
                </div>
              </div>
            </Card>

            {isLoading && (
              <Card padding="lg" className="bg-white/92">
                <p className="text-sm text-slate-500">Loading live agent profile…</p>
              </Card>
            )}
          </div>
        </section>

        <VerifyAgentModal
          agentId={agentId}
          agentName={agentName}
          isOpen={showVerify}
          onClose={() => setShowVerify(false)}
        />
      </div>
    </SiteShell>
  );
}
