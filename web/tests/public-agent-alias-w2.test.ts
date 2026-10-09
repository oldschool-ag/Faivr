import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const catalog = vi.hoisted(() => ({ functions: [] as unknown[] }));
vi.mock("@/lib/publicCatalog", () => ({ getPublicCatalog: async () => catalog.functions }));
vi.mock("@/components/layout/SiteShell", () => ({ SiteShell: ({ children }: { children: ReactNode }) => children }));
import AgentPage, { generateMetadata } from "@/app/agents/[agent]/page";

describe("W2 published agent identity", () => {
  it("does not substitute one published member for another planned agent", async () => {
    // Deliberately partial publication of the known multi-agent function.
    catalog.functions = [{
      slug: "software-delivery", name: "Software delivery: Bob", description: "Published description",
      monthlyPriceCents: 34900, currency: "chf", workers: [{
        id: "faivr.agent.build-issue-writer", slug: "build-issue-writer", name: "Bob - Issue Writer", role: "Writes issues",
        version: "1.0.0", publisherName: "Old School GmbH", publisherKeyId: "test-key",
        digest: "sha256:test", permissions: [], slots: [],
      }],
    }];
    const params = Promise.resolve({ agent: "bob-merge-gate" });
    const html = renderToStaticMarkup(await AgentPage({ params }));
    expect(html).toContain("COMING SOON");
    expect(html).toMatch(/<h1[^>]*>Bob - Merge Gate<\/h1>/);
    expect(html).not.toContain("PROOF OF ORIGIN");
    expect((await generateMetadata({ params })).title).toBe("Bob - Merge Gate | FAIVR");

    const published = renderToStaticMarkup(await AgentPage({ params: Promise.resolve({ agent: "build-issue-writer" }) }));
    expect(published).toMatch(/<h1[^>]*>Bob - Issue Writer<\/h1>/);
    expect(published).toContain("PROOF OF ORIGIN");
    expect(published).not.toContain("COMING SOON");
  });
});
