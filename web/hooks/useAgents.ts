import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { CONTRACTS, IDENTITY_ABI, VERIFICATION_ABI } from "@/lib/contracts";
import { parseAgentMetadata } from "@/lib/agentMetadata";
import type { AgentData } from "@/components/agent/AgentCard";

function parseAgentURI(uri: string, id: number): AgentData {
  const parsed = parseAgentMetadata(uri);

  if (!parsed) {
    return {
      id,
      name: `Agent #${id}`,
      description: uri.slice(0, 220),
      rating: 0,
      reviews: 0,
      tags: [],
      validated: false,
      verified: false,
      active: true,
      isExample: false,
    };
  }

  return {
    id,
    name: parsed.name || `Agent #${id}`,
    description: parsed.description || "",
    rating: 0,
    reviews: 0,
    tags: parsed.tags,
    validated: Boolean(parsed.validated),
    verified: false,
    active: true,
    pricingMode: parsed.pricingMode,
    primaryToken: parsed.primaryToken,
    deliveryDescription: parsed.deliveryDescription,
    isExample: false,
  };
}

export function useAgents() {
  const { data: agentCount, isLoading } = useReadContract({
    address: CONTRACTS.identity,
    abi: IDENTITY_ABI,
    functionName: "agentCount",
  });

  const count = agentCount ? Number(agentCount) : 0;

  const tokenURICalls = useMemo(() => {
    if (count === 0) return [];
    return Array.from({ length: count }, (_, i) => ({
      address: CONTRACTS.identity,
      abi: IDENTITY_ABI,
      functionName: "tokenURI" as const,
      args: [BigInt(i + 1)] as const,
    }));
  }, [count]);

  const activeCalls = useMemo(() => {
    if (count === 0) return [];
    return Array.from({ length: count }, (_, i) => ({
      address: CONTRACTS.identity,
      abi: IDENTITY_ABI,
      functionName: "isActive" as const,
      args: [BigInt(i + 1)] as const,
    }));
  }, [count]);

  const verificationCalls = useMemo(() => {
    if (count === 0) return [];
    return Array.from({ length: count }, (_, i) => ({
      address: CONTRACTS.verification,
      abi: VERIFICATION_ABI,
      functionName: "isVerified" as const,
      args: [BigInt(i + 1)] as const,
    }));
  }, [count]);

  const { data: tokenURIs } = useReadContracts({
    contracts: tokenURICalls,
    query: { enabled: count > 0 },
  });

  const { data: actives } = useReadContracts({
    contracts: activeCalls,
    query: { enabled: count > 0 },
  });

  const { data: verifications } = useReadContracts({
    contracts: verificationCalls,
    query: { enabled: count > 0 },
  });

  const agents = useMemo(() => {
    if (count === 0 || !tokenURIs) return [];

    const onChainAgents: AgentData[] = [];
    for (let i = 0; i < tokenURIs.length; i++) {
      const result = tokenURIs[i];
      if (result.status !== "success" || typeof result.result !== "string") continue;

      const agent = parseAgentURI(result.result, i + 1);
      const activeResult = actives?.[i];
      const verificationResult = verifications?.[i];

      agent.active = activeResult?.status === "success" ? Boolean(activeResult.result) : true;
      agent.verified = verificationResult?.status === "success" ? Boolean(verificationResult.result) : false;
      onChainAgents.push(agent);
    }

    return onChainAgents;
  }, [actives, count, tokenURIs, verifications]);

  return { agents, isLoading, count };
}
