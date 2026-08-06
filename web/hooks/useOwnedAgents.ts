"use client";

import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { CONTRACTS, IDENTITY_ABI, VERIFICATION_ABI } from "@/lib/contracts";
import { parseAgentMetadata, type ParsedAgentMetadata } from "@/lib/agentMetadata";

const REGISTERED_EVENT = {
  type: "event" as const,
  name: "Registered" as const,
  inputs: [
    { name: "agentId", type: "uint256" as const, indexed: true },
    { name: "agentURI", type: "string" as const, indexed: false },
    { name: "owner", type: "address" as const, indexed: true },
  ],
} as const;

export type OwnedAgent = {
  id: number;
  metadata: ParsedAgentMetadata | null;
  active: boolean;
  verified: boolean;
  registeredAt?: bigint;
};

export function useOwnedAgents() {
  const { address } = useAccount();
  const client = usePublicClient();
  const [agents, setAgents] = useState<OwnedAgent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!address || !client) {
      setAgents([]);
      return;
    }

    const publicClient = client;
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const logs = await publicClient.getLogs({
          address: CONTRACTS.identity,
          event: REGISTERED_EVENT,
          args: { owner: address },
          fromBlock: BigInt(0),
          toBlock: "latest",
        });

        const next: OwnedAgent[] = [];
        for (const log of logs) {
          const agentId = log.args.agentId;
          if (agentId === undefined) continue;
          try {
            const [uri, active, verified, registeredAt] = await Promise.all([
              publicClient.readContract({
                address: CONTRACTS.identity,
                abi: IDENTITY_ABI,
                functionName: "tokenURI",
                args: [agentId],
              }),
              publicClient.readContract({
                address: CONTRACTS.identity,
                abi: IDENTITY_ABI,
                functionName: "isActive",
                args: [agentId],
              }),
              publicClient.readContract({
                address: CONTRACTS.verification,
                abi: VERIFICATION_ABI,
                functionName: "isVerified",
                args: [agentId],
              }),
              publicClient.readContract({
                address: CONTRACTS.identity,
                abi: IDENTITY_ABI,
                functionName: "registeredAt",
                args: [agentId],
              }),
            ]);

            next.push({
              id: Number(agentId),
              metadata: typeof uri === "string" ? parseAgentMetadata(uri) : null,
              active: Boolean(active),
              verified: Boolean(verified),
              registeredAt: typeof registeredAt === "bigint" ? registeredAt : undefined,
            });
          } catch {
            // Skip unreadable agents rather than breaking the dashboard.
          }
        }

        if (!cancelled) {
          setAgents(
            next.sort((a, b) => {
              const aTime = a.registeredAt ?? BigInt(0);
              const bTime = b.registeredAt ?? BigInt(0);
              if (aTime === bTime) return 0;
              return aTime > bTime ? -1 : 1;
            }),
          );
        }
      } catch {
        if (!cancelled) setAgents([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [address, client]);

  return { agents, isLoading };
}
