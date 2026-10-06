/**
 * Registry entries faivr.ai does not show (F1, decision of 2026-10-06).
 *
 * The marketplace reads every agent from the on-chain identity registry on Base. An entry
 * listed here is left out of every public surface that reads the registry: the marketplace
 * list and its search and filters, the home page's featured agents, the live-agent count,
 * the detail page (a direct URL answers "not found") and the per-agent API routes. Nothing
 * on the chain changes; the owner still sees the entry in their own wallet dashboard.
 *
 * Entries are keyed by the on-chain agent id (the token id of the identity NFT), never by
 * name, so a future listing under a new id is not hidden by accident.
 *
 * To show a listing again: delete its line from HIDDEN_REGISTRY_AGENTS and merge.
 * To hide another one: add `{ agentId: <id>, note: "<who decided, when, why>" }`.
 */

export type HiddenRegistryAgent = {
  /** The on-chain agent id (identity NFT token id) on Base. */
  agentId: number;
  /** Who decided, when, and why; never the listing's content. */
  note: string;
};

export const HIDDEN_REGISTRY_AGENTS: ReadonlyArray<HiddenRegistryAgent> = [
  // "ClaraHacks.com" belongs to the partner D23E; FAIVR shows it again when D23E publishes it themselves (CEO, 2026-10-06).
  { agentId: 2, note: "D23E's ClaraHacks listing; hidden until D23E publishes it again (CEO decision 2026-10-06)" },
];

export const HIDDEN_REGISTRY_AGENT_IDS: ReadonlySet<number> = new Set(HIDDEN_REGISTRY_AGENTS.map((entry) => entry.agentId));

export function isHiddenAgentId(agentId: number, hidden: ReadonlySet<number> = HIDDEN_REGISTRY_AGENT_IDS): boolean {
  return Number.isInteger(agentId) && hidden.has(agentId);
}

/** The registry entries without the hidden ones; order and everything else unchanged. */
export function withoutHiddenAgents<T extends { id: number }>(agents: ReadonlyArray<T>, hidden: ReadonlySet<number> = HIDDEN_REGISTRY_AGENT_IDS): T[] {
  return agents.filter((agent) => !isHiddenAgentId(agent.id, hidden));
}

/** The registry's agent count minus the hidden ids that exist in it (ids are 1..count). */
export function visibleAgentCount(agentCount: number, hidden: ReadonlySet<number> = HIDDEN_REGISTRY_AGENT_IDS): number {
  if (!Number.isFinite(agentCount) || agentCount <= 0) return 0;
  let hiddenWithinCount = 0;
  for (const id of Array.from(hidden)) if (id >= 1 && id <= agentCount) hiddenWithinCount += 1;
  return Math.max(0, agentCount - hiddenWithinCount);
}
