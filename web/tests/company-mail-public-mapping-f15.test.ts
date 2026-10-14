import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({ functions: [] as unknown[] }));
vi.mock("@/lib/publicCatalog", () => ({
  getPublicCatalog: async () => catalog.functions,
  getPublicCatalogState: async () => ({ functions: catalog.functions, unavailable: false }),
}));
vi.mock("@/components/layout/SiteShell", () => ({ SiteShell: ({ children }: { children: ReactNode }) => children }));

import CatalogPage from "@/app/catalog/page";
import { comingSoonFunctionForPackageIds } from "@/data/catalog-coming-soon";

describe("F15 Company mail publication mapping", () => {
  it("maps the published mail package to Company mail and omits it from Coming soon", async () => {
    expect(comingSoonFunctionForPackageIds(["faivr.agent.mail-assistant"])?.slug).toBe("company-mail");
    catalog.functions = [{
      slug: "company-mail",
      name: "Company mail",
      description: "",
      monthlyPriceCents: 14900,
      currency: "chf",
      image: null,
      workers: [{ id: "faivr.agent.mail-assistant", slug: "penn", name: "Penn", role: "", version: "1.0.0", publisherName: "Old School GmbH", publisherKeyId: "key", digest: "sha256:test", permissions: [], slots: [] }],
    }];
    const html = renderToStaticMarkup(await CatalogPage());
    expect((html.match(/Company mail/g) ?? [])).toHaveLength(1);
    expect(html).not.toMatch(/COMING SOON[\s\S]*Company mail/);
    catalog.functions = [];
  });
});
