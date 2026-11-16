// The founding-client congratulations card on the agency's Home page (lib/lifetime.ts): the program for life, the
// locked rate, what it saves, what the program does for them, and our thanks. The owner closes it once read; the
// details stay on "Your program".
import Link from 'next/link';
import { ActionForm } from './ActionForm';
import { closeLifetimeCongrats } from '@/lib/lifetime-actions';
import { usd, type Lifetime } from '@/lib/lifetime';

export function LifetimeCongrats({ life, first, agency, slug, canClose }: { life: Lifetime; first: string; agency: string; slug: string; canClose: boolean }) {
  const base = `/app/${slug}`;
  return (
    <section className="panel lifetime" aria-labelledby="lifetime-h">
      <div className="lifetime-glow" aria-hidden />
      <div className="lifetime-head">
        <img src="/brand/genovus/genovus-mark-128.png" width={44} height={44} alt="" />
        <div>
          <div className="lifetime-eyebrow">Founding client · {life.name} for life</div>
          <h2 id="lifetime-h">Congratulations{first ? `, ${first}` : ''}. {life.name} is yours for life.</h2>
        </div>
      </div>
      <p className="lifetime-thanks">
        {agency} was the first agency to trust Genovus. You helped shape this platform from day one, so we’re making it
        official: every {life.name} feature, now and as it grows, at the launch rate you already pay. No trial, no
        upgrade fee, no price change. Thank you.
      </p>
      <div className="lifetime-stats">
        <div><b>{usd(life.rateCents)}<small>/mo</small></b><span>Locked for life</span></div>
        <div><b>{usd(life.savedMonthCents)}<small>/mo</small></b><span>Saved vs {life.careName} ({usd(life.listCents)})</span></div>
        <div><b>{usd(life.savedYearCents)}</b><span>Saved every year</span></div>
        {life.waivedCents ? <div><b>{usd(life.waivedCents)}</b><span>Upgrade fee waived</span></div> : null}
      </div>
      <div className="lifetime-adds">
        <div className="lifetime-sub">What {life.name} does for {agency}</div>
        <ul>{life.adds.map((m) => <li key={m.label}><b>{m.label}</b><span>{m.blurb}</span></li>)}</ul>
      </div>
      <div className="lifetime-actions">
        <Link className="btn primary" href={`${base}/program`}>See everything in {life.name}</Link>
        <Link className="btn" href={`${base}/helix`}>Ask Helix what to do first</Link>
        {canClose ? (
          <ActionForm action={closeLifetimeCongrats}>
            <input type="hidden" name="slug" value={slug} />
            <button className="btn ghost" type="submit">Close</button>
          </ActionForm>
        ) : null}
      </div>
    </section>
  );
}
