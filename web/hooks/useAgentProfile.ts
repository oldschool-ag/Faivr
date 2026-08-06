"use client";

import { useMemo } from "react";
import { useReadContracts } from "wagmi";
import { CONTRACTS, IDENTITY_ABI, VERIFICATION_ABI } from "@/lib/contracts";
import { parseAgentMetadata, type ParsedAgentMetadata } from "@/lib/agentMetadata";

export type AgentProfile = {
  id: number;
  metadata: ParsedAgentMetadata | null;
  rawUri?: string;
  owner?: string;
  active?: boolean;
  verified?: boolean;
  registeredAt?: bigint;
};

export function useAgentProfile(agentId: number | undefined) {
  const contracts = useMemo(() => {
    if (!agentId || agentId <= 0) return [];
    const id = BigInt(agentId);
    return [
      {
        address: CONTRACTS.identity,
        abi: IDENTITY_ABI,
        functionName: "tokenURI" as const,
        args: [id] as const,
      },
      {
        address: CONTRACTS.identity,
        abi: IDENTITY_ABI,
        functionName: "ownerOf" as const,
        args: [id] as const,
      },
      {
        address: CONTRACTS.identity,
        abi: IDENTITY_ABI,
        functionName: "isActive" as const,
        args: [id] as const,
      },
      {
        address: CONTRACTS.identity,
        abi: IDENTITY_ABI,
        functionName: "registeredAt" as const,
        args: [id] as const,
      },
      {
        address: CONTRACTS.verification,
        abi: VERIFICATION_ABI,
        functionName: "isVerified" as const,
        args: [id] as const,
      },
    ];
  }, [agentId]);

  const { data, isLoading } = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  });

  const profile = useMemo<AgentProfile | null>(() => {
    if (!agentId || contracts.length === 0) return null;

    const uriResult = data?.[0];
    const ownerResult = data?.[1];
    const activeResult = data?.[2];
    const registeredAtResult = data?.[3];
    const verifiedResult = data?.[4];
    const rawUri = uriResult?.status === "success" && typeof uriResult.result === "string" ? uriResult.result : undefined;

    return {
      id: agentId,
      metadata: rawUri ? parseAgentMetadata(rawUri) : null,
      rawUri,
      owner: ownerResult?.status === "success" && typeof ownerResult.result === "string" ? ownerResult.result : undefined,
      active: activeResult?.status === "success" ? Boolean(activeResult.result) : undefined,
      registeredAt:
        registeredAtResult?.status === "success" && typeof registeredAtResult.result === "bigint"
          ? registeredAtResult.result
          : undefined,
      verified: verifiedResult?.status === "success" ? Boolean(verifiedResult.result) : undefined,
    };
  }, [agentId, contracts.length, data]);

  return { profile, isLoading };
}
