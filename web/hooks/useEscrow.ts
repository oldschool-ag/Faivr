"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useAccount,
  useReadContract,
  usePublicClient,
} from "wagmi";
import { formatEther, formatUnits, parseUnits, type Address, type Hash, zeroAddress } from "viem";
import { CONTRACTS, ERC20_ABI, FEE_MODULE_ABI, IDENTITY_ABI, USDC_ADDRESS, USDC_DECIMALS } from "@/lib/contracts";
import { parseAgentNameFromURI } from "@/lib/agentMetadata";
import { getTokenConfig } from "@/lib/tokens";

// ── Shared helpers ───────────────────────────────────────

export function formatTaskAmount(amount: bigint, token: Address): string {
  const tokenConfig = getTokenConfig(token);
  if (tokenConfig.symbol === "ETH") {
    return `${formatEther(amount)} ETH`;
  }

  return `${formatUnits(amount, tokenConfig.decimals)} ${tokenConfig.symbol}`;
}

function extractTaskIdFromReceipt(receipt?: { logs?: { topics?: readonly Hash[] }[] }): bigint | undefined {
  const topic = receipt?.logs?.find((log) => log.topics?.[0] === TASK_FUNDED_TOPIC)?.topics?.[1];
  return topic ? BigInt(topic) : undefined;
}

// ── Fund Task (USDC-primary) ─────────────────────────────

const TASK_FUNDED_EVENT = {
  type: "event" as const,
  name: "TaskFunded" as const,
  inputs: [
    { name: "taskId", type: "uint256" as const, indexed: true },
    { name: "agentId", type: "uint256" as const, indexed: true },
    { name: "client", type: "address" as const, indexed: true },
    { name: "token", type: "address" as const, indexed: false },
    { name: "amount", type: "uint256" as const, indexed: false },
    { name: "deadline", type: "uint256" as const, indexed: false },
  ],
} as const;

const TASK_FUNDED_TOPIC =
  "0xe471f4f221d47ea06b05119c1d26ec31e34df7f721f8db6ac85ef4c1412406b8" as Hash;

type FundTaskArgs = {
  agentId: number;
  amount: string;
  deadlineSeconds: number;
};

export function useFundTaskUSDC({ agentId, amount, deadlineSeconds }: FundTaskArgs) {
  const { address } = useAccount();
  const [mode, setMode] = useState<"approve" | "fund">("approve");

  const parsedAmount = useMemo(() => {
    const numeric = Number.parseFloat(amount);
    if (!Number.isFinite(numeric) || numeric <= 0) return BigInt(0);

    try {
      return parseUnits(amount, USDC_DECIMALS);
    } catch {
      return BigInt(0);
    }
  }, [amount]);

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: address ? [address, CONTRACTS.feeModule] : undefined,
    query: { enabled: !!address && parsedAmount > BigInt(0) },
  });

  const currentAllowance = (allowanceData as bigint | undefined) ?? BigInt(0);
  const needsApproval = parsedAmount > BigInt(0) && currentAllowance < parsedAmount;

  const {
    writeContract,
    data: hash,
    isPending,
    error,
    reset,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess,
  } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess && mode === "approve") {
      void refetchAllowance();
      setMode("fund");
    }
  }, [isSuccess, mode, refetchAllowance]);

  const approve = useCallback(() => {
    if (!address || parsedAmount <= BigInt(0)) return;
    setMode("approve");
    writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.feeModule, parsedAmount],
    });
  }, [address, parsedAmount, writeContract]);

  const fundTask = useCallback(() => {
    if (parsedAmount <= BigInt(0)) return;
    setMode("fund");
    writeContract({
      address: CONTRACTS.feeModule,
      abi: FEE_MODULE_ABI,
      functionName: "fundTask",
      args: [BigInt(agentId), USDC_ADDRESS, parsedAmount, BigInt(deadlineSeconds)],
    });
  }, [agentId, deadlineSeconds, parsedAmount, writeContract]);

  return {
    approve,
    fundTask,
    hash,
    receipt,
    taskId: extractTaskIdFromReceipt(receipt),
    currentAllowance,
    needsApproval,
    isPending,
    isConfirming,
    isSuccess: !!receipt && mode === "fund",
    isApprovingSuccess: !!receipt && mode === "approve",
    error,
    reset,
  };
}

// ── Settle Task ────────────────────────────────────────────

export function useSettleTask() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  const settleTask = useCallback(
    (taskId: bigint) => {
      writeContract({
        address: CONTRACTS.feeModule,
        abi: FEE_MODULE_ABI,
        functionName: "settleTask",
        args: [taskId],
      });
    },
    [writeContract],
  );

  return { settleTask, hash, receipt, isPending, isConfirming, isSuccess: !!receipt, error, reset };
}

// ── Reclaim Task ───────────────────────────────────────────

export function useReclaimTask() {
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { data: receipt, isLoading: isConfirming } = useWaitForTransactionReceipt({ hash });

  const reclaimTask = useCallback(
    (taskId: bigint) => {
      writeContract({
        address: CONTRACTS.feeModule,
        abi: FEE_MODULE_ABI,
        functionName: "reclaimTask",
        args: [taskId],
      });
    },
    [writeContract],
  );

  return { reclaimTask, hash, receipt, isPending, isConfirming, isSuccess: !!receipt, error, reset };
}

// ── Task type ──────────────────────────────────────────────

export interface TaskInfo {
  taskId: bigint;
  agentId: bigint;
  client: Address;
  token: Address;
  amount: bigint;
  status: number;
  fundedAt: bigint;
  settledAt: bigint;
  deadline: bigint;
  agentName?: string;
  fundingTxHash?: Hash;
}

const STATUS_LABELS = ["Funded", "Settled", "Reclaimed"] as const;
export { STATUS_LABELS };

type TaskTuple = readonly [bigint, Address, Address, bigint, number, bigint, bigint, bigint];

// ── Read single task ───────────────────────────────────────

export function useTask(taskId: bigint | undefined) {
  const { data, isLoading } = useReadContract({
    address: CONTRACTS.feeModule,
    abi: FEE_MODULE_ABI,
    functionName: "getTask",
    args: taskId !== undefined ? [taskId] : undefined,
    query: { enabled: taskId !== undefined },
  });

  const task: TaskInfo | undefined = data
    ? (() => {
        const d = data as unknown as TaskTuple;
        return {
          taskId: taskId!,
          agentId: d[0],
          client: d[1],
          token: d[2],
          amount: d[3],
          status: d[4],
          fundedAt: d[5],
          settledAt: d[6],
          deadline: d[7],
        };
      })()
    : undefined;

  return { task, isLoading };
}

// ── Read user tasks from events ────────────────────────────

export function useUserTasks() {
  const { address } = useAccount();
  const client = usePublicClient();
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!address || !client) {
      setTasks([]);
      return;
    }

    const publicClient = client;
    let cancelled = false;

    async function fetchTasks() {
      setIsLoading(true);
      try {
        const logs = await publicClient.getLogs({
          address: CONTRACTS.feeModule,
          event: TASK_FUNDED_EVENT,
          args: { client: address },
          fromBlock: BigInt(0),
          toBlock: "latest",
        });

        if (cancelled) return;

        const taskInfos: TaskInfo[] = [];
        for (const log of logs) {
          const taskId = log.args.taskId;
          if (taskId === undefined) continue;

          try {
            const data = await publicClient.readContract({
              address: CONTRACTS.feeModule,
              abi: FEE_MODULE_ABI,
              functionName: "getTask",
              args: [taskId],
            });

            const d = data as unknown as TaskTuple;

            let agentName: string | undefined;
            try {
              const uri = await publicClient.readContract({
                address: CONTRACTS.identity,
                abi: IDENTITY_ABI,
                functionName: "tokenURI",
                args: [d[0]],
              });
              if (typeof uri === "string") {
                agentName = parseAgentNameFromURI(uri);
              }
            } catch {
              // ignore agent metadata parse failure
            }

            taskInfos.push({
              taskId,
              agentId: d[0],
              client: d[1],
              token: d[2],
              amount: d[3],
              status: d[4],
              fundedAt: d[5],
              settledAt: d[6],
              deadline: d[7],
              agentName,
              fundingTxHash: log.transactionHash,
            });
          } catch {
            // skip bad tasks
          }
        }

        if (!cancelled) {
          const sorted = taskInfos.sort((a, b) => Number(b.fundedAt - a.fundedAt));
          setTasks(sorted);
        }
      } catch {
        // swallow
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchTasks();
    return () => {
      cancelled = true;
    };
  }, [address, client]);

  return { tasks, isLoading, count: tasks.filter((t) => t.status === 0).length };
}

export { formatEther, formatUnits, zeroAddress, USDC_ADDRESS };
