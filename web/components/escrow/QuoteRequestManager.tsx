"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, Loader2, RefreshCcw } from "lucide-react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { QUOTE_REQUEST_STATUS_LABELS, type QuoteRequestRecord, type QuoteRequestStatus } from "@/lib/quoteRequestSchema";

function statusClasses(status: QuoteRequestStatus): string {
  if (status === "requested") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "viewed") return "border-violet-200 bg-violet-50 text-violet-700";
  if (status === "quoted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatBudget(amount: string | null | undefined, tokenSymbol: string): string {
  if (!amount) return "Open";
  const parsed = Number.parseFloat(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) return "Open";
  return `${parsed.toFixed(2)} ${tokenSymbol}`;
}

export function QuoteRequestManager() {
  const { address, isConnected } = useAccount();
  const [requests, setRequests] = useState<QuoteRequestRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!address) {
      setRequests([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/quote-requests?requesterAddress=${encodeURIComponent(address)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { requests?: QuoteRequestRecord[]; error?: string };

      if (!res.ok) {
        throw new Error(data.error || "Failed to load quote requests");
      }

      setRequests(Array.isArray(data.requests) ? data.requests : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quote requests");
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  if (!isConnected) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/80 py-16 text-center shadow-sm">
        <p className="text-slate-500">Connect your wallet to view submitted quote requests.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading quote requests…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[28px] border border-red-200 bg-red-50/80 p-6 shadow-sm">
        <p className="text-sm font-medium text-red-800">{error}</p>
        <Button variant="secondary" className="mt-4" onClick={() => void loadRequests()}>
          <RefreshCcw className="h-4 w-4" />
          Retry
        </Button>
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/80 py-16 text-center shadow-sm">
        <p className="mb-1 text-slate-500">No quote requests yet</p>
        <p className="text-xs text-slate-400">Request a quote from a quote-based agent to start tracking it here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-slate-950">Submitted quote requests</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Requests are tied to your connected wallet and persisted on the FAIVR support surface.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void loadRequests()}>
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {requests.map((request) => (
          <div
            key={request.requestId}
            className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.35)]"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-950">{request.briefPayload.title}</h4>
                <p className="font-mono text-[11px] text-slate-400">{request.requestId}</p>
              </div>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusClasses(request.status)}`}
              >
                {QUOTE_REQUEST_STATUS_LABELS[request.status]}
              </span>
            </div>

            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{request.agentName}</p>
            <p className="mb-4 line-clamp-4 text-sm leading-6 text-slate-600">{request.briefPayload.objective}</p>

            <div className="mb-3 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Budget</span>
                <span className="text-slate-950">{formatBudget(request.briefPayload.amount, request.briefPayload.tokenSymbol)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500">Deadline</span>
                <span className="text-slate-950">{request.briefPayload.deadlineLabel}</span>
              </div>
            </div>

            {(request.quoteAmount || request.quoteMessage || request.operatorNote) && (
              <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 text-sm leading-6 text-emerald-950">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Operator response</p>
                {request.quoteAmount && (
                  <div className="mt-2 flex justify-between gap-3 text-sm">
                    <span className="text-emerald-800/70">Quoted amount</span>
                    <span className="font-medium text-emerald-950">
                      {formatBudget(request.quoteAmount, request.briefPayload.tokenSymbol)}
                    </span>
                  </div>
                )}
                {request.quoteMessage && <p className="mt-2 text-sm leading-6 text-emerald-950">{request.quoteMessage}</p>}
                {request.operatorNote && (
                  <p className="mt-2 rounded-xl border border-emerald-200/80 bg-white/70 px-3 py-2 text-xs leading-5 text-emerald-900">
                    <span className="font-semibold uppercase tracking-[0.14em] text-emerald-700">Operator note</span>
                    <span className="mt-1 block normal-case tracking-normal text-emerald-900">{request.operatorNote}</span>
                  </p>
                )}
              </div>
            )}

            {request.briefHash && (
              <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500">
                <p className="font-semibold uppercase tracking-[0.16em] text-slate-500">Brief hash</p>
                <p className="mt-1 break-all font-mono text-[11px] text-slate-600">{request.briefHash}</p>
              </div>
            )}

            <div className="space-y-1.5 text-xs text-slate-500">
              <div className="flex items-center gap-1.5">
                <Clock3 className="h-3 w-3" />
                Submitted {formatTimestamp(request.createdAt)}
              </div>
              {request.viewedAt && <p>Viewed {formatTimestamp(request.viewedAt)}</p>}
              {request.respondedAt && <p>Quoted {formatTimestamp(request.respondedAt)}</p>}
              {request.closedAt && <p>Closed {formatTimestamp(request.closedAt)}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
