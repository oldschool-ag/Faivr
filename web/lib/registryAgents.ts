import { parseAgentMetadata } from "@/lib/agentMetadata";
import { withoutHiddenAgents } from "@/lib/hiddenAgents";
import type { AgentData } from "@/components/agent/AgentCard";

/**
 * Turning the identity registry's raw reads (one tokenURI, isActive and isVerified per id,
 * ids 1..count) into the marketplace's agent rows. Pure, so the list surface can be tested
 * without a chain: the hooks only fetch and hand the results here.
 */

export type ContractReadResult<T> = { status: "success"; result: T } | { status: "failure"; error?: unknown; result?: undefined };

export function parseAgentURI(uri: string, id: number): AgentData {
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
    fixedPriceAmount: parsed.fixedPriceAmount,
    billingPeriod: parsed.billingPeriod,
    deliveryDescription: parsed.deliveryDescription,
    targetBuyer: parsed.targetBuyer,
    domain: parsed.domain,
    isExample: false,
  };
}

/**
 * The public listing: every readable registry entry in id order, with its active and
 * verified flags, minus the hidden entries (lib/hiddenAgents.ts).
 */
export function assembleRegistryAgents(input: {
  count: number;
  tokenURIs: ReadonlyArray<ContractReadResult<unknown>> | undefined;
  actives?: ReadonlyArray<ContractReadResult<unknown>>;
  verifications?: ReadonlyArray<ContractReadResult<unknown>>;
  hidden?: ReadonlySet<number>;
}): AgentData[] {
  if (input.count === 0 || !input.tokenURIs) return [];

  const onChainAgents: AgentData[] = [];
  for (let i = 0; i < input.tokenURIs.length; i++) {
    const result = input.tokenURIs[i];
    if (result.status !== "success" || typeof result.result !== "string") continue;

    const agent = parseAgentURI(result.result, i + 1);
    const activeResult = input.actives?.[i];
    const verificationResult = input.verifications?.[i];

    agent.active = activeResult?.status === "success" ? Boolean(activeResult.result) : true;
    agent.verified = verificationResult?.status === "success" ? Boolean(verificationResult.result) : false;
    onChainAgents.push(agent);
  }

  return withoutHiddenAgents(onChainAgents, input.hidden);
}
