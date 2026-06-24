"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCheck, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { QUOTE_REQUEST_STATUS_LABELS, type QuoteRequestRecord, type QuoteRequestStatus } from "@/lib/quoteRequestSchema";

type QueueResponse = {
  requests?: QuoteRequestRecord[];
  error?: string;
};

type DraftMap = Record<
  string,
  {
    quoteAmount: string;
    quoteMessage: string;
    operatorNote: string;
  }
>;

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

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function statusCount(requests: QuoteRequestRecord[], status: QuoteRequestStatus): number {
  return requests.filter((request) => request.status === status).length;
}

export function OperatorQuoteQueue() {
  const [operatorKeyInput, setOperatorKeyInput] = useState("");
  const [operatorKey, setOperatorKey] = useState("");
  const [agentId, setAgentId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | QuoteRequestStatus>("all");
  const [requests, setRequests] = useState<QuoteRequestRecord[]>([]);
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [isLoading, setIsLoading] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    if (!operatorKey.trim()) {
      setRequests([]);
      setDrafts({});
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams();
      if (agentId.trim()) query.set("agentId", agentId.trim());
      const url = query.size > 0 ? `/api/quote-requests?${query.toString()}` : "/api/quote-requests";

      const res = await fetch(url, {
        cache: "no-store",
        headers: {
          "x-operator-key": operatorKey.trim(),
        },
      });

      const data = (await res.json()) as QueueResponse;
      if (!res.ok) {
        throw new Error(data.error || "Failed to load quote requests");
      }

      const nextRequests = Array.isArray(data.requests) ? data.requests : [];
      setRequests(nextRequests);
      setDrafts(
        Object.fromEntries(
          nextRequests.map((request) => [
            request.requestId,
            {
              quoteAmount: request.quoteAmount ?? "",
              quoteMessage: request.quoteMessage ?? "",
              operatorNote: request.operatorNote ?? "",
            },
          ]),
        ),
      );
    } catch (err) {
      setRequests([]);
      setError(err instanceof Error ? err.message : "Failed to load quote requests");
    } finally {
      setIsLoading(false);
    }
  }, [agentId, operatorKey]);

  useEffect(() => {
    if (!operatorKey.trim()) {
      setRequests([]);
      setDrafts({});
      setError(null);
      return;
    }

    void loadRequests();
  }, [loadRequests, operatorKey]);

  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((request) => request.status === statusFilter);
  }, [requests, statusFilter]);

  async function updateRequest(request: QuoteRequestRecord, status: "viewed" | "quoted" | "closed") {
    setBusyRequestId(request.requestId);
    setError(null);

    try {
      const draft = drafts[request.requestId] ?? {
        quoteAmount: request.quoteAmount ?? "",
        quoteMessage: request.quoteMessage ?? "",
        operatorNote: request.operatorNote ?? "",
      };

      const res = await fetch("/api/quote-requests", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(operatorKey.trim() ? { "x-operator-key": operatorKey.trim() } : {}),
        },
        body: JSON.stringify({
          requestId: request.requestId,
          agentId: request.agentId,
          status,
          quoteAmount: draft.quoteAmount,
          quoteMessage: draft.quoteMessage,
          operatorNote: draft.operatorNote,
        }),
      });

      const data = (await res.json()) as { request?: QuoteRequestRecord; error?: string };
      if (!res.ok || !data.request) {
        throw new Error(data.error || "Failed to update quote request");
      }

      setRequests((current) => current.map((entry) => (entry.requestId === data.request?.requestId ? data.request : entry)));
      setDrafts((current) => ({
        ...current,
        [request.requestId]: {
          quoteAmount: data.request?.quoteAmount ?? "",
          quoteMessage: data.request?.quoteMessage ?? "",
          operatorNote: data.request?.operatorNote ?? "",
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update quote request");
    } finally {
      setBusyRequestId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-950">Operator quote queue</p>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
              This surface recovers the buyer-side quote requests and lets an operator mark them viewed, answer with a quote,
              or close them. Set <span className="font-mono text-[12px] text-slate-700">QUOTE_REQUEST_OPERATOR_KEY</span> on the server and enter the same value here.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const nextKey = operatorKeyInput.trim();
                setOperatorKey(nextKey);
                setError(null);
                if (!nextKey) {
                  setRequests([]);
                  setDrafts({});
                }
              }}
              disabled={isLoading}
            >
              Unlock queue
            </Button>
            <Button variant="secondary" onClick={() => void loadRequests()} disabled={isLoading || !operatorKey.trim()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[1.1fr_0.6fr_0.6fr]">
          <label className="block text-sm text-slate-600">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Operator key</span>
            <input
              type="password"
              value={operatorKeyInput}
              onChange={(event) => setOperatorKeyInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  const nextKey = operatorKeyInput.trim();
                  setOperatorKey(nextKey);
                  setError(null);
                  if (!nextKey) {
                    setRequests([]);
                    setDrafts({});
                  }
                }
              }}
              placeholder="Required for queue access"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300 focus:bg-white"
            />
          </label>
          <label className="block text-sm text-slate-600">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Agent ID filter</span>
            <input
              type="number"
              min="0"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              placeholder="Optional"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300 focus:bg-white"
            />
          </label>
          <label className="block text-sm text-slate-600">
            <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Status filter</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | QuoteRequestStatus)}
              className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-900 outline-none transition-colors focus:border-sky-300 focus:bg-white"
            >
              <option value="all">All statuses</option>
              <option value="requested">Requested</option>
              <option value="viewed">Viewed</option>
              <option value="quoted">Quoted</option>
              <option value="closed">Closed</option>
            </select>
          </label>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          {operatorKey.trim()
            ? "Queue unlocked. Refresh any time to pull the latest buyer requests."
            : "Enter the shared operator key, then unlock the queue to load requests."}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(["requested", "viewed", "quoted", "closed"] as const).map((status) => (
          <div key={status} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{QUOTE_REQUEST_STATUS_LABELS[status]}</p>
            <p className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-slate-950">{statusCount(requests, status)}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-[24px] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading operator queue…
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/80 py-16 text-center shadow-sm">
          <p className="mb-1 text-slate-500">{operatorKey.trim() ? "No quote requests in this view" : "Queue locked"}</p>
          <p className="text-xs text-slate-400">
            {operatorKey.trim()
              ? "Try a different status or agent filter, or verify the operator key."
              : "Enter the shared operator key above to unlock the queue and review buyer requests."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredRequests.map((request) => {
            const draft = drafts[request.requestId] ?? {
              quoteAmount: request.quoteAmount ?? "",
              quoteMessage: request.quoteMessage ?? "",
              operatorNote: request.operatorNote ?? "",
            };
            const isBusy = busyRequestId === request.requestId;

            return (
              <div
                key={request.requestId}
                className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.35)]"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] text-slate-400">{request.requestId}</p>
                    <h3 className="mt-1 text-lg font-bold text-slate-950">{request.briefPayload.title}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Agent #{request.agentId} · {request.agentName}
                    </p>
                  </div>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${statusClasses(request.status)}`}>
                    {QUOTE_REQUEST_STATUS_LABELS[request.status]}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Requester</span>
                    <span className="font-mono text-slate-950">{truncateAddress(request.requesterAddress)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Budget</span>
                    <span className="text-slate-950">{formatBudget(request.briefPayload.amount, request.briefPayload.tokenSymbol)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Deadline</span>
                    <span className="text-slate-950">{request.briefPayload.deadlineLabel}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Submitted</span>
                    <span className="text-slate-950">{formatTimestamp(request.createdAt)}</span>
                  </div>
                </div>

                <p className="mt-4 text-sm leading-6 text-slate-600">{request.briefPayload.objective}</p>

                {request.briefPayload.expectedOutput && (
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Expected output</p>
                    <p className="mt-1">{request.briefPayload.expectedOutput}</p>
                  </div>
                )}

                {request.briefPayload.acceptanceCriteria && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-600">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Acceptance criteria</p>
                    <p className="mt-1">{request.briefPayload.acceptanceCriteria}</p>
                  </div>
                )}

                <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <label className="block text-sm text-slate-600">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Quoted amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={draft.quoteAmount}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [request.requestId]: {
                            ...draft,
                            quoteAmount: event.target.value,
                          },
                        }))
                      }
                      placeholder="Optional"
                      className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300"
                    />
                  </label>

                  <label className="block text-sm text-slate-600">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Quote response</span>
                    <textarea
                      rows={4}
                      value={draft.quoteMessage}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [request.requestId]: {
                            ...draft,
                            quoteMessage: event.target.value,
                          },
                        }))
                      }
                      placeholder="Explain scope, assumptions, and what the buyer gets back."
                      className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300"
                    />
                  </label>

                  <label className="block text-sm text-slate-600">
                    <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Operator note</span>
                    <textarea
                      rows={2}
                      value={draft.operatorNote}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [request.requestId]: {
                            ...draft,
                            operatorNote: event.target.value,
                          },
                        }))
                      }
                      placeholder="Optional buyer-visible note."
                      className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 outline-none transition-colors focus:border-sky-300"
                    />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={isBusy || request.status === "viewed" || request.status === "quoted" || request.status === "closed"}
                    onClick={() => void updateRequest(request, "viewed")}
                  >
                    {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                    Mark viewed
                  </Button>
                  <Button variant="accent" disabled={isBusy || draft.quoteMessage.trim().length === 0 || request.status === "closed"} onClick={() => void updateRequest(request, "quoted")}>
                    {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Send quote
                  </Button>
                  <Button variant="secondary" disabled={isBusy || request.status === "closed"} onClick={() => void updateRequest(request, "closed")}>
                    Close request
                  </Button>
                </div>

                <div className="mt-4 space-y-1.5 text-xs text-slate-500">
                  {request.viewedAt && <p>Viewed {formatTimestamp(request.viewedAt)}</p>}
                  {request.respondedAt && <p>Quoted {formatTimestamp(request.respondedAt)}</p>}
                  {request.closedAt && <p>Closed {formatTimestamp(request.closedAt)}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
