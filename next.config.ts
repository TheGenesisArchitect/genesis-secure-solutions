import type { NextConfig } from 'next';

// Everything here is an internal preview or a private client page, so nothing is indexed yet.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      { source: '/', destination: '/film/index.html' },
      { source: '/film', destination: '/film/index.html' },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      { source: '/w/:path*', headers: [{ key: 'Cache-Control', value: 'private, max-age=3600' }] },
    ];
  },
};

export default nextConfig;
