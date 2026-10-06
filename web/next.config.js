/** @type {import('next').NextConfig} */
const nextConfig = {
  // Configured for Vercel Deployment
  images: { unoptimized: true },
  async redirects() { return [
    { source: "/marketplace", destination: "/catalog", permanent: true },
    { source: "/marketplace/:path*", destination: "/catalog", permanent: true },
    { source: "/dashboard", destination: "/", permanent: true },
    { source: "/onboard-agent", destination: "/", permanent: true },
    { source: "/audit/:path*", destination: "/", permanent: true },
  ]; },
};
module.exports = nextConfig;
