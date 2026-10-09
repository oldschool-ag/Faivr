/** @type {import('next').NextConfig} */
const nextConfig = {
  // Configured for Vercel Deployment
  images: { unoptimized: true },
  async redirects() { return [
    { source: "/marketplace", destination: "/catalog", permanent: true },
    { source: "/marketplace/:path*", destination: "/catalog", permanent: true },
    { source: "/dashboard", destination: "/", permanent: true },
    { source: "/genesis", destination: "/", permanent: true },
    { source: "/onboard", destination: "/", permanent: true },
    { source: "/onboard/:path*", destination: "/", permanent: true },
    { source: "/onboard-:path(.*)", destination: "/", permanent: true },
    { source: "/onboard-agent", destination: "/", permanent: true },
    { source: "/audit", destination: "/", permanent: true },
    { source: "/audit/:path*", destination: "/", permanent: true },
    { source: "/audit-:path(.*)", destination: "/", permanent: true },
    { source: "/workers", destination: "/agents", permanent: true },
    { source: "/workers/:path*", destination: "/agents/:path*", permanent: true },
  ]; },
};
module.exports = nextConfig;
