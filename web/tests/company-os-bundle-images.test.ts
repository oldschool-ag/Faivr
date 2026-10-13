import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { fetchPolarProductImage, normalizeBundleImage, polarProductImageUrl, setBundleImage } from "@/lib/companyOs/bundleImages";

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
      expect(image.sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("refuses SVG and non-images", async () => {
    await expect(normalizeBundleImage(Buffer.from("<svg><rect/></svg>"))).rejects.toThrow("bundle_image_unsupported");
    await expect(normalizeBundleImage(Buffer.from("not an image"))).rejects.toThrow("bundle_image_invalid");
  });

  it("uses a Polar product media URL only when present", () => {
    expect(polarProductImageUrl({ medias: [{ public_url: "https://media.polar.test/face.png" }] })).toBe("https://media.polar.test/face.png");
    expect(polarProductImageUrl({ name: "No media" })).toBeNull();
  });

  it("fetches a Polar product image once for explicit admin fallback", async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#112233" } }).png().toBuffer();
    const calls: string[] = [];
    const bytes = await fetchPolarProductImage({
      apiOrigin: "https://api.polar.test",
      accessToken: "test-token",
      productId: "product-id",
      fetcher: async (input) => {
        calls.push(String(input));
        return calls.length === 1
          ? new Response(JSON.stringify({ medias: [{ public_url: "https://media.polar.test/face.png" }] }), { status: 200, headers: { "Content-Type": "application/json" } })
          : new Response(png, { status: 200, headers: { "Content-Type": "image/png" } });
      },
    });
    expect(calls).toEqual(["https://api.polar.test/v1/products/product-id", "https://media.polar.test/face.png"]);
    expect((await normalizeBundleImage(bytes)).mediaType).toBe("image/webp");
  });

  it("stores an uploaded image as normalized WebP metadata", async () => {
    const png = await sharp({ create: { width: 500, height: 300, channels: 3, background: "#445566" } }).png().toBuffer();
    let write: unknown[] | undefined;
    const db = { query: async (sql: string, values?: unknown[]) => {
      if (sql.startsWith("SELECT id")) return { rowCount: 1, rows: [] };
      write = values;
      return { rowCount: 1, rows: [] };
    } };
    const stored = await setBundleImage(db, "fixture", png, "upload");
    expect(stored).toMatchObject({ mediaType: "image/webp", source: "upload" });
    expect(stored.url).toContain(encodeURIComponent(stored.sha256));
    expect(write).toBeDefined();
    expect(write?.[2]).toBe("image/webp");
    expect(Number(write?.[3])).toBeLessThanOrEqual(256);
    expect(Number(write?.[4])).toBeLessThanOrEqual(256);
    expect(Number(write?.[5])).toBeLessThanOrEqual(60 * 1024);
    expect(Buffer.isBuffer(write?.[6])).toBe(true);
    expect(write?.[7]).toBe("upload");
  });
});
