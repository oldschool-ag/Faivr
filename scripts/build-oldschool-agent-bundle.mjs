import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(process.argv[2] || ".");
const inventoryPath = resolve(repoRoot, "docs/oldschool-agent-inventory.json");
const trustedInventoryPath = resolve(repoRoot, "docs/oldschool-agent-inventory.trusted.json");
const outputPath = resolve(repoRoot, "docs/oldschool-agent-bundle.json");

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const trustedInventory = JSON.parse(readFileSync(trustedInventoryPath, "utf8"));

if (!inventory.ownerAddress) {
  throw new Error("Missing ownerAddress in oldschool-agent-inventory.json");
}

if (!inventory.pricing?.mode || !inventory.pricing?.token || !inventory.pricing?.billingPeriod) {
  throw new Error("Inventory default pricing must include mode, token, and billingPeriod");
}

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const trustedAgents = new Set(
  Array.isArray(trustedInventory.agents) ? trustedInventory.agents.map((agent) => slugify(agent.name)) : [],
);

function pricingForAgent(agent) {
  return agent.pricing || inventory.pricing;
}

function trustForAgent(agent) {
  if (agent.trust?.status && agent.trust?.basis) {
    return agent.trust;
  }

  if (trustedAgents.has(slugify(agent.name))) {
    return {
      status: "trusted",
      basis: "Listed in docs/oldschool-agent-inventory.trusted.json",
    };
  }

  return {
    status: "provisional",
    basis: "Listed in docs/oldschool-agent-inventory.json",
  };
}

function installForAgent(agent) {
  if (agent.install) {
    return {
      type: agent.install.type || "openclaw-session",
      agentId: agent.install.agentId || null,
      importMode: agent.install.importMode || "operator-routed",
    };
  }

  return {
    type: "openclaw-session",
    agentId: typeof agent.a2aEndpoint === "string" && agent.a2aEndpoint.startsWith("openai-") ? agent.a2aEndpoint : null,
    importMode: "operator-routed",
  };
}

const bundle = {
  manifestVersion: 1,
  generatedAt: new Date().toISOString(),
  ownerAddress: inventory.ownerAddress,
  pricing: inventory.pricing,
  sourceInventory: "docs/oldschool-agent-inventory.json",
  agents: inventory.agents.map((agent) => {
    const pricing = pricingForAgent(agent);
    const metadata = {
      name: agent.name,
      description: agent.description,
      targetBuyer: agent.targetBuyer,
      category: agent.category,
      pricingMode: pricing.mode,
      primaryToken: pricing.token,
      fixedPriceAmount: pricing.amount,
      billingPeriod: pricing.billingPeriod,
      deliveryDescription: agent.deliverable,
      ownerAddress: inventory.ownerAddress,
      domain: agent.domain || undefined,
      mcpEndpoint: agent.mcpEndpoint || undefined,
      a2aEndpoint: agent.a2aEndpoint || undefined,
    };

    return {
      slug: slugify(agent.name),
      ownerAddress: inventory.ownerAddress,
      pricing,
      trust: trustForAgent(agent),
      metadata,
      agentURI: JSON.stringify(metadata),
      install: installForAgent(agent),
    };
  }),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);

process.stdout.write(`${outputPath}\n`);
