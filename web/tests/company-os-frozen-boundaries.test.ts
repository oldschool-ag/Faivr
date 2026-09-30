import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMPANY_OS_BILLING_WEBHOOKS, COMPANY_OS_STORE_ENDPOINTS } from "@/lib/companyOs/contract";

/**
 * CEO decision 2026-09-29: FAIVR is the Truchsess store for the next 12 months. Escrow,
 * per-task payment, task-based reputation and x402 are frozen; nothing behind the
 * lifecycle API touches the chain, the fee module or the router. This test walks the
 * import graph of every lifecycle and store module and fails if any path reaches them.
 */

const webRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const ROOTS = ["app/api/company-os", "lib/companyOs", "app/store", "instrumentation.ts"];
const FORBIDDEN_MODULES = [/^viem(\/|$)/, /^wagmi(\/|$)/, /^ethers(\/|$)/, /^@wagmi\//, /^@rainbow-me\//];
const FORBIDDEN_FILES = [/^lib\/contracts\.ts$/, /^lib\/wagmi\.ts$/, /^hooks\/useEscrow/, /^components\/escrow\//, /^hooks\/useAgent/, /^hooks\/useContractStats/, /^hooks\/useOwnedAgents/];
const FORBIDDEN_TOKENS = [/\bescrow\b/i, /\bx402\b/i, /FaivrRouter/, /FaivrFeeModule/, /feeModule/, /mainnet\.base\.org/, /useWriteContract/, /CHAIN_ID/, /\bUSDC\b/];

function walk(dir: string, out: string[] = []) {
  if (statSync(dir).isFile()) {
    out.push(dir);
    return out;
  }
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(path);
  }
  return out;
}

/** Code only: a comment may name what the code must not touch. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

function imports(source: string): string[] {
  const found: string[] = [];
  for (const match of Array.from(source.matchAll(/(?:import|export)\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']|import\(["']([^"']+)["']\)|require\(["']([^"']+)["']\)/g))) found.push(match[1] ?? match[2] ?? match[3]);
  return found;
}

function resolveImport(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(webRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(fromFile), specifier);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx")]) if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return null;
}

function reachableFrom(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const specifier of imports(readFileSync(entry, "utf8"))) {
    const target = resolveImport(entry, specifier);
    if (target) reachableFrom(target, seen);
  }
  return seen;
}

describe("the lifecycle API is frozen off the chain", () => {
  const entries = ROOTS.flatMap((root) => walk(join(webRoot, root)));
  it("has lifecycle and store modules to check", () => expect(entries.length).toBeGreaterThan(10));

  for (const entry of entries) {
    const relativeEntry = relative(webRoot, entry);
    it(`${relativeEntry} imports no chain client and no escrow module, directly or transitively`, () => {
      const seen = reachableFrom(entry);
      for (const file of Array.from(seen)) {
        const source = readFileSync(file, "utf8");
        const rel = relative(webRoot, file);
        for (const specifier of imports(source)) for (const pattern of FORBIDDEN_MODULES) expect(specifier, `${rel} imports ${specifier}`).not.toMatch(pattern);
        for (const pattern of FORBIDDEN_FILES) expect(rel, `${relativeEntry} reaches ${rel}`).not.toMatch(pattern);
        if (ROOTS.some((root) => rel.startsWith(root))) for (const pattern of FORBIDDEN_TOKENS) expect(stripComments(source), `${rel} mentions ${pattern}`).not.toMatch(pattern);
      }
    });
  }

  it("keeps the billing providers (T6b.1) behind the same walls", () => {
    // the provider layer exists, both implementations are reachable only through it, and the walk above covered them
    const billingDir = join(webRoot, "lib/companyOs/billing");
    const files = walk(billingDir).map((file) => relative(webRoot, file)).sort();
    expect(files).toEqual(["lib/companyOs/billing/config.ts", "lib/companyOs/billing/events.ts", "lib/companyOs/billing/index.ts", "lib/companyOs/billing/polar.ts", "lib/companyOs/billing/provider.ts", "lib/companyOs/billing/stripe.ts"]);
    expect(entries.some((entry) => entry.startsWith(billingDir))).toBe(true);
    // the store handlers and the uninstall receipt never name a provider module directly: only the interface
    const handlers = readFileSync(join(webRoot, "app/api/company-os/v1/storeHandlers.ts"), "utf8");
    expect(handlers).not.toMatch(/billing\/(polar|stripe)"/);
    expect(handlers).toContain('from "@/lib/companyOs/billing"');
    // one webhook route per provider, each reachable only with its provider's verification
    for (const [name, endpoint] of Object.entries(COMPANY_OS_BILLING_WEBHOOKS)) {
      const path = join(webRoot, "app", endpoint.split(" ")[1].replace(/^\//, ""), "route.ts");
      expect(existsSync(path), endpoint).toBe(true);
      const source = readFileSync(path, "utf8");
      expect(source, name).toContain("parseWebhook(");
      expect(source, name).toContain("company_os_webhook_events");
      expect(source, name).toContain("applyBillingEvent(");
    }
    // no provider module knows the chain or the SDKs' wallet helpers
    const polar = readFileSync(join(billingDir, "polar.ts"), "utf8");
    expect(imports(polar).filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("@/"))).toEqual(["@polar-sh/sdk/2026-10"]);
  });

  it("lints those directories with the same restriction", () => {
    const config = readFileSync(join(webRoot, "eslint.config.mjs"), "utf8");
    expect(config).toContain('"app/api/company-os/**/*.ts"');
    expect(config).toContain('"lib/companyOs/**/*.ts"');
    for (const name of ["viem", "wagmi", "ethers", "@/lib/contracts", "@/lib/wagmi"]) expect(config).toContain(`name: "${name}"`);
  });

  it("ships a route file for every store endpoint and nothing public", () => {
    for (const endpoint of COMPANY_OS_STORE_ENDPOINTS) {
      const path = endpoint.split(" ")[1].replace("/api/company-os/v1/", "");
      expect(existsSync(join(webRoot, "app/api/company-os/v1", path, "route.ts")), endpoint).toBe(true);
    }
    // every store route but enrolment is behind the appliance signature
    const handlers = readFileSync(join(webRoot, "app/api/company-os/v1/storeHandlers.ts"), "utf8");
    const signedHandlers = ["storeCatalog", "storeCheckoutSessions", "storeSubscriptions", "storeSubscriptionCancel", "storeInstallations"];
    for (const name of signedHandlers) {
      const body = handlers.slice(handlers.indexOf(`export async function ${name}(`));
      expect(body.indexOf("authenticatedJson(req)"), name).toBeGreaterThan(0);
      expect(body.indexOf("authenticatedJson(req)")).toBeLessThan(body.indexOf("try {"));
    }
    // no review, rating or public listing surface exists for the store
    for (const file of walk(join(webRoot, "app/api/company-os"))) expect(stripComments(readFileSync(file, "utf8")), relative(webRoot, file)).not.toMatch(/\breviews?\b|\bratings?\b|\bpublic_listing\b/i);
  });
});
