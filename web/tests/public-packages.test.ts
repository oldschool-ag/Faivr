import { describe, expect, it } from "vitest";
import { canPurchasePackage, publicPackages } from "@/data/publicPackages";

describe("public package purchase eligibility", () => {
  it("never allows a coming-soon package to be purchased", () => {
    for (const item of publicPackages.filter((entry) => entry.status === "coming-soon")) {
      expect(canPurchasePackage(item)).toBe(false);
    }
  });
});
