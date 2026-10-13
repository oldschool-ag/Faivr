export function storePublicOrigin(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.FAIVR_STORE_ORIGIN?.trim()
    || (env.VERCEL_ENV === "production" ? "https://faivr.ai" : (env.VERCEL_URL?.trim() ? `https://${env.VERCEL_URL.trim()}` : "https://faivr.ai"));
  let url: URL;
  try { url = new URL(configured); } catch { throw new Error("store_public_origin_invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("store_public_origin_invalid");
  return url.origin;
}
