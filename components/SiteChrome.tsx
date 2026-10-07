// Header and footer for the public Genovus site.
import Link from 'next/link';

export function SiteChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <header className="site-nav">
        <div className="in">
          <Link href="/" className="brand" aria-label="Genovus home">
            <img src="/brand/genovus/genovus-mark-128.png" alt="" />
            <span><b>GENOVUS</b><small>Turnkey agency platform</small></span>
          </Link>
          <nav aria-label="Site">
            <Link href="/#platform">Platform</Link>
            <Link href="/#services">Services</Link>
            <Link href="/#how">How it works</Link>
            <Link href="/#packages">Packages</Link>
            <Link href="/partners">Carriers</Link>
            <Link href="/signin" className="btn small ghost" style={{ color: 'var(--ink)' }}>Sign in</Link>
            <Link href="/start" className="btn small primary">Get started</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="site-foot">
        <div className="wrapx in">
          <span>Genovus is a Genesis Secure Solutions brand.</span>
          <span>Genovus does not quote, bind or give insurance advice. Quotes and policy service stay with each carrier’s approved channels.</span>
          <span><Link href="/film" style={{ color: 'var(--muted)' }}>Film</Link> · <Link href="/signin" style={{ color: 'var(--muted)' }}>Sign in</Link></span>
        </div>
      </footer>
    </div>
  );
}
