import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({ functions: [] as unknown[] }));
vi.mock("@/lib/publicCatalog", () => ({ getPublicCatalog: async () => catalog.functions }));
vi.mock("@/components/layout/SiteShell", () => ({ SiteShell: ({ children }: { children: ReactNode }) => children }));

import AgentPage from "@/app/agents/[agent]/page";

describe("Company mail agent page", () => {
  it("renders Penn's mail permissions in plain words", async () => {
    catalog.functions = [{
      slug: "company-mail", name: "Company mail", description: "Reads your company mail, shows what needs doing, and writes reply drafts in your style. Never sends.", monthlyPriceCents: 14900, currency: "chf",
      workers: [{ id: "faivr.agent.penn", slug: "penn", name: "Penn", role: "Company mail", version: "1.0.0", publisherName: "Old School GmbH", publisherKeyId: "key", digest: "sha256:test", permissions: ["mail.read", "mail.draft"], slots: [] }],
    }];
    const html = renderToStaticMarkup(await AgentPage({ params: Promise.resolve({ agent: "penn" }) }));
    expect(html).toContain("Reads your company mailbox (only yours, only company addresses)");
    expect(html).toContain("Writes reply drafts into your Drafts folder. Never sends e-mail.");
    expect(html).not.toContain("mail.read");
    expect(html).not.toContain("mail.draft");
  });
});
