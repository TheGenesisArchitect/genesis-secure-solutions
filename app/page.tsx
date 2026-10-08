import Link from 'next/link';
import { SiteChrome } from '@/components/SiteChrome';
import { Chip } from '@/components/ui';
import { SCENES } from '@/data/story';
import { PLANS, ADD_ONS, RESPONSE_TIMES } from '@/data/offers';
import { doors } from '@/lib/surfaces';
import { Hero } from '@/components/site/Hero';
import { Story } from '@/components/site/Story';

export const metadata = { title: { absolute: 'Genovus · The right technology inside every agency' } };

const usd = (c: number) => '$' + (c / 100).toLocaleString('en-US');

const SERVICES: { t: string; d: string; live: boolean }[] = [
  { t: 'A site from one record', d: 'Who the agent is, where they serve and what their carrier allows becomes a fast, compliant website with tracked callbacks.', live: true },
  { t: 'Social, set up live', d: 'Facebook, Instagram and Google set up together on a call. A specialist leads, the agent’s screen follows, and no password changes hands.', live: true },
  { t: 'Compliance built in', d: 'Platform limits enforced, risky claims flagged and an approver signs off. Any later edit goes back for approval.', live: true },
  { t: 'A personal welcome', d: 'A narrated welcome film and a setup guide that already knows the agent’s plan, sent the moment the deposit clears.', live: true },
  { t: 'Monthly care', d: 'Change requests with response times by plan, a content calendar, and a monthly report with one recommended improvement.', live: true },
  { t: 'Dashboards for everyone', d: 'Our team runs every client from one console; each agency has its own dashboard; networks and carriers see their portfolio.', live: true },
  { t: 'Leads to their source', d: 'Every callback arrives tagged with where the person found the agent, with their consent on record.', live: true },
  { t: 'Monthly content', d: 'Posts drafted from approved templates for the agent to approve before anything goes out.', live: false },
  { t: 'Carrier governance', d: 'A carrier’s wording rules, template library and approval routing, applied to every agency at once.', live: false },
];

const LIFECYCLE: [string, string, boolean][] = [
  ['Attract', 'Website, demo, referrals', true], ['Consult', 'A call about the office', false], ['Propose', 'The right plan, priced', false],
  ['Deposit', '70% to start', false], ['Intake', 'One agent record', true], ['Build', 'Site, copy, kit, welcome', false],
  ['Review & launch', 'Agent and carrier approve', false], ['Care', 'Posts, leads, reports', true],
];

const TRUST = [
  ['People approve everything public', 'Publishing, posting, sending and invoicing always wait for a named person.'],
  ['The agent owns every account', 'Pages, profiles, domains and ad accounts stay in the agent’s name. We hold partner access only.'],
  ['No shared passwords', 'Setup happens on the agent’s own device, guided live. Partner access replaces logins.'],
  ['Each agency is sealed off', 'Every record is isolated per agency in the database itself, not just in the app.'],
  ['A tamper-evident record', 'Every decision is written to a hash-chained audit log that cannot be edited.'],
  ['We never give insurance advice', 'No quoting, binding or policy advice. Quote buttons hand off to the carrier.'],
];

export default async function Home() {
  const d = await doors();
  return (
    <SiteChrome>
      <main>
        <Hero doors={d} />
        <Story />

        <section className="wrapx sec" id="film">
          <div className="eyebrow">The film</div>
          <h2 className="big">See Genovus in seventy-eight seconds.</h2>
          <video className="film-frame" controls playsInline preload="metadata" poster="/site/poster-agency.jpg" src="/site/genovus-agency.mp4">
            Your browser can’t play this film.
          </video>
          <p className="muted" style={{ fontSize: 13 }}>The agency in the film, Brooks Family Insurance, is fictional. Product screens are real; screens marked “In development” are concepts.</p>
        </section>

        <section className="wrapx sec" id="platform">
          <div className="eyebrow">One platform, end to end</div>
          <h2 className="big">Three dashboards, one record underneath.</h2>
          <p className="lede">Every surface reads the same agent record, the same approvals and the same audit log, so what the agency sees, what our team runs and what a carrier reviews never disagree.</p>
          <div className="grid g3">
            {[
              ['console', 'Enterprise console', 'Our team’s cockpit: pipeline by stage, every approval waiting, the care desk, the asset library and the audit log.'],
              ['agency', 'Agency dashboard', 'Each agency’s private workspace: next steps, live setup, approvals, monthly care, results and billing with upgrade credit.'],
              ['network', 'Network view', 'For carriers and agency networks: which offices are live, what is approved, approval turnaround and leads, in aggregate.'],
            ].map(([k, t, d]) => (
              <figure className="shot" key={k} style={{ margin: 0 }}>
                <img src={`/site/screens/${k}.png`} alt={`${t}, with sample data`} loading="lazy" />
                <figcaption><span><b style={{ color: 'var(--ink)' }}>{t}.</b> {d}</span><Chip kind="sample">Sample data</Chip></figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="wrapx sec" id="services">
          <div className="eyebrow">The suite</div>
          <h2 className="big">Everything an agency needs to be found, trusted and chosen.</h2>
          <div className="grid g3">
            {SERVICES.map((s, i) => (
              <article className="feature" key={s.t}>
                <div className="spread"><span className="ic">{String(i + 1).padStart(2, '0')}</span><Chip kind={s.live ? 'live' : 'dev'}>{s.live ? 'Live' : 'In development'}</Chip></div>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="wrapx sec" id="how">
          <div className="eyebrow">How it works</div>
          <h2 className="big">Automation, with a human touch.</h2>
          <p className="lede">Eight stages from first hello to monthly care. Green stages already run through the platform; the rest are led by a person on our team, and every public word is approved by the agent.</p>
          <ol className="lifecycle">
            {LIFECYCLE.map(([t, d, auto]) => <li key={t} className={auto ? 'auto' : ''}><b>{t}</b><span>{d}</span></li>)}
          </ol>
          <div className="grid g3" style={{ marginTop: 12 }}>
            {SCENES.slice(2, 11).map((s) => (
              <figure className="shot" key={s.still} style={{ margin: 0 }}>
                <img src={`/site/stills/${s.still}.jpg`} alt={s.title} loading="lazy" />
                <figcaption><span><b style={{ color: 'var(--ink)' }}>{s.title}.</b> {s.text}</span><Chip kind={s.live ? 'live' : 'dev'}>{s.live ? 'Live' : 'In development'}</Chip></figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="wrapx sec" id="packages">
          <div className="eyebrow">Packages</div>
          <h2 className="big">The right package for each agency, and for the enterprise behind it.</h2>
          <p className="lede">Setup is paid 70% to start and 30% at launch. Upgrades cost only the difference: everything already paid counts toward the new plan.</p>
          <div className="grid g3">
            {PLANS.slice(0, 3).map((p) => (
              <article className={'price' + (p.id === 'growth' ? ' hot' : '')} key={p.id}>
                <div className="spread"><b style={{ font: '800 18px var(--display)' }}>{p.name}</b>{p.id === 'growth' ? <Chip kind="required">Recommended</Chip> : null}</div>
                <span className="muted">{p.forWho}</span>
                <div className="amt">{usd(p.setupCents!)} <small>setup</small></div>
                <div className="soft">{p.careName} {usd(p.careCents!)}/mo from launch</div>
                <ul>{p.includes.map((x) => <li key={x}>{x}</li>)}</ul>
                <Link href={`/start?plan=${p.id}`} className={'btn ' + (p.id === 'growth' ? 'primary' : '')} style={{ justifySelf: 'start' }}>Choose {p.name}</Link>
              </article>
            ))}
          </div>
          <div className="grid g2">
            {PLANS.slice(3).map((p) => (
              <article className="price" key={p.id}>
                <b style={{ font: '800 18px var(--display)' }}>{p.name}</b>
                <span className="muted">{p.forWho}</span>
                <p className="soft">{p.summary}</p>
                <ul>{p.includes.map((x) => <li key={x}>{x}</li>)}</ul>
                <Link href={`/partners?type=${p.id}`} className="btn" style={{ justifySelf: 'start' }}>Talk to us about {p.name}</Link>
              </article>
            ))}
          </div>
          <div className="grid g2">
            <div className="panel">
              <h2>Add-ons</h2>
              <ul className="list">{ADD_ONS.map((a) => <li key={a.name}><div className="spread"><b>{a.name}</b><span className="soft">{a.price}</span></div>{a.note ? <span className="muted" style={{ fontSize: 13 }}>{a.note}</span> : null}</li>)}</ul>
            </div>
            <div className="panel">
              <h2>How fast we answer</h2>
              <ul className="list">{RESPONSE_TIMES.map((r) => <li key={r.plan}><div className="spread"><span>{r.plan}</span><b>{r.reply}</b></div></li>)}</ul>
              <span className="muted" style={{ fontSize: 13 }}>First human response, business hours, Monday to Friday.</span>
            </div>
          </div>
        </section>

        <section className="wrapx sec">
          <div className="eyebrow">Trust</div>
          <h2 className="big">Built the way a carrier would want it built.</h2>
          <div className="grid g3">
            {TRUST.map(([t, d]) => <article className="feature" key={t}><h3>{t}</h3><p>{d}</p></article>)}
          </div>
        </section>

        <section className="wrapx sec">
          <div className="panel" style={{ padding: 28, background: 'linear-gradient(135deg,rgba(255,90,32,.14),rgba(255,163,26,.05))', borderColor: 'rgba(255,106,43,.45)' }}>
            <h2 style={{ font: '800 clamp(22px,3vw,32px)/1.15 var(--display)' }}>Put the right technology inside your agency.</h2>
            <p className="soft">Agencies start with a short call about the office and its goals. Carriers and networks start with a 90-day pilot sized to them.</p>
            <div className="row">
              <Link href="/start" className="btn primary">Start with your agency</Link>
              <Link href="/partners" className="btn">Plan a pilot</Link>
            </div>
          </div>
        </section>
      </main>
    </SiteChrome>
  );
}
