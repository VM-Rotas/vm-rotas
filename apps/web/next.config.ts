import type { NextConfig } from 'next';

const apiProxyTarget = (
  process.env.API_PROXY_TARGET ?? 'http://localhost:3001/api'
).replace(/\/$/, '');

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api-proxy/:path*',
        destination: `${apiProxyTarget}/:path*`,
      },
    ];
  },
};

export default nextConfig;
