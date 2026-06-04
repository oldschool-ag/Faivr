"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { AlertCircle, CheckCircle2, Clock, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { STATUS_LABELS, formatTaskAmount, useReclaimTask, useSettleTask, useUserTasks } from "@/hooks/useEscrow";
import type { TaskInfo } from "@/hooks/useEscrow";
import { getAllTaskBriefs, type StoredTaskBrief, updateTaskBriefProof } from "@/lib/taskBriefs";
import { txUrl } from "@/lib/explorer";

function deadlineCountdown(deadline: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now) return "Expired";
  const diff = Number(deadline - now);
  const hours = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
  }
  return `${hours}h ${mins}m left`;
}

function statusColor(status: number): string {
  if (status === 0) return "text-emerald-700";
  if (status === 1) return "text-sky-700";
  return "text-slate-500";
}

function ProofLink({ label, hash }: { label: string; hash?: string }) {
  if (!hash) return null;

  return (
    <a
      href={txUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 transition-colors hover:text-sky-900"
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function TaskCard({ task, brief }: { task: TaskInfo; brief?: StoredTaskBrief }) {
  const {
    settleTask,
    hash: settleHash,
    isPending: settlingPending,
    isConfirming: settlingConfirming,
    isSuccess: settleSuccess,
    error: settleError,
  } = useSettleTask();
  const {
    reclaimTask,
    hash: reclaimHash,
    isPending: reclaimPending,
    isConfirming: reclaimConfirming,
    isSuccess: reclaimSuccess,
    error: reclaimError,
  } = useReclaimTask();
  const [actionError] = useState<string | null>(null);

  useEffect(() => {
    if (settleSuccess && settleHash) {
      updateTaskBriefProof(task.taskId.toString(), { settlementTxHash: settleHash });
    }
  }, [settleHash, settleSuccess, task.taskId]);

  useEffect(() => {
    if (reclaimSuccess && reclaimHash) {
      updateTaskBriefProof(task.taskId.toString(), { reclaimTxHash: reclaimHash });
    }
  }, [reclaimHash, reclaimSuccess, task.taskId]);

  const isFunded = task.status === 0;
  const now = BigInt(Math.floor(Date.now() / 1000));
  const isPastDeadline = task.deadline <= now;
  const settling = settlingPending || settlingConfirming;
  const reclaiming = reclaimPending || reclaimConfirming;

  const error = actionError || settleError || reclaimError;
  const amountLabel = formatTaskAmount(task.amount, task.token);

  return (
    <div className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_20px_60px_-36px_rgba(15,23,42,0.35)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-bold text-slate-950">{brief?.title || task.agentName || `Agent #${task.agentId.toString()}`}</h4>
          <p className="font-mono text-xs text-slate-400">Task #{task.taskId.toString()}</p>
        </div>
        <span className={`text-xs font-semibold ${statusColor(task.status)}`}>{STATUS_LABELS[task.status] ?? "Unknown"}</span>
      </div>

      {brief?.objective && <p className="mb-3 line-clamp-3 text-sm leading-6 text-slate-600">{brief.objective}</p>}

      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-950">{amountLabel}</span>
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <Clock className="h-3 w-3" />
          {isFunded ? deadlineCountdown(task.deadline) : STATUS_LABELS[task.status]}
        </span>
      </div>

      {brief?.acceptanceCriteria && (
        <div className="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          <p className="font-semibold uppercase tracking-[0.16em] text-slate-500">Acceptance criteria</p>
          <p className="mt-1">{brief.acceptanceCriteria}</p>
        </div>
      )}

      {brief?.briefHash && (
        <div className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-500">
          <p className="font-semibold uppercase tracking-[0.16em] text-slate-500">Brief hash</p>
          <p className="mt-1 font-mono text-[11px] text-slate-600">{brief.briefHash}</p>
        </div>
      )}

      <div className="mb-3 flex flex-wrap gap-3">
        <ProofLink label="Funding tx" hash={brief?.fundingTxHash || task.fundingTxHash} />
        <ProofLink label="Settlement tx" hash={brief?.settlementTxHash || settleHash} />
        <ProofLink label="Reclaim tx" hash={brief?.reclaimTxHash || reclaimHash} />
      </div>

      {error && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-red-700">
          <AlertCircle className="h-3 w-3" />
          {(error as Error).message?.slice(0, 100) ?? "Failed"}
        </div>
      )}

      {isFunded && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="accent"
            className="flex-1"
            disabled={settling || reclaiming}
            onClick={() => settleTask(task.taskId)}
          >
            {settling ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Settle
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            disabled={!isPastDeadline || settling || reclaiming}
            onClick={() => reclaimTask(task.taskId)}
          >
            {reclaiming ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            Reclaim
          </Button>
        </div>
      )}
    </div>
  );
}

export function TaskManager() {
  const { isConnected } = useAccount();
  const { tasks, isLoading } = useUserTasks();
  const [briefs, setBriefs] = useState<Record<string, StoredTaskBrief>>({});

  useEffect(() => {
    setBriefs(getAllTaskBriefs());
  }, [tasks.length]);

  if (!isConnected) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/80 py-16 text-center shadow-sm">
        <p className="text-slate-500">Connect your wallet to view live tasks.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading tasks…
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-[28px] border border-dashed border-slate-300 bg-white/80 py-16 text-center shadow-sm">
        <p className="mb-1 text-slate-500">No tasks yet</p>
        <p className="text-xs text-slate-400">Create a task from the marketplace to get started.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tasks.map((task) => (
        <TaskCard key={task.taskId.toString()} task={task} brief={briefs[task.taskId.toString()]} />
      ))}
    </div>
  );
}
