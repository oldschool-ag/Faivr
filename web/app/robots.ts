import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: "*", allow: ["/","/catalog","/how-it-works","/trust","/docs","/imprint","/privacy"] }, sitemap: "https://faivr.ai/sitemap.xml" }; }
