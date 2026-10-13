import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/postgres", () => ({ getPgPool: () => ({ query }) }));

import { GET } from "@/app/api/company-os/v1/catalog-images/[hash]/route";

describe("catalog image route", () => {
  const hash = `sha256:${"a".repeat(64)}`;
  const bytes = Buffer.from("normalized-webp-fixture");

  beforeEach(() => query.mockReset());

  it("serves the exact content-addressed blob with immutable cache headers", async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ bytes, media_type: "image/webp" }] });
    const response = await GET(new Request("https://faivr.ai/api/company-os/v1/catalog-images/x"), { params: Promise.resolve({ hash: `${encodeURIComponent(hash)}.webp` }) });
    expect(query).toHaveBeenCalledWith("SELECT bytes,media_type FROM company_os_bundle_image_blobs WHERE content_sha256=$1", [hash]);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("returns null catalog metadata when a bundle has no association", async () => {
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    const response = await GET(new Request("https://faivr.ai/api/company-os/v1/catalog-images/x"), { params: Promise.resolve({ hash: `${encodeURIComponent(hash)}.webp` }) });
    expect(response.status).toBe(404);
  });
});
