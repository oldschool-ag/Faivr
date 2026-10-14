import { getPgPool } from "@/lib/postgres";

export async function GET(_: Request, { params }: { params: Promise<{ hash: string }> }) {
  const { hash } = await params;
  let value: string;
  try { value = decodeURIComponent(hash).replace(/\.webp$/, ""); } catch { return new Response("Not found", { status: 404 }); }
  const match = /^(?:sha256:)?([0-9a-f]{64})$/.exec(value);
  if (!match) return new Response("Not found", { status: 404 });
  const result = await getPgPool().query("SELECT bytes,media_type FROM company_os_bundle_image_blobs WHERE content_sha256=$1", [`sha256:${match[1]}`]);
  if (!result.rowCount) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(result.rows[0].bytes as Buffer), { headers: { "Content-Type": String(result.rows[0].media_type), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
