import { useReadContract } from "wagmi";
import { CONTRACTS, FEE_MODULE_ABI, IDENTITY_ABI } from "@/lib/contracts";
import { visibleAgentCount } from "@/lib/hiddenAgents";

export function useContractStats() {
  const { data: agentCount } = useReadContract({
    address: CONTRACTS.identity,
    abi: IDENTITY_ABI,
    functionName: "agentCount",
  });

  const { data: feePercentage } = useReadContract({
    address: CONTRACTS.feeModule,
    abi: FEE_MODULE_ABI,
    functionName: "feePercentage",
  });

  const parsedFee = feePercentage ? `${Number(feePercentage) / 100}%` : "—";

  return {
    // F1: the count the site shows leaves out the hidden registry entries (lib/hiddenAgents.ts)
    agentCount: visibleAgentCount(agentCount ? Number(agentCount) : 0),
    protocolFee: parsedFee,
    liveContracts: 6,
    network: "Base mainnet",
    isLoading: false,
  };
}
