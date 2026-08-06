"use client";

import { useEffect, useMemo, useState } from "react";
import { usePublicClient, useReadContracts } from "wagmi";
import { CONTRACTS, REPUTATION_ABI, VALIDATION_ABI, VERIFICATION_ABI } from "@/lib/contracts";

const TASK_SETTLEMENT_RECORDED_EVENT = {
  type: "event" as const,
  name: "TaskSettlementRecorded" as const,
  inputs: [
    { name: "taskId", type: "uint256" as const, indexed: true },
    { name: "agentId", type: "uint256" as const, indexed: true },
    { name: "clientAddress", type: "address" as const, indexed: true },
  ],
} as const;

const NEW_FEEDBACK_EVENT = {
  type: "event" as const,
  name: "NewFeedback" as const,
  inputs: [
    { name: "agentId", type: "uint256" as const, indexed: true },
    { name: "clientAddress", type: "address" as const, indexed: true },
    { name: "feedbackIndex", type: "uint64" as const, indexed: false },
    { name: "value", type: "int128" as const, indexed: false },
    { name: "valueDecimals", type: "uint8" as const, indexed: false },
    { name: "indexedTag1", type: "string" as const, indexed: true },
    { name: "tag1", type: "string" as const, indexed: false },
    { name: "tag2", type: "string" as const, indexed: false },
    { name: "endpoint", type: "string" as const, indexed: false },
    { name: "feedbackURI", type: "string" as const, indexed: false },
    { name: "feedbackHash", type: "bytes32" as const, indexed: false },
  ],
} as const;

export type AgentTrustState = {
  verificationDomain?: string;
  verificationMethod?: string;
  verificationExpiresAt?: bigint;
  validationCount: number;
  validationAverage?: number;
  settledTaskCount: number;
  feedbackCount: number;
  feedbackAverage?: number;
  isLoading: boolean;
};

function methodLabel(method?: bigint | number): string | undefined {
  if (method === undefined) return undefined;
  const numeric = Number(method);
  if (numeric === 0) return "DNS";
  if (numeric === 1) return "File";
  if (numeric === 2) return "Social";
  return "Verification";
}

export function useAgentTrust(agentId: number, enabled = true): AgentTrustState {
  const client = usePublicClient();
  const [settledTaskCount, setSettledTaskCount] = useState(0);
  const [feedbackCount, setFeedbackCount] = useState(0);
  const [isLogLoading, setIsLogLoading] = useState(false);

  const contracts = useMemo(() => {
    if (!enabled) return [];
    return [
      {
        address: CONTRACTS.verification,
        abi: VERIFICATION_ABI,
        functionName: "getVerification" as const,
        args: [BigInt(agentId)] as const,
      },
      {
        address: CONTRACTS.validation,
        abi: VALIDATION_ABI,
        functionName: "getSummary" as const,
        args: [BigInt(agentId), [], ""] as const,
      },
      {
        address: CONTRACTS.reputation,
        abi: REPUTATION_ABI,
        functionName: "getSummary" as const,
        args: [BigInt(agentId), [], "", ""] as const,
      },
    ];
  }, [agentId, enabled]);

  const { data, isLoading: isContractLoading } = useReadContracts({
    contracts,
    query: { enabled },
  });

  useEffect(() => {
    if (!enabled || !client) return;

    const publicClient = client;
    let cancelled = false;

    async function loadLogs() {
      setIsLogLoading(true);
      try {
        const [settlementLogs, feedbackLogs] = await Promise.all([
          publicClient.getLogs({
            address: CONTRACTS.reputation,
            event: TASK_SETTLEMENT_RECORDED_EVENT,
            args: { agentId: BigInt(agentId) },
            fromBlock: BigInt(0),
            toBlock: "latest",
          }),
          publicClient.getLogs({
            address: CONTRACTS.reputation,
            event: NEW_FEEDBACK_EVENT,
            args: { agentId: BigInt(agentId) },
            fromBlock: BigInt(0),
            toBlock: "latest",
          }),
        ]);

        if (cancelled) return;
        setSettledTaskCount(settlementLogs.length);
        setFeedbackCount(feedbackLogs.length);
      } catch {
        if (!cancelled) {
          setSettledTaskCount(0);
          setFeedbackCount(0);
        }
      } finally {
        if (!cancelled) setIsLogLoading(false);
      }
    }

    void loadLogs();
    return () => {
      cancelled = true;
    };
  }, [agentId, client, enabled]);

  const verification = data?.[0]?.status === "success"
    ? (data[0].result as unknown as readonly [string, number, bigint, bigint, boolean, bigint])
    : undefined;

  const validationSummary = data?.[1]?.status === "success"
    ? (data[1].result as unknown as readonly [bigint, number])
    : undefined;
  const feedbackSummary = data?.[2]?.status === "success"
    ? (data[2].result as unknown as readonly [bigint, bigint, number])
    : undefined;

  const summaryFeedbackCount = feedbackSummary ? Number(feedbackSummary[0]) : 0;
  const feedbackAverage =
    feedbackSummary && summaryFeedbackCount > 0
      ? Number(feedbackSummary[1]) / Math.pow(10, feedbackSummary[2])
      : undefined;

  return {
    verificationDomain: verification?.[4] ? verification[0] : undefined,
    verificationMethod: verification?.[4] ? methodLabel(verification[1]) : undefined,
    verificationExpiresAt: verification?.[4] ? verification[3] : undefined,
    validationCount: validationSummary ? Number(validationSummary[0]) : 0,
    validationAverage: validationSummary && Number(validationSummary[0]) > 0 ? Number(validationSummary[1]) : undefined,
    settledTaskCount,
    feedbackCount: summaryFeedbackCount || feedbackCount,
    feedbackAverage,
    isLoading: isContractLoading || isLogLoading,
  };
}
