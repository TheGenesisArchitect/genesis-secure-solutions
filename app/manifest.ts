import type { MetadataRoute } from 'next';

// Lets agents add Genovus to their phone's home screen; it opens straight to their dashboard.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Genovus',
    short_name: 'Genovus',
    description: 'The turnkey agency platform: setup, approvals, monthly care and results.',
    start_url: '/go',
    display: 'standalone',
    background_color: '#0b0c10',
    theme_color: '#0b0c10',
    icons: [
      { src: '/brand/genovus/genovus-app-icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
      { src: '/brand/genovus/genovus-egg-icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  };
}
