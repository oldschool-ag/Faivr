import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(process.argv[2] || ".");
const specArg = process.argv[3];

if (!specArg) {
  throw new Error("Usage: node scripts/import-oldschool-agent-spec.mjs <repo-root> <spec-path>");
}

const inventoryPath = resolve(repoRoot, "docs/oldschool-agent-inventory.json");
const trustedInventoryPath = resolve(repoRoot, "docs/oldschool-agent-inventory.trusted.json");
const specPath = resolve(repoRoot, specArg);

const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const trustedInventory = JSON.parse(readFileSync(trustedInventoryPath, "utf8"));
const spec = JSON.parse(readFileSync(specPath, "utf8"));

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing required string: ${field}`);
  }

  return value.trim();
}

function optionalString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePricing(value) {
  if (value == null) {
    return undefined;
  }

  const mode = requiredString(value.mode, "pricing.mode");
  const token = requiredString(value.token, "pricing.token");
  const billingPeriod = requiredString(value.billingPeriod, "pricing.billingPeriod");
  const amount =
    value.amount == null || value.amount === ""
      ? undefined
      : typeof value.amount === "number"
        ? value.amount.toString()
        : requiredString(value.amount, "pricing.amount");

  if (mode.toLowerCase().includes("fixed") && !amount) {
    throw new Error("Fixed-price agent specs must include pricing.amount");
  }

  return { mode, amount, token, billingPeriod };
}

function normalizeTrust(value) {
  if (value == null) {
    return undefined;
  }

  const status = requiredString(value.status, "trust.status");

  if (status !== "trusted" && status !== "provisional") {
    throw new Error("trust.status must be `trusted` or `provisional`");
  }

  return {
    status,
    basis: requiredString(value.basis, "trust.basis"),
  };
}

function normalizeInstall(value, a2aEndpoint) {
  if (value == null) {
    return typeof a2aEndpoint === "string" && a2aEndpoint.startsWith("openai-")
      ? {
          type: "openclaw-session",
          agentId: a2aEndpoint,
          importMode: "operator-routed",
        }
      : undefined;
  }

  return {
    type: optionalString(value.type) || "openclaw-session",
    agentId: optionalString(value.agentId) || null,
    importMode: optionalString(value.importMode) || "operator-routed",
  };
}

function upsertByName(list, entry) {
  const index = list.findIndex((item) => item.name === entry.name);

  if (index >= 0) {
    list[index] = entry;
    return;
  }

  list.push(entry);
}

function removeByName(list, name) {
  const index = list.findIndex((item) => item.name === name);

  if (index >= 0) {
    list.splice(index, 1);
  }
}

const name = requiredString(spec.name, "name");
const inventoryEntry = {
  name,
  description: requiredString(spec.description, "description"),
  targetBuyer: requiredString(spec.targetBuyer, "targetBuyer"),
  deliverable: requiredString(spec.deliverable, "deliverable"),
  category: requiredString(spec.category, "category"),
  mcpEndpoint: optionalString(spec.mcpEndpoint),
  a2aEndpoint: optionalString(spec.a2aEndpoint),
  domain: optionalString(spec.domain),
};

const pricing = normalizePricing(spec.pricing);
const trust = normalizeTrust(spec.trust);
const install = normalizeInstall(spec.install, inventoryEntry.a2aEndpoint);

if (pricing) {
  inventoryEntry.pricing = pricing;
}

if (trust) {
  inventoryEntry.trust = trust;
}

if (install) {
  inventoryEntry.install = install;
}

upsertByName(inventory.agents, inventoryEntry);

const trustedEntry = {
  name,
  description: inventoryEntry.description,
  targetBuyer: inventoryEntry.targetBuyer,
  deliverable: inventoryEntry.deliverable,
  category: inventoryEntry.category,
  mcpEndpoint: inventoryEntry.mcpEndpoint,
  a2aEndpoint: inventoryEntry.a2aEndpoint,
  domain: inventoryEntry.domain,
};

if (pricing) {
  trustedEntry.pricing = pricing;
}

if (trust?.status === "trusted") {
  upsertByName(trustedInventory.agents, trustedEntry);
} else {
  removeByName(trustedInventory.agents, name);
}

writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
writeFileSync(trustedInventoryPath, `${JSON.stringify(trustedInventory, null, 2)}\n`);

process.stdout.write(`${inventoryPath}\n${trustedInventoryPath}\n`);
