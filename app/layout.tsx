import { Toaster } from '@/components/ActionForm';
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Ambient } from '@/components/Ambient';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_ORIGIN ?? 'https://genovus.io'),
  openGraph: { type: 'website', siteName: 'Genovus', title: 'Genovus · The right technology inside every agency', description: 'A carrier-aware website, social profiles set up live, tracked leads and monthly care, approved before anything goes public.' },
  title: { default: 'Genovus', template: '%s · Genovus' },
  description: 'The turnkey agency platform, by Genesis Secure Solutions.',
  robots: { index: false, follow: false },
  icons: { icon: [{ url: '/brand/genovus/genovus-icon.svg', type: 'image/svg+xml' }, { url: '/brand/genovus/genovus-favicon-64.png', type: 'image/png' }] },
};
export const viewport: Viewport = { themeColor: '#0b0c10', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Ambient />
        <Toaster />
      </body>
    </html>
  );
}
