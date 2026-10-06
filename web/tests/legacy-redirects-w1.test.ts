import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const nextConfig = require("../next.config.js");

describe("W1 legacy public redirects", () => {
  it("permanently redirects onboard and audit base, nested, and prefix routes", async () => {
    const redirects = await nextConfig.redirects();
    const expectedSources = [
      "/onboard",
      "/onboard/:path*",
      "/onboard-:path(.*)",
      "/audit",
      "/audit/:path*",
      "/audit-:path(.*)",
    ];

    for (const source of expectedSources) {
      expect(redirects).toContainEqual({ source, destination: "/", permanent: true });
    }
  });
});
