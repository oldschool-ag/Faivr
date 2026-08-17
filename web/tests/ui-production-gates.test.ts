import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const supportChat = readFileSync(new URL("../components/support/SupportChat.tsx", import.meta.url), "utf8");
const companyOsPage = readFileSync(new URL("../app/company-os/page.tsx", import.meta.url), "utf8");

describe("preview UI production gates", () => {
  it("keeps the floating support launcher out of narrow mobile viewports", () => {
    expect(supportChat).toContain('data-testid="support-chat-launcher"');
    expect(supportChat).toMatch(/className="[^"]*hidden[^"]*sm:flex[^"]*"[\s\S]*?support-chat-launcher/);
  });

  it("gives Company OS users an ordered lifecycle and an explicit next action", () => {
    expect(companyOsPage).toContain("<ol");
    expect(companyOsPage).toContain("Review integration requirements");
    expect(companyOsPage).toContain("Install and acknowledge");
    expect(companyOsPage).toContain("Update or remove with proof");
  });

  it("does not overstate production readiness", () => {
    expect(companyOsPage).toContain("verified locally and in staging");
    expect(companyOsPage).toContain("Production credentials, package publication, billing, and activation are not enabled");
  });
});
