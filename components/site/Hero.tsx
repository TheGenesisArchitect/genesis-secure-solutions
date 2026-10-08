// The first screen of genovus.io: a headline that reveals word by word over the living ecosystem.
// Server-rendered text (crawlers and screen readers get every word); the 3D layer is decoration.
import Link from 'next/link';
import { HeroCanvas } from './HeroCanvas';
import type { Doors } from '@/lib/surfaces';

const Words = ({ text, from = 0, accent }: { text: string; from?: number; accent?: boolean }) => (
  <>
    {text.split(' ').map((w, i) => (
      <span key={i}>
        <span className={'word' + (accent ? ' grad' : '')} style={{ animationDelay: `${0.15 + (from + i) * 0.09}s` }}>{w}</span>{' '}
      </span>
    ))}
  </>
);

export function Hero({ doors }: { doors: Doors }) {
  return (
    <section className="hero2" aria-labelledby="hero-title">
      <HeroCanvas />
      <div className="wrapx hero2-copy">
        <div className="eyebrow reveal" style={{ animationDelay: '.05s' }}>Agentic services for traditional institutions</div>
        <h1 id="hero-title">
          <Words text="The right technology" />
          <br />
          <Words text="inside every agency." from={3} accent />
        </h1>
        <p className="lede reveal" style={{ animationDelay: '.75s' }}>
          One agent record becomes a carrier-aware website, connected profiles and tracked leads, set up live and approved before anything goes public. Then Genovus runs it every month. Automation does the repeatable work; people own the relationship.
        </p>
        <div className="row reveal" style={{ animationDelay: '.9s' }}>
          <Link href="/start" className="btn primary">Start with your agency</Link>
          <Link href="/partners" className="btn">For carriers and networks</Link>
          <a href="#story" className="btn ghost">See how it works ↓</a>
        </div>
        <div className="hero2-doors reveal" style={{ animationDelay: '1.05s' }}>
          <span className="muted">Already with us?</span>
          <a href={doors.agency}>Agency dashboard</a>
          <a href={doors.carrier}>Carrier portal</a>
          <a href={doors.team}>Genovus team</a>
        </div>
      </div>
      <div className="scroll-cue" aria-hidden="true"><span /></div>
    </section>
  );
}
