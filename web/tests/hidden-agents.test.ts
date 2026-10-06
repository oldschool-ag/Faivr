import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const NOT_FOUND = vi.hoisted(() => new Error("NEXT_NOT_FOUND (test sentinel)"));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw NOT_FOUND;
  },
}));
vi.mock("@/components/agent/AgentDetailView", () => ({
  AgentDetailView: (props: { agentId: number }) => ({ type: "AgentDetailView", props }),
}));

import { HIDDEN_REGISTRY_AGENTS, HIDDEN_REGISTRY_AGENT_IDS, isHiddenAgentId, visibleAgentCount, withoutHiddenAgents } from "@/lib/hiddenAgents";
import { assembleRegistryAgents } from "@/lib/registryAgents";
import AgentWorkflowPage from "@/app/marketplace/[agentId]/page";
import { GET as verifyStatus } from "@/app/api/verify/status/[agentId]/route";
import { OLD_SCHOOL_TRUSTED_AGENTS } from "@/data/oldschoolTrustedInventory";

/**
 * F1: registry entries faivr.ai does not show. Hidden by on-chain agent id, never by name;
 * left out of the list, the count, the detail page and the per-agent API; the inventory
 * files carry no Clara entry.
 */

const uri = (name: string, description: string) => `data:application/json;utf8,${encodeURIComponent(JSON.stringify({ name, description, tags: ["DeFi"] }))}`;
const ok = <T,>(result: T) => ({ status: "success" as const, result });

const REGISTRY = {
  count: 4,
  tokenURIs: [
    ok(uri("Ivy", "Marketing and communications agent.")),
    ok(uri("ClaraHacks.com", "DeFi incident intelligence with reproducible technical evidence")),
    ok(uri("Lyra", "FAIVR product and GTM collaboration agent.")),
    ok(uri("ClaraHacks.com", "A later listing under a new id with the same name")),
  ],
  actives: [ok(true), ok(true), ok(true), ok(true)],
  verifications: [ok(false), ok(true), ok(false), ok(false)],
};

describe("the hidden registry entries", () => {
  it("are keyed by on-chain agent id with a note, never by name", () => {
    expect(HIDDEN_REGISTRY_AGENTS.length).toBeGreaterThan(0);
    for (const entry of HIDDEN_REGISTRY_AGENTS) {
      expect(Object.keys(entry).sort()).toEqual(["agentId", "note"]);
      expect(Number.isInteger(entry.agentId) && entry.agentId >= 1).toBe(true);
      expect(entry.note.length).toBeGreaterThan(10);
    }
    expect(HIDDEN_REGISTRY_AGENT_IDS.size).toBe(HIDDEN_REGISTRY_AGENTS.length);
    const source = readFileSync(new URL("../lib/hiddenAgents.ts", import.meta.url), "utf8");
    expect(source).toContain("To show a listing again: delete its line from HIDDEN_REGISTRY_AGENTS");
  });

  it("decide by id: the same name under another id stays visible", () => {
    const hidden = new Set([2]);
    expect(isHiddenAgentId(2, hidden)).toBe(true);
    expect(isHiddenAgentId(4, hidden)).toBe(false);
    expect(isHiddenAgentId(Number.NaN, hidden)).toBe(false);
    const agents = assembleRegistryAgents({ ...REGISTRY, hidden });
    expect(agents.map((agent) => agent.id)).toEqual([1, 3, 4]);
    expect(agents.map((agent) => agent.name)).toEqual(["Ivy", "Lyra", "ClaraHacks.com"]);
    // everything else is untouched: order, flags, descriptions
    expect(agents[2]).toMatchObject({ id: 4, active: true, verified: false, description: "A later listing under a new id with the same name" });
    expect(withoutHiddenAgents(agents, hidden)).toEqual(agents);
    // nothing hidden: the full registry
    expect(assembleRegistryAgents({ ...REGISTRY, hidden: new Set() }).map((agent) => agent.id)).toEqual([1, 2, 3, 4]);
  });

  it("leave the list's search and filters nothing to find", () => {
    const hidden = new Set([2]);
    const agents = assembleRegistryAgents({ ...REGISTRY, hidden });
    const q = "incident intelligence";
    expect(agents.filter((agent) => agent.name.toLowerCase().includes("clarahacks") || agent.description.toLowerCase().includes(q)).map((agent) => agent.id)).toEqual([4]);
    const tags = new Set(agents.flatMap((agent) => agent.tags));
    expect(Array.from(tags)).toEqual(["DeFi"]);
  });

  it("shrink the live-agent count by the hidden ids that exist", () => {
    expect(visibleAgentCount(4, new Set([2]))).toBe(3);
    expect(visibleAgentCount(4, new Set([2, 9]))).toBe(3);
    expect(visibleAgentCount(1, new Set([2]))).toBe(1);
    expect(visibleAgentCount(0, new Set([1]))).toBe(0);
    expect(visibleAgentCount(2, new Set([1, 2]))).toBe(0);
  });

  it("answer not found on the detail page's direct URL", async () => {
    const [hiddenId] = Array.from(HIDDEN_REGISTRY_AGENT_IDS);
    await expect(AgentWorkflowPage({ params: Promise.resolve({ agentId: String(hiddenId) }) })).rejects.toBe(NOT_FOUND);
    await expect(AgentWorkflowPage({ params: Promise.resolve({ agentId: "abc" }) })).rejects.toBe(NOT_FOUND);
    await expect(AgentWorkflowPage({ params: Promise.resolve({ agentId: "0" }) })).rejects.toBe(NOT_FOUND);
    const visibleId = 1;
    expect(HIDDEN_REGISTRY_AGENT_IDS.has(visibleId)).toBe(false);
    const rendered = (await AgentWorkflowPage({ params: Promise.resolve({ agentId: String(visibleId) }) })) as unknown as { props: { agentId: number } };
    expect(rendered.props.agentId).toBe(visibleId);
  });

  it("answer not found on the per-agent API route", async () => {
    const [hiddenId] = Array.from(HIDDEN_REGISTRY_AGENT_IDS);
    const request = (id: string) => new NextRequest(`https://faivr.ai/api/verify/status/${id}`);
    const hidden = await verifyStatus(request(String(hiddenId)), { params: Promise.resolve({ agentId: String(hiddenId) }) });
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "Agent not found" });
    const visible = await verifyStatus(request("1"), { params: Promise.resolve({ agentId: "1" }) });
    expect(visible.status).toBe(200);
    expect(((await visible.json()) as { agentId: string }).agentId).toBe("1");
  });
});

describe("the Old School inventory files", () => {
  const root = new URL("../../", import.meta.url);
  const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8")) as { agents: Array<{ name?: string; slug?: string }> };

  it("carry no Clara entry", () => {
    const names = OLD_SCHOOL_TRUSTED_AGENTS.map((agent) => agent.name);
    expect(names).not.toContain("Clara");
    for (const file of ["docs/oldschool-agent-inventory.json", "docs/oldschool-agent-inventory.trusted.json", "docs/oldschool-agent-bundle.json"]) {
      const text = readFileSync(new URL(file, root), "utf8");
      expect(text.toLowerCase(), file).not.toContain("clara");
    }
  });

  it("stay consistent with each other and with the generated bundle", () => {
    const inventory = read("docs/oldschool-agent-inventory.json").agents.map((agent) => agent.name);
    const trusted = read("docs/oldschool-agent-inventory.trusted.json").agents.map((agent) => agent.name);
    const bundle = read("docs/oldschool-agent-bundle.json").agents.map((agent) => agent.slug);
    expect(inventory.length).toBeGreaterThan(0);
    for (const name of trusted) expect(inventory, `${name} is trusted but not in the inventory`).toContain(name);
    expect(bundle).toEqual(inventory.map((name) => name!.toLowerCase()));
    // the registration flow's list is the trusted inventory
    expect(OLD_SCHOOL_TRUSTED_AGENTS.map((agent) => agent.name)).toEqual(trusted);
  });
});
