import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const supportChat = readFileSync(new URL("../components/support/SupportChat.tsx", import.meta.url), "utf8");
const companyOsPage = readFileSync(new URL("../app/company-os/page.tsx", import.meta.url), "utf8");

describe("preview UI production gates", () => {
  it("keeps the floating support launcher out of narrow mobile viewports", () => {
    expect(supportChat).toContain('data-testid="support-chat-launcher"');
    expect(supportChat).toMatch(/className="[^"]*hidden[^"]*sm:flex[^"]*"[\s\S]*?support-chat-launcher/);
  });

  it("routes the Company OS CTA to accurate V1 requirements on the page", () => {
    expect(companyOsPage).toContain('href="#integration-requirements"');
    expect(companyOsPage).toContain('id="integration-requirements"');
    expect(companyOsPage).toContain("Company OS V1 integration requirements");
    expect(companyOsPage).not.toMatch(/href="\/docs"[^>]*>[\s\S]*?Review integration requirements/);
  });

  it("gives Company OS users an ordered lifecycle and the locked removal chronology", () => {
    expect(companyOsPage).toContain("<ol");
    expect(companyOsPage).toContain("Install and acknowledge");
    expect(companyOsPage).toContain("Archive or uninstall with proof");
    expect(companyOsPage).toContain("Archive disables local use but leaves billing unchanged.");

    const removalSequence = [
      "Company OS completes and attests the local removal",
      "FAIVR accepts the signed completed receipt",
      "schedules period-end cancellation",
      "a later provider event confirms billing stopped",
    ];
    let priorIndex = -1;
    for (const checkpoint of removalSequence) {
      const checkpointIndex = companyOsPage.indexOf(checkpoint);
      expect(checkpointIndex, `missing removal checkpoint: ${checkpoint}`).toBeGreaterThan(priorIndex);
      priorIndex = checkpointIndex;
    }
  });

  it("does not overstate production readiness", () => {
    expect(companyOsPage).toContain("verified locally and in staging");
    expect(companyOsPage).toContain("Production credentials, package publication, billing, and activation are not enabled");
  });
});
