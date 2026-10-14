import { describe, expect, it } from "vitest";
import { comingSoonFunctionForPackageIds } from "@/data/catalog-coming-soon";
import { describePermission } from "@/lib/publicPermissions";

describe("Company mail public copy", () => {
  it("renders Penn's mail permissions in plain words while preserving action.message meaning", () => {
    expect(describePermission("mail.read")).toBe("Reads your company mailbox (only yours, only company addresses)");
    expect(describePermission("mail.draft")).toBe("Writes reply drafts into your Drafts folder. Never sends e-mail.");
    expect(describePermission("action.message")).toBe("Sends messages");
  });

  it("maps Penn's published mail package to Company mail", () => {
    expect(comingSoonFunctionForPackageIds(["faivr.agent.mail-assistant"])).toEqual(expect.objectContaining({ slug: "company-mail", name: "Company mail", agents: ["Penn"], summary: "Reads your company mail, shows what needs doing, and writes reply drafts in your style. Never sends." }));
  });
});
