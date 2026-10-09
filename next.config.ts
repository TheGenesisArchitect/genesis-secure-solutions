import type { NextConfig } from 'next';

// Everything here is an internal preview or a private client page, so nothing is indexed yet.
// Content Security Policy for production. Pages and the baked templates use inline scripts and styles, so
// those are allowed from this origin only; nothing loads from other sites except images over https.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self' wss://generativelanguage.googleapis.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
const securityHeaders = process.env.NODE_ENV === 'production'
  ? [
      { key: 'Content-Security-Policy', value: CSP },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
    ]
  : [];

const nextConfig: NextConfig = {
  // The thumbnail renderer reads the brand fonts and mark from disk.
  outputFileTracingIncludes: { '/api/studio/thumb/[id]': ['./lib/fonts/*.woff', './public/brand/genovus/genovus-egg.svg'] },
  poweredByHeader: false,
  // Friendly doors under the genovus.io mothership: app. for agencies, partners. for carriers. Everything
  // lives on genovus.io itself so one sign-in covers the whole ecosystem.
  async redirects() {
    return [
      { source: '/:path*', has: [{ type: 'host', value: 'app.genovus.io' }], destination: 'https://genovus.io/app/:path*', permanent: true },
      { source: '/:path*', has: [{ type: 'host', value: 'partners.genovus.io' }], destination: 'https://genovus.io/network', permanent: true },
      { source: '/:path*', has: [{ type: 'host', value: 'www.genovus.io' }], destination: 'https://genovus.io/:path*', permanent: true },
    ];
  },
  async rewrites() {
    return [
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
          ...securityHeaders,
        ],
      },
      { source: '/w/:path*', headers: [{ key: 'Cache-Control', value: 'private, max-age=3600' }] },
    ];
  },
};

export default nextConfig;
