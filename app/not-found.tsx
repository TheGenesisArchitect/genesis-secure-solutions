import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="panel" style={{ width: 'min(100%, 460px)', padding: 28, gap: 14, textAlign: 'center' }}>
        <img src="/brand/genovus/genovus-mark.svg" alt="" width={44} height={44} style={{ borderRadius: 11, justifySelf: 'center' }} />
        <h1 style={{ font: '800 22px/1.2 var(--display)' }}>We couldn’t find that page</h1>
        <p className="soft">The link may be old, or this page may belong to a workspace you’re not signed in to.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn primary" href="/go">Go to my dashboard</Link>
          <Link className="btn" href="/">Genovus home</Link>
        </div>
      </div>
    </main>
  );
}
