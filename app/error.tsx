'use client';
import Link from 'next/link';
import { Egg } from '@/components/Wordmark';

// Something failed while loading a page. Offer a retry and a way home; the error is logged on the server.
export default function Error({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="panel" style={{ width: 'min(100%, 460px)', padding: 28, gap: 14, textAlign: 'center' }}>
        <span style={{ justifySelf: 'center' }}><Egg size={52} /></span>
        <h1 style={{ font: '800 22px/1.2 var(--display)' }}>That didn’t load</h1>
        <p className="soft">Please try again. If it keeps happening, reply to any Genovus email and quote reference {error.digest ?? 'n/a'}.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => reset()}>Try again</button>
          <Link className="btn" href="/go">My dashboard</Link>
        </div>
      </div>
    </main>
  );
}
