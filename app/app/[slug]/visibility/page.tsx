// Visibility (Growth): how the market finds, chooses, visits and converts for this agency, on one board, with the
// moves the numbers point to. Only real numbers: what isn't connected yet says so and what it needs, never zero.
// Converted and the posting rhythm come from Leads and the content calendar; Visited from the agency's own Metricool
// brand (pulled daily); Chosen is the Google rating, read live on each visit and never stored.
import Link from 'next/link';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { Panel, Tile, Chip } from '@/components/ui';
import { VisibilityChart } from '@/components/VisibilityChart';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';
import { GOOGLE_ATTRIBUTION, getOfficeCard } from '@/lib/places';
import { visibility, sourceLabel, WINDOW_DAYS } from '@/lib/visibility';

export const metadata = { title: 'Visibility' };
export const dynamic = 'force-dynamic';

const n = (v: number | null) => (v == null ? '—' : Math.round(v).toLocaleString('en-US'));
const change = (now: number | null, before: number | null) => {
  if (now == null || before == null || before === 0) return null;
  const pct = Math.round(((now - before) / before) * 100);
  return { pct, up: pct >= 0 };
};
const minutes = (m: number | null) => (m == null ? '—' : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export default async function VisibilityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  if (!access.has('visibility')) return <AgencyShell ctx={ctx} title="Visibility"><ModuleGate ctx={ctx} moduleKey="visibility" /></AgencyShell>;
  const v = await visibility(await db(), ctx.tenant.tenantId, slug);
  const own = v.ownPlaceId ? await getOfficeCard(v.ownPlaceId).catch(() => null) : null;
  const s = v.social, f = v.funnel, r = v.rhythm;
  const views = change(s.views.now, s.views.before);
  const followers = (s.followers.facebook ?? 0) + (s.followers.instagram ?? 0);
  const hasFollowers = s.followers.facebook != null || s.followers.instagram != null;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const top = f.bySource[0];

  return (
    <AgencyShell ctx={ctx} title="Visibility">
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>How your market finds you, picks you, visits and becomes a customer. Every number shows where it comes from; anything not connected yet says what it needs.</p>

      <section className="vis-loop" aria-label="Found, chosen, visited, converted">
        <a className="vis-stage" href="#found">
          <span className="vis-verb">Found <Chip>not measured yet</Chip></span>
          <span className="vis-n muted">—</span>
          <span className="vis-q">Where you show up on Google’s map and in searches</span>
        </a>
        <a className="vis-stage" href="#chosen">
          <span className="vis-verb">Chosen {own?.rating != null ? <Chip kind="done">live</Chip> : <Chip>not connected</Chip>}</span>
          <span className="vis-n">{own?.rating != null ? `${own.rating.toFixed(1)} ★` : '—'}</span>
          <span className="vis-q">{own?.rating != null ? `Google rating · ${own.reviews} review${own.reviews === 1 ? '' : 's'}` : 'Your Google rating, once your listing is matched'}</span>
        </a>
        <a className="vis-stage" href="#visited">
          <span className="vis-verb">Visited {s.connected && !s.error && s.pulledAt ? <Chip kind="done">live</Chip> : <Chip>{s.connected ? 'first pull pending' : 'not connected'}</Chip>}</span>
          <span className="vis-n">{n(s.views.now)}</span>
          <span className="vis-q">views on Facebook and Instagram, last {WINDOW_DAYS} days</span>
          {views ? <span className={`vis-d${views.up ? '' : ' down'}`}>{views.up ? '▲' : '▼'} {Math.abs(views.pct)}% vs the {WINDOW_DAYS} days before</span> : null}
        </a>
        <a className="vis-stage" href="#converted">
          <span className="vis-verb">Converted <Chip kind="done">live</Chip></span>
          <span className="vis-n">{f.leads}</span>
          <span className="vis-q">leads · {f.booked} booked · {f.won} won, last {WINDOW_DAYS} days</span>
          {top ? <span className="vis-d">Most from {sourceLabel(top.source)}</span> : null}
        </a>
      </section>

      {v.moves.length ? (
        <section className="vis-move" aria-label="Your next moves">
          <div className="vis-egg" aria-hidden="true" />
          <div className="vis-move-body">
            <span className="eyebrow">Helix · your next move</span>
            <h2>{v.moves[0].title}</h2>
            <p className="soft">{v.moves[0].why}</p>
            {v.moves.length > 1 ? <ul className="vis-more">{v.moves.slice(1).map((m) => <li key={m.title}><Link href={m.href}>{m.title}</Link></li>)}</ul> : null}
          </div>
          <Link className="btn primary" href={v.moves[0].href}>{v.moves[0].cta}</Link>
        </section>
      ) : null}

      <div className="grid g2">
        <Panel id="converted" title="From lead to customer" sub={`Last ${WINDOW_DAYS} days, from your Leads`}>
          {f.leads ? (
            <>
              <div className="vis-funnel">
                {[['Leads', f.leads, null], ['Reached', f.reached, `${pct(f.reached, f.leads)} of leads · median ${minutes(f.medianReplyMin)} to first call`], ['Booked', f.booked, `${pct(f.booked, f.reached)} of reached`], ['Won', f.won, `${pct(f.won, f.booked)} of booked`]].map(([label, val, note]) => (
                  <div key={label as string} className="vis-f">
                    <span className="vis-fl">{label}</span>
                    <span className="vis-fw" style={{ width: `${Math.max(8, ((val as number) / Math.max(1, f.leads)) * 100)}%` }}>{val as number}</span>
                    {note ? <span className="vis-fr">{note as string}</span> : null}
                  </div>
                ))}
              </div>
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Where they came from</th><th className="num">Leads</th><th className="num">Booked</th><th className="num">Won</th></tr></thead>
                  <tbody>{f.bySource.map((g) => <tr key={g.source}><td>{sourceLabel(g.source)}</td><td className="num">{g.leads}</td><td className="num">{g.booked}</td><td className="num">{g.won}</td></tr>)}</tbody>
                </table>
              </div>
            </>
          ) : <p className="soft">No leads in the last {WINDOW_DAYS} days yet. New leads from your site, calls and partners show up here with where they came from.</p>}
        </Panel>

        <Panel id="visited" title="Social reach" sub={s.connected ? `Facebook and Instagram, from Metricool${s.pulledAt ? ` · updated ${when(s.pulledAt)}` : ''}` : 'Facebook and Instagram'}>
          {s.connected && s.pulledAt && !s.error ? (
            <>
              <div className="grid g4">
                <Tile label="Followers" value={<span className="num">{hasFollowers ? followers.toLocaleString('en-US') : '—'}</span>} hint={`Facebook ${n(s.followers.facebook)} · Instagram ${n(s.followers.instagram)}`} />
                <Tile label="Views" value={<span className="num">{n(s.views.now)}</span>} hint={`Last ${WINDOW_DAYS} days`} />
                <Tile label="People reached" value={<span className="num">{n(s.reach.now)}</span>} hint="Instagram, last 28 days" />
                <Tile label="Interactions" value={<span className="num">{n(s.interactions.now)}</span>} hint="Likes, comments, shares, saves" />
              </div>
              <VisibilityChart days={s.daily} />
            </>
          ) : (
            <div className="vis-connect">
              <b>{s.connected ? (s.error ? 'Metricool didn’t have numbers for us yet' : 'The first pull runs within the hour') : 'Connect your Facebook and Instagram'}</b>
              <span className="soft">{s.connected ? (s.error ? `It said: ${s.error}. We try again every 12 hours.` : 'Your followers, views and reach appear here, updated twice a day.') : 'The Genovus team connects your pages in Metricool; your numbers appear here the same day.'}</span>
            </div>
          )}
        </Panel>

        <Panel id="chosen" title="Why people pick you" sub="Your Google rating, read live each time you open this page">
          {own?.rating != null ? (
            <div className="grid g4">
              <Tile label="Google rating" value={<span className="num">{own.rating.toFixed(1)} ★</span>} hint={`${own.reviews} review${own.reviews === 1 ? '' : 's'}`} />
              <Tile label="Reviews over time" value="—" hint="Needs your Business Profile (manager access)" />
            </div>
          ) : <p className="soft">We match your Google listing when your Competitor Radar maps your area. Then your rating shows here, live.</p>}
          <p className="muted" style={{ fontSize: 12.5 }}>Ask every customer for a review the same way. Google doesn’t allow asking only happy customers.{own?.rating != null ? ` ${GOOGLE_ATTRIBUTION}.` : ''}</p>
        </Panel>

        <Panel title="Posting rhythm" sub={`Your content calendar, last ${WINDOW_DAYS} days and ahead`}>
          <div className="grid g4">
            <Tile label="Published" value={<span className="num">{r.published}</span>} hint={`Last ${WINDOW_DAYS} days`} />
            <Tile label="Scheduled" value={<span className="num">{r.scheduled}</span>} hint={r.nextAt ? `Next ${when(r.nextAt)}` : 'Approved and booked'} />
            <Tile label="Waiting on you" value={<span className="num">{r.waiting}</span>} hint={r.waiting ? <Link href={`/app/${slug}/approvals`}>Review them</Link> : 'Nothing to approve'} />
          </div>
        </Panel>
      </div>

      <Panel id="found" title="Still to connect" sub="Each one adds a piece of the picture. Until then, the board leaves it blank.">
        <div className="vis-todo">
          <div><b>Your position on Google’s map</b><span className="soft">Your rank for auto, home, boat, RV and motorcycle insurance at points around your office.</span><Chip kind="warn">needs a priced yes · about $4 a sweep</Chip></div>
          <div><b>What people search to find you</b><span className="soft">Searches, how often you show up, your position and clicks, from Google Search Console.</span><Chip kind="info">needs access to Search Console</Chip></div>
          <div><b>Profile views, calls, directions and reviews</b><span className="soft">From your Google Business Profile.</span><Chip kind="info">needs manager access on your listing</Chip></div>
          <div><b>Website visits and taps</b><span className="soft">Visits, call taps, directions and quote clicks on your website.</span><Chip kind="info">needs your site’s analytics shared</Chip></div>
        </div>
      </Panel>
    </AgencyShell>
  );
}
