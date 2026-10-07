import { SiteChrome } from '@/components/SiteChrome';
import { IntakeForm } from '@/components/IntakeForm';

export const metadata = { title: 'Start with your agency' };

const STEPS = [
  ['A short call', 'About your office, your carrier’s rules and what you want your marketing to do.'],
  ['The right plan', 'A clear recommendation and price. Deposit 70% to start, 30% at launch.'],
  ['Your welcome package', 'A personal film and a setup guide arrive the moment your deposit clears.'],
  ['Live in days', 'We set up your profiles together, you approve every word, and you go live.'],
];

export default async function Start({ searchParams }: { searchParams: Promise<{ err?: string; plan?: string }> }) {
  const sp = await searchParams;
  return (
    <SiteChrome>
      <main className="wrapx sec" style={{ paddingTop: 48 }}>
        <div className="eyebrow">For agencies</div>
        <h1 style={{ font: '800 clamp(30px,4.6vw,52px)/1.05 var(--display)', letterSpacing: '-.02em', maxWidth: '18ch' }}>Start with your agency.</h1>
        <p className="lede">Tell us about your office. A real person replies within one business day to book a short consult. No obligation and no passwords, ever.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            {sp.err ? <div className="notice err" role="alert">{sp.err}</div> : null}
            <IntakeForm kind="agency" defaults={{ plan: ['launch', 'growth', 'premium'].includes(sp.plan ?? '') ? sp.plan! : '' }} />
          </div>
          <ol className="steps">
            {STEPS.map(([t, d], i) => (
              <li key={t} style={{ gridTemplateColumns: '28px 1fr', alignItems: 'start' }}>
                <span className="dot" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{i + 1}</span>
                <span><b style={{ display: 'block' }}>{t}</b><span className="soft" style={{ fontSize: 14 }}>{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
      </main>
    </SiteChrome>
  );
}
