import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const nextConfig = require("../next.config.js");
const { match } = require("next/dist/compiled/path-to-regexp");

describe("legacy public redirects", () => {
  it("permanently redirects onboard, audit, and worker routes", async () => {
    const redirects = await nextConfig.redirects();
    const cases = [
      ["/onboard", "/onboard"],
      ["/onboard/:path*", "/onboard/setup"],
      ["/onboard-:path(.*)", "/onboard-legacy"],
      ["/audit", "/audit"],
      ["/audit/:path*", "/audit/logs"],
      ["/audit-:path(.*)", "/audit-legacy"],
    ] as const;

    for (const [source, url] of cases) {
      expect(redirects).toContainEqual({ source, destination: "/", permanent: true });
      expect(match(source)(url)).not.toBe(false);
    }

    for (const [source, destination, url] of [["/workers", "/agents", "/workers"], ["/workers/:path*", "/agents/:path*", "/workers/gideon"]] as const) {
      expect(redirects).toContainEqual({ source, destination, permanent: true });
      expect(match(source)(url)).not.toBe(false);
    }
  });
});
