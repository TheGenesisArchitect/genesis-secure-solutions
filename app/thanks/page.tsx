import Link from 'next/link';
import { SiteChrome } from '@/components/SiteChrome';

export const metadata = { title: 'Thank you' };

export default async function Thanks({ searchParams }: { searchParams: Promise<{ k?: string }> }) {
  const { k } = await searchParams;
  const carrier = k === 'carrier';
  return (
    <SiteChrome>
      <main className="wrapx sec" style={{ paddingTop: 64, minHeight: '60dvh' }}>
        <div className="eyebrow">Received</div>
        <h1 style={{ font: '800 clamp(30px,4.6vw,52px)/1.05 var(--display)', letterSpacing: '-.02em' }}>Thank you.</h1>
        <p className="lede">
          {carrier
            ? 'Your request is with our team. We will reply within one business day to plan a first conversation about a pilot.'
            : 'Your request is with our team. A real person will reply within one business day to book your consult.'}
        </p>
        <div className="row">
          <Link className="btn" href="/">Back to Genovus</Link>
          <Link className="btn ghost" href="/film">Watch the film</Link>
        </div>
      </main>
    </SiteChrome>
  );
}
