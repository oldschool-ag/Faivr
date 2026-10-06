import { useMemo } from "react";
import { useReadContract, useReadContracts } from "wagmi";
import { CONTRACTS, IDENTITY_ABI, VERIFICATION_ABI } from "@/lib/contracts";
import { visibleAgentCount } from "@/lib/hiddenAgents";
import { assembleRegistryAgents } from "@/lib/registryAgents";

/**
 * The live registry listing: every agent of the identity registry on Base, minus the hidden
 * entries of lib/hiddenAgents.ts (F1). `count` is the number of visible agents.
 */
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

  const agents = useMemo(() => assembleRegistryAgents({ count, tokenURIs, actives, verifications }), [actives, count, tokenURIs, verifications]);

  return { agents, isLoading, count: visibleAgentCount(count) };
}
