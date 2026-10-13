import { getPgPool } from "@/lib/postgres";

export async function GET(_: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  const value = decodeURIComponent(hash).replace(/\.webp$/, "");
  if (!/^sha256:[0-9a-f]{64}$/.test(value)) return new Response("Not found", { status: 404 });
  const result = await getPgPool().query("SELECT bytes,media_type FROM company_os_bundle_images WHERE content_sha256=$1", [value]);
  if (!result.rowCount) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(result.rows[0].bytes as Buffer), { headers: { "Content-Type": String(result.rows[0].media_type), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
