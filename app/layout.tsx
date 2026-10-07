import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Genovus', template: '%s · Genovus' },
  description: 'The turnkey agency platform, by Genesis Secure Solutions.',
  robots: { index: false, follow: false },
  icons: { icon: '/brand/genovus/genovus-favicon-64.png' },
};
export const viewport: Viewport = { themeColor: '#0b0c10', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
