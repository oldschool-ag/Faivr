import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({ functions: [] as unknown[] }));
vi.mock("@/lib/publicCatalog", () => ({
  getPublicCatalog: async () => catalog.functions,
  getPublicCatalogState: async () => ({ functions: catalog.functions, unavailable: false }),
}));
vi.mock("@/components/layout/SiteShell", () => ({ SiteShell: ({ children }: { children: ReactNode }) => children }));

import HomePage from "@/app/page";
import AgentPage from "@/app/agents/[agent]/page";
import { verifiedSslOptions } from "@/lib/postgres";

const worker = (id: string, name: string) => ({ id, slug: name.toLowerCase().replaceAll(" ", "-"), name, role: "", version: "1.0.0", publisherName: "Old School GmbH", publisherKeyId: "key", digest: "sha256:test", permissions: [], slots: [] });
const face = { url: "https://faivr.ai/api/company-os/v1/catalog-images/sha.webp", sha256: "sha256:test", width: 64, height: 64, mediaType: "image/webp" as const };

describe("F15 public-function presentation", () => {
  it("shows all public functions in CEO order, faces or letters, and the right preparation count", async () => {
    catalog.functions = [
      { slug: "pricing-and-business-models", name: "Pricing and business models", description: "", monthlyPriceCents: 14900, currency: "chf", image: null, workers: [worker("pricing", "Cora")] },
      { slug: "company-mail", name: "Company mail", description: "", monthlyPriceCents: 14900, currency: "chf", image: face, workers: [worker("mail", "Penn")] },
      { slug: "product-ownership", name: "Product ownership", description: "", monthlyPriceCents: 14900, currency: "chf", image: null, workers: [worker("owner", "Product Owner")] },
      { slug: "marketing-planning", name: "Marketing planning", description: "", monthlyPriceCents: 14900, currency: "chf", image: null, workers: [worker("marketing", "Ivy")] },
    ];
    const html = renderToStaticMarkup(await HomePage());
    const positions = ["Company mail", "Product ownership", "Marketing planning", "Pricing and business models"].map((name) => html.indexOf(name));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain("Company mail agent face");
    expect(html).toContain("Product ownership agent face unavailable");
    expect(html).toContain("6 more functions in preparation");
    expect(html).toContain('href="/catalog#coming-soon"');
    catalog.functions = [];
  });

  it("shows the belonging function face on an agent page", async () => {
    catalog.functions = [{ slug: "company-mail", name: "Company mail", description: "", monthlyPriceCents: 14900, currency: "chf", image: face, workers: [worker("mail", "Penn")] }];
    const html = renderToStaticMarkup(await AgentPage({ params: Promise.resolve({ agent: "penn" }) }));
    expect(html).toContain("Company mail agent face");
    catalog.functions = [];
  });

  it("requires certificate verification for app connections", () => {
    expect(verifiedSslOptions()).toEqual({ rejectUnauthorized: true });
  });
});
