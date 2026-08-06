import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(process.argv[2] || ".");
const inventoryPath = resolve(repoRoot, "docs/oldschool-agent-inventory.json");
const outputPath = resolve(repoRoot, "docs/oldschool-agent-bundle.json");

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));

if (!inventory.ownerAddress) {
  throw new Error("Missing ownerAddress in oldschool-agent-inventory.json");
}

if (inventory.pricing?.amount !== "100" || inventory.pricing?.token !== "USDC" || inventory.pricing?.billingPeriod !== "month") {
  throw new Error("Inventory pricing must stay aligned to 100 USDC / month");
}

const slugify = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const trustedAgents = new Set(["ivy", "clara", "nora", "lyra"]);

const bundle = {
  manifestVersion: 1,
  generatedAt: new Date().toISOString(),
  ownerAddress: inventory.ownerAddress,
  pricing: inventory.pricing,
  sourceInventory: "docs/oldschool-agent-inventory.json",
  agents: inventory.agents.map((agent) => {
    const metadata = {
      name: agent.name,
      description: agent.description,
      targetBuyer: agent.targetBuyer,
      category: agent.category,
      pricingMode: inventory.pricing.mode,
      primaryToken: inventory.pricing.token,
      fixedPriceAmount: inventory.pricing.amount,
      billingPeriod: inventory.pricing.billingPeriod,
      deliveryDescription: agent.deliverable,
      ownerAddress: inventory.ownerAddress,
      domain: agent.domain || undefined,
      mcpEndpoint: agent.mcpEndpoint || undefined,
      a2aEndpoint: agent.a2aEndpoint || undefined,
    };

    return {
      slug: slugify(agent.name),
      ownerAddress: inventory.ownerAddress,
      pricing: inventory.pricing,
      trust: {
        status: trustedAgents.has(slugify(agent.name)) ? "trusted" : "provisional",
        basis: "Ada inventory handoff on 2026-08-06",
      },
      metadata,
      agentURI: JSON.stringify(metadata),
      install: {
        type: "openclaw-session",
        agentId: agent.a2aEndpoint || null,
        importMode: "operator-routed",
      },
    };
  }),
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`);

process.stdout.write(`${outputPath}\n`);
