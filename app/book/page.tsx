// Book a consultation: who you are, then the open times on the Genovus calendar (lib/intake.ts → /book/<token>).
import Link from 'next/link';
import { SiteChrome } from '@/components/SiteChrome';
import { IntakeForm } from '@/components/IntakeForm';
import { Proof } from '@/components/site/Proof';

export const metadata = { title: 'Book a consultation', description: 'A 30-minute video call with the Genovus team about your agency. Pick a time that suits you.' };

const CALL = [
  ['30 minutes on video', 'With the Genovus team, at a time you pick. The invite lands on your calendar straight away.'],
  ['About your office', 'Your carrier, your lines and what you want your marketing to do.'],
  ['What we’d set up', 'Your website, profiles and lead tools, shown on real Genovus screens.'],
  ['No obligation', 'A clear recommendation and price afterward, if it fits. No passwords, ever.'],
];

export default async function BookConsult({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const sp = await searchParams;
  return (
    <SiteChrome>
      <main className="wrapx sec" style={{ paddingTop: 48 }}>
        <div className="eyebrow">Book a consultation</div>
        <h1 style={{ font: '800 clamp(30px,4.6vw,52px)/1.05 var(--display)', letterSpacing: '-.02em', maxWidth: '18ch' }}>Book your consultation.</h1>
        <p className="lede">Tell us who you are, then pick an open time. It takes under a minute.</p>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,420px),1fr))', alignItems: 'start' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            {sp.err ? <div className="notice err" role="alert">{sp.err}</div> : null}
            <IntakeForm kind="agency" short back="/book" />
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>A carrier or agency network? <Link href="/partners">Plan a pilot instead</Link>.</p>
          </div>
          <ol className="steps">
            {CALL.map(([t, d], i) => (
              <li key={t} style={{ gridTemplateColumns: '28px 1fr', alignItems: 'start' }}>
                <span className="dot" style={{ background: 'var(--accent)', color: 'var(--on-accent)' }}>{i + 1}</span>
                <span><b style={{ display: 'block' }}>{t}</b><span className="soft" style={{ fontSize: 14 }}>{d}</span></span>
              </li>
            ))}
          </ol>
        </div>
        <Proof compact />
      </main>
    </SiteChrome>
  );
}
