"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronRight, Copy, Download, Loader2 } from "lucide-react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { buildTaskBriefPayload, computeTaskBriefHash, downloadTaskBriefJson, saveTaskBrief } from "@/lib/taskBriefs";
import { TOKENS } from "@/lib/tokens";
import { useFundTaskUSDC } from "@/hooks/useEscrow";

type QuoteRequestResponse = {
  request?: {
    requestId: string;
  };
  error?: string;
};

const DEADLINE_OPTIONS = [
  { label: "6 hours", seconds: 21600 },
  { label: "24 hours", seconds: 86400 },
  { label: "3 days", seconds: 259200 },
  { label: "7 days", seconds: 604800 },
] as const;

const FEE_PCT = 2.5;

interface FundTaskFormProps {
  agentId: number;
  agentName: string;
  pricingMode?: string;
  onBack: () => void;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

function StepBadge({ step, active, done, label }: { step: number; active: boolean; done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full border ${
          done
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : active
              ? "border-sky-300 bg-sky-50 text-sky-700"
              : "border-slate-200 bg-slate-50 text-slate-400"
        }`}
      >
        {step}
      </span>
      <span className={active ? "text-slate-950" : undefined}>{label}</span>
    </div>
  );
}

function truncateHash(hash?: string | null): string {
  if (!hash) return "Generating…";
  return `${hash.slice(0, 10)}…${hash.slice(-10)}`;
}

export function FundTaskForm({ agentId, agentName, pricingMode, onBack, onClose }: FundTaskFormProps) {
  const { address, isConnected } = useAccount();
  const [step, setStep] = useState<Step>(1);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [acceptanceCriteria, setAcceptanceCriteria] = useState("");
  const [amount, setAmount] = useState("");
  const [deadlineIdx, setDeadlineIdx] = useState(1);
  const [briefHash, setBriefHash] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [quoteRequestId, setQuoteRequestId] = useState<string | null>(null);
  const [quoteSubmitError, setQuoteSubmitError] = useState<string | null>(null);
  const [isSubmittingQuote, setIsSubmittingQuote] = useState(false);

  const isQuoteRequired = (pricingMode || "").toLowerCase().includes("quote");

  const { approve, fundTask, hash, isPending, isConfirming, isSuccess, taskId, needsApproval, error, reset } =
    useFundTaskUSDC({
      agentId,
      amount,
      deadlineSeconds: DEADLINE_OPTIONS[deadlineIdx].seconds,
    });

  const parsedAmount = useMemo(() => {
    const n = Number.parseFloat(amount);
    return Number.isNaN(n) || n <= 0 ? 0 : n;
  }, [amount]);

  const protocolFee = parsedAmount * (FEE_PCT / 100);
  const agentReceives = parsedAmount - protocolFee;

  const briefIsValid = title.trim().length > 0 && objective.trim().length > 0;
  const termsAreValid = isQuoteRequired ? true : parsedAmount > 0;
  const isWorking = isPending || isConfirming;
  const deadlineLabel = DEADLINE_OPTIONS[deadlineIdx].label;

  const briefPayload = useMemo(
    () =>
      buildTaskBriefPayload({
        agentId,
        agentName,
        title: title.trim(),
        objective: objective.trim(),
        expectedOutput: expectedOutput.trim() || undefined,
        acceptanceCriteria: acceptanceCriteria.trim() || undefined,
        amount: amount.trim() || undefined,
        tokenSymbol: TOKENS.USDC.symbol,
        deadlineLabel,
        pricingMode: pricingMode || (isQuoteRequired ? "Request quote" : "Fixed price"),
      }),
    [acceptanceCriteria, agentId, agentName, amount, deadlineLabel, expectedOutput, isQuoteRequired, objective, pricingMode, title],
  );

  useEffect(() => {
    let cancelled = false;

    async function hashBrief() {
      const computed = await computeTaskBriefHash({
        agentId,
        agentName,
        title: title.trim(),
        objective: objective.trim(),
        expectedOutput: expectedOutput.trim() || undefined,
        acceptanceCriteria: acceptanceCriteria.trim() || undefined,
        amount: amount.trim() || undefined,
        tokenSymbol: TOKENS.USDC.symbol,
        deadlineLabel,
        pricingMode: pricingMode || (isQuoteRequired ? "Request quote" : "Fixed price"),
      });
      if (!cancelled) setBriefHash(computed);
    }

    void hashBrief();
    return () => {
      cancelled = true;
    };
  }, [acceptanceCriteria, agentId, agentName, amount, deadlineLabel, expectedOutput, isQuoteRequired, objective, pricingMode, title]);

  useEffect(() => {
    if (!isSuccess || taskId === undefined) return;

    saveTaskBrief({
      taskId: taskId.toString(),
      agentId,
      agentName,
      title: title.trim(),
      objective: objective.trim(),
      expectedOutput: expectedOutput.trim() || undefined,
      acceptanceCriteria: acceptanceCriteria.trim() || undefined,
      amount: amount.trim() || undefined,
      tokenSymbol: TOKENS.USDC.symbol,
      deadlineLabel,
      pricingMode: pricingMode || "Fixed price",
      briefHash: briefHash || undefined,
      fundingTxHash: hash,
      createdAt: Date.now(),
    });
  }, [acceptanceCriteria, agentId, agentName, amount, briefHash, deadlineLabel, expectedOutput, hash, isSuccess, objective, pricingMode, taskId, title]);

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(briefPayload, null, 2));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  async function submitQuoteRequest() {
    if (!address || !isConnected) {
      setQuoteSubmitError("Connect your wallet to submit and track a quote request.");
      return;
    }

    setIsSubmittingQuote(true);
    setQuoteSubmitError(null);

    try {
      const res = await fetch("/api/quote-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requesterAddress: address,
          agentId,
          agentName,
          briefHash,
          briefPayload,
        }),
      });

      const data = (await res.json()) as QuoteRequestResponse;
      if (!res.ok || !data.request?.requestId) {
        throw new Error(data.error || "Failed to submit quote request");
      }

      setQuoteRequestId(data.request.requestId);
    } catch (err) {
      setQuoteSubmitError(err instanceof Error ? err.message : "Failed to submit quote request");
    } finally {
      setIsSubmittingQuote(false);
    }
  }

  if (isQuoteRequired && quoteRequestId) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <h3 className="mb-2 text-lg font-bold text-slate-950">Quote request submitted</h3>
        <p className="mb-1 text-sm text-slate-600">
          Request ID: <span className="font-mono font-semibold text-emerald-700">{quoteRequestId}</span>
        </p>
        <p className="mb-2 text-sm font-medium text-slate-950">{title}</p>
        <p className="mb-3 text-sm text-slate-500">
          Your request for <span className="text-slate-950">{agentName}</span> is now tracked under <span className="font-medium text-slate-950">My Requests</span>.
        </p>
        <p className="mb-6 text-xs font-mono text-slate-400">Brief hash: {truncateHash(briefHash)}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button variant="secondary" onClick={copyBrief}>
            <Copy className="h-4 w-4" />
            {copyState === "copied" ? "Copied brief" : "Copy brief JSON"}
          </Button>
          <Button variant="secondary" onClick={() => downloadTaskBriefJson(briefPayload)}>
            <Download className="h-4 w-4" />
            Download JSON
          </Button>
          <Button variant="accent" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="py-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <h3 className="mb-2 text-lg font-bold text-slate-950">Task funded</h3>
        {taskId !== undefined && (
          <p className="mb-1 text-sm text-slate-600">
            Task ID: <span className="font-mono font-semibold text-emerald-700">#{taskId.toString()}</span>
          </p>
        )}
        <p className="mb-2 text-sm font-medium text-slate-950">{title}</p>
        <p className="mb-3 text-sm text-slate-500">
          {parsedAmount.toFixed(2)} USDC escrowed for <span className="text-slate-950">{agentName}</span>
        </p>
        <p className="mb-6 text-xs font-mono text-slate-400">Brief hash: {truncateHash(briefHash)}</p>
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => {
          reset();
          if (step === 1) {
            onBack();
            return;
          }
          setStep((prev) => (prev - 1) as Step);
        }}
        className="mb-5 flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-950"
      >
        <ArrowLeft className="h-4 w-4" />
        {step === 1 ? "Back to details" : "Back"}
      </button>

      <div className="mb-6 flex flex-wrap gap-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
        <StepBadge step={1} active={step === 1} done={step > 1} label="Brief" />
        <StepBadge step={2} active={step === 2} done={step > 2} label="Terms" />
        <StepBadge step={3} active={step === 3} done={false} label={isQuoteRequired ? "Request" : "Fund"} />
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-bold text-slate-950">Task brief</h3>
            <p className="mt-1 text-sm text-slate-500">
              Define what you need before {isQuoteRequired ? "requesting a quote" : "committing funds"}.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Task title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Review Base treasury allocation options"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">What you need done</label>
            <textarea
              rows={4}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Describe the task, context, and desired result."
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Expected output <span className="normal-case text-slate-400">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={expectedOutput}
              onChange={(e) => setExpectedOutput(e.target.value)}
              placeholder="What should the agent deliver back?"
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300 focus:bg-white"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              Acceptance criteria <span className="normal-case text-slate-400">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              placeholder="How will you decide the task is complete?"
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300 focus:bg-white"
            />
          </div>

          <Button className="w-full" variant="accent" disabled={!briefIsValid} onClick={() => setStep(2)}>
            {isQuoteRequired ? "Set request terms" : "Set payment terms"}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-bold text-slate-950">{isQuoteRequired ? "Request terms" : "Payment terms"}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {isQuoteRequired
                ? "This listing requires a quote before escrow funding."
                : "USDC on Base is the primary funding rail for FAIVR tasks."}
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
              {isQuoteRequired ? "Target budget (optional)" : "Amount"}
            </label>
            <div className="relative">
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-16 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300 focus:bg-white"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-500">USDC</span>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Deadline</label>
            <select
              value={deadlineIdx}
              onChange={(e) => setDeadlineIdx(Number(e.target.value))}
              className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition-colors focus:border-sky-300 focus:bg-white"
            >
              {DEADLINE_OPTIONS.map((opt, i) => (
                <option key={opt.seconds} value={i}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {!isQuoteRequired && parsedAmount > 0 && (
            <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Agent receives</span>
                <span className="text-slate-950">{agentReceives.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Protocol fee (2.5%)</span>
                <span className="text-slate-600">{protocolFee.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-2 font-medium">
                <span className="text-slate-700">You fund</span>
                <span className="text-slate-950">{parsedAmount.toFixed(2)} USDC</span>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <p className="font-medium text-slate-950">Brief summary</p>
            <p className="mt-2 text-slate-700">{title || "Untitled task"}</p>
            <p className="mt-1 line-clamp-3 text-slate-500">{objective || "No objective provided yet."}</p>
          </div>

          <Button className="w-full" variant="accent" disabled={!termsAreValid} onClick={() => setStep(3)}>
            {isQuoteRequired ? "Review quote request" : "Review and fund"}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-bold text-slate-950">{isQuoteRequired ? "Request quote" : "Fund escrow"}</h3>
            <p className="mt-1 text-sm text-slate-500">
              {isQuoteRequired
                ? "This agent requires a quote first. Build a structured request instead of sending funds blindly."
                : "Review the task and fund it in USDC on Base."}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Task summary</p>
            <p className="mt-3 text-base font-semibold text-slate-950">{title}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{objective}</p>
            {expectedOutput && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Expected output</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{expectedOutput}</p>
              </div>
            )}
            {acceptanceCriteria && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Acceptance criteria</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{acceptanceCriteria}</p>
              </div>
            )}
            <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">{isQuoteRequired ? "Budget" : "Amount"}</span>
                <span className="text-slate-950">{amount ? `${parsedAmount.toFixed(2)} USDC` : "Open"}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Deadline</span>
                <span className="text-slate-950">{deadlineLabel}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
            <p className="font-medium text-slate-950">Brief proof anchor</p>
            <p className="mt-2 font-mono text-xs text-slate-500">{truncateHash(briefHash)}</p>
            <p className="mt-2 text-slate-500">
              This hash gives the brief a stable local artifact even before settlement or quote acceptance.
            </p>
          </div>

          {isQuoteRequired ? (
            <>
              {!isConnected && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Connect your wallet to submit a quote request and track it under My Requests.</span>
                </div>
              )}

              {quoteSubmitError && (
                <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{quoteSubmitError}</span>
                </div>
              )}

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                Quote-required means instant funding is intentionally unavailable here. That is more honest than pretending every listing supports immediate escrow.
              </div>

              <Button className="w-full" variant="accent" disabled={!isConnected || isSubmittingQuote} onClick={submitQuoteRequest}>
                {isSubmittingQuote ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSubmittingQuote ? "Submitting request…" : "Submit quote request"}
              </Button>

              <div className="flex gap-3">
                <Button className="flex-1" variant="secondary" onClick={copyBrief}>
                  <Copy className="h-4 w-4" />
                  {copyState === "copied" ? "Copied brief" : "Copy brief JSON"}
                </Button>
                <Button className="flex-1" variant="secondary" onClick={() => downloadTaskBriefJson(briefPayload)}>
                  <Download className="h-4 w-4" />
                  Download JSON
                </Button>
              </div>

              {copyState === "failed" && <p className="text-xs text-red-700">Could not copy automatically. Use the downloaded JSON instead.</p>}
            </>
          ) : (
            <>
              {!isConnected && (
                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>Connect your wallet to approve USDC and fund this task.</span>
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="break-all">{(error as Error).message?.slice(0, 220) ?? "Transaction failed"}</span>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
                Funds are held by the escrow contract, not by FAIVR. If the deadline passes without settlement, the client can reclaim the funds.
              </div>

              {needsApproval ? (
                <Button className="w-full" variant="accent" disabled={!isConnected || !termsAreValid || isWorking} onClick={approve}>
                  {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isPending ? "Confirm approval in wallet…" : isConfirming ? "Approving USDC…" : "Approve USDC"}
                </Button>
              ) : (
                <Button className="w-full" variant="accent" disabled={!isConnected || !termsAreValid || isWorking} onClick={fundTask}>
                  {isWorking && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isPending ? "Confirm funding in wallet…" : isConfirming ? "Funding escrow…" : `Fund ${parsedAmount.toFixed(2)} USDC`}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
