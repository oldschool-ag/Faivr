import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";

const query = vi.hoisted(() => vi.fn());
vi.mock("@/lib/postgres", () => ({ getPgPool: () => ({ query }) }));

import { GET } from "@/app/api/company-os/v1/catalog-images/[hash]/route";

describe("catalog image route", () => {
  const bytes = Buffer.from("normalized-webp-fixture");
  const bareHash = createHash("sha256").update(bytes).digest("hex");
  const hash = `sha256:${bareHash}`;

  beforeEach(() => query.mockReset());

  it("serves the exact content-addressed blob with immutable cache headers", async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ bytes, media_type: "image/webp" }] });
    const response = await GET(new Request("https://faivr.ai/api/company-os/v1/catalog-images/x"), { params: Promise.resolve({ hash: `${encodeURIComponent(hash)}.webp` }) });
    expect(query).toHaveBeenCalledWith("SELECT bytes,media_type FROM company_os_bundle_image_blobs WHERE content_sha256=$1", [hash]);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(bareHash);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it.each([`${bareHash}.webp`, `${encodeURIComponent(hash)}.webp`])("serves the same blob for %s", async (routeHash) => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ bytes, media_type: "image/webp" }] });
    const response = await GET(new Request("https://faivr.ai/api/company-os/v1/catalog-images/x"), { params: Promise.resolve({ hash: routeHash }) });
    expect(query).toHaveBeenCalledWith("SELECT bytes,media_type FROM company_os_bundle_image_blobs WHERE content_sha256=$1", [hash]);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
    expect(response.headers.get("content-type")).toBe("image/webp");
  });

  it("serves a WebP whose digest and header dimensions match its catalog form", async () => {
    const webp = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#336699" } }).webp().toBuffer();
    const digest = createHash("sha256").update(webp).digest("hex");
    query.mockResolvedValue({ rowCount: 1, rows: [{ bytes: webp, media_type: "image/webp" }] });
    const response = await GET(new Request("https://faivr.ai/api/company-os/v1/catalog-images/x"), { params: Promise.resolve({ hash: `${digest}.webp` }) });
    const served = Buffer.from(await response.arrayBuffer());
    expect(createHash("sha256").update(served).digest("hex")).toBe(digest);
    const header = await sharp(served).metadata();
    expect([header.width, header.height]).toEqual([64, 48]);
  });

  it("returns null catalog metadata when a bundle has no association", async () => {
    query.mockResolvedValue({ rowCount: 0, rows: [] });
    const response = await GET(new Request("https://faivr.ai/api/company-os/v1/catalog-images/x"), { params: Promise.resolve({ hash: `${encodeURIComponent(hash)}.webp` }) });
    expect(response.status).toBe(404);
  });

  it.each(["x.webp", `SHA256:${bareHash}.webp`, `${"a".repeat(63)}.webp`, `${bareHash}.png`])("refuses invalid image route %s", async (routeHash) => {
    const response = await GET(new Request("https://faivr.ai/api/company-os/v1/catalog-images/x"), { params: Promise.resolve({ hash: routeHash }) });
    expect(response.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });
});
