import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { fetchPolarProductImage, normalizeBundleImage, polarProductImageUrl, setBundleImage } from "@/lib/companyOs/bundleImages";

const execFileAsync = promisify(execFile);

describe("bundle image normalization", () => {
  it("normalizes PNG and JPEG uploads to bounded WebP", async () => {
    const png = await sharp({ create: { width: 512, height: 320, channels: 3, background: "#aabbcc" } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 320, height: 512, channels: 3, background: "#ccbbaa" } }).jpeg().toBuffer();
    for (const input of [png, jpg]) {
      const image = await normalizeBundleImage(input);
      expect(image.mediaType).toBe("image/webp");
      expect(image.width).toBeLessThanOrEqual(256);
      expect(image.height).toBeLessThanOrEqual(256);
      expect(image.bytes.length).toBeLessThanOrEqual(60 * 1024);
      expect(image.contentSha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("refuses SVG even after a long preamble and rejects non-images", async () => {
    const svg = Buffer.from(`${"<!-- harmless -->".repeat(80)}<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>`);
    await expect(normalizeBundleImage(svg)).rejects.toThrow("bundle_image_unsupported");
    await expect(normalizeBundleImage(Buffer.from("not an image"))).rejects.toThrow("bundle_image_invalid");
  });

  it("uses the documented Polar media URL only when present", () => {
    expect(polarProductImageUrl({ medias: [{ mime_type: "image/png", public_url: "https://media.polar.test/face.png" }] })).toBe("https://media.polar.test/face.png");
    expect(polarProductImageUrl({ name: "No media" })).toBeNull();
  });

  it("fetches a Polar product image once for explicit admin fallback without forwarding credentials to media", async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#112233" } }).png().toBuffer();
    const requests: Array<{ url: string; headers: Headers }> = [];
    const bytes = await fetchPolarProductImage({
      apiOrigin: "https://api.polar.test",
      accessToken: "test-token",
      productId: "product-id",
      fetcher: async (input, init) => {
        requests.push({ url: String(input), headers: new Headers(init?.headers) });
        return requests.length === 1
          ? new Response(JSON.stringify({ medias: [{ mime_type: "image/png", public_url: "https://media.polar.test/face.png" }] }), { status: 200, headers: { "Content-Type": "application/json" } })
          : new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
      },
    });
    expect(requests.map((request) => request.url)).toEqual(["https://api.polar.test/v1/products/product-id", "https://media.polar.test/face.png"]);
    expect(requests[0].headers.get("authorization")).toBe("Bearer test-token");
    expect(requests[1].headers.get("authorization")).toBeNull();
    expect((await normalizeBundleImage(bytes)).mediaType).toBe("image/webp");
  });

  it("keeps uploaded faces over Polar and keeps old content-addressed blobs", async () => {
    const png = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#445566" } }).png().toBuffer();
    const jpg = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#665544" } }).jpeg().toBuffer();
    const blobs = new Map<string, unknown[]>();
    const associations = new Map<string, { sha: string; source: "upload" | "polar" }>();
    const db = { query: async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith("SELECT id")) return { rowCount: 1, rows: [] };
      if (sql.startsWith("INSERT INTO company_os_bundle_image_blobs")) { blobs.set(values[0] as string, values); return { rowCount: 1, rows: [] }; }
      if (sql.startsWith("INSERT INTO company_os_bundle_images")) {
        const [bundleId, sha, source] = values as [string, string, "upload" | "polar"];
        const existing = associations.get(bundleId);
        if (existing?.source === "upload" && source === "polar") return { rowCount: 0, rows: [] };
        associations.set(bundleId, { sha, source });
        return { rowCount: 1, rows: [{ content_sha256: sha, source }] };
      }
      if (sql.startsWith("SELECT i.source")) {
        const current = associations.get(values[0] as string);
        if (!current) return { rowCount: 0, rows: [] };
        const blob = blobs.get(current.sha)!;
        return { rowCount: 1, rows: [{ source: current.source, content_sha256: current.sha, width: blob[2], height: blob[3] }] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    } };
    const uploaded = await setBundleImage(db, "one", png, "upload");
    const retained = await setBundleImage(db, "one", jpg, "polar");
    const shared = await setBundleImage(db, "two", png, "upload");
    const replacement = await setBundleImage(db, "one", jpg, "upload");
    expect(retained).toEqual(uploaded);
    expect(shared.sha256).toBe(uploaded.sha256);
    expect(replacement.sha256).not.toBe(uploaded.sha256);
    expect(blobs.size).toBe(2);
    expect(associations.get("one")?.sha).toBe(replacement.sha256);
    expect(associations.get("two")?.sha).toBe(uploaded.sha256);
    expect(uploaded.url).toBe(`https://faivr.ai/api/company-os/v1/catalog-images/${encodeURIComponent(uploaded.sha256)}.webp`);
  });

  it("runs the documented CLI help outside Vitest's module loader", async () => {
    const { stdout } = await execFileAsync(process.execPath, ["scripts/store-public-catalog-admin.mjs", "--help"], { cwd: process.cwd() });
    expect(stdout).toContain("set-image --bundle design-review --file");
  });
});
