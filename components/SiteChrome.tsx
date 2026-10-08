// Header and footer for the public Genovus site. genovus.io is the front door to everything: the
// "Log in" menu takes agencies, carrier partners and the team straight to their own place.
import Link from 'next/link';
import { doors } from '@/lib/surfaces';

export async function SiteChrome({ children }: { children: React.ReactNode }) {
  const d = await doors();
  return (
    <div className="site">
      <header className="site-nav">
        <div className="in">
          <Link href="/" className="brand" aria-label="Genovus home">
            <img src="/brand/genovus/genovus-mark.svg" alt="" />
            <span><b>GENOVUS</b><small>Turnkey agency platform</small></span>
          </Link>
          <nav aria-label="Site">
            <Link href="/#platform">Platform</Link>
            <Link href="/#services">Services</Link>
            <Link href="/#how">How it works</Link>
            <Link href="/#packages">Packages</Link>
            <Link href="/partners">Carriers</Link>
            <details className="login-menu">
              <summary className="btn small ghost" style={{ color: 'var(--ink)' }}>Log in</summary>
              <div className="eco-list" style={{ left: 'auto', right: 0 }}>
                <a href={d.agency}><span><b style={{ color: 'var(--ink)' }}>Agency dashboard</b><br /><span className="muted" style={{ fontSize: 12 }}>Setup, approvals, monthly care, results</span></span></a>
                <a href={d.carrier}><span><b style={{ color: 'var(--ink)' }}>Carrier &amp; network portal</b><br /><span className="muted" style={{ fontSize: 12 }}>Every office in your network</span></span></a>
                <a href={d.team}><span><b style={{ color: 'var(--ink)' }}>Genovus team</b><br /><span className="muted" style={{ fontSize: 12 }}>Enterprise console</span></span></a>
              </div>
            </details>
            <Link href="/start" className="btn small primary">Get started</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="site-foot">
        <div className="wrapx in">
          <span>Genovus is a Genesis Secure Solutions brand.</span>
          <span>Genovus does not quote, bind or give insurance advice. Quotes and policy service stay with each carrier’s approved channels.</span>
          <span>
            <Link href="/privacy" style={{ color: 'var(--muted)' }}>Privacy</Link> · <Link href="/terms" style={{ color: 'var(--muted)' }}>Terms</Link> · <Link href="/film" style={{ color: 'var(--muted)' }}>Film</Link> · <a href={d.agency} style={{ color: 'var(--muted)' }}>Log in</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
