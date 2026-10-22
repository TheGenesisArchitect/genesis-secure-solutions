// Partners (Growth): the local businesses whose customers buy what this agency sells (car dealers for Auto,
// realtors and lenders for Home, marinas for Boat, RV dealers for RV, ...), mapped within the office's radius by
// the partner radar. The Call Desk on top says who to call next and why; the board below tracks every relationship
// from first call to referring. Each partner's referral link sends leads into Leads, tagged with their name.
// Names and phones come live from Google Maps (only place IDs are stored), so only the cards on screen look them up.
import Link from 'next/link';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { PartnerActions } from '@/components/PartnerActions';
import { HelixAskButton } from '@/components/HelixDrawer';
import { Panel, Chip, Tile, Empty } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';
import { GOOGLE_ATTRIBUTION, getDetails, getSummary } from '@/lib/places';
import { LINES, momentsNow, partnerCategories, type LineId } from '@/lib/lines';

export const metadata = { title: 'Partners' };
export const dynamic = 'force-dynamic';

type P = { id: string; place_id: string; line: string; category: string; distance_mi: number; fit: number; status: string; ref_code: string; next_action_at: string | null; contact_name: string | null; notes: string | null; known_name: string | null };
const STATUS: Record<string, [string, string]> = { new: ['To call', 'info'], called: ['Called', 'pending'], meeting: ['Visit booked', 'pending'], partner: ['Partner', 'done'], referring: ['Referring', 'done'], not_now: ['Not now', ''], opted_out: ['Do not contact', 'bad'] };
const COLS = [['called', 'Called'], ['meeting', 'Visit booked'], ['partner', 'Partner'], ['referring', 'Referring']] as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const mapsUrl = (placeId: string) => `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`;

export default async function Partners({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  if (!access.has('partners')) return <AgencyShell ctx={ctx} title="Partners"><ModuleGate ctx={ctx} moduleKey="partners" /></AgencyShell>;
  const supabase = await db();
  const [{ data: prof }, { data: rows }, { data: refs }] = await Promise.all([
    supabase.from('agency_profiles').select('lines, service_radius_mi, website, city').eq('tenant_id', ctx.tenant.tenantId).maybeSingle(),
    supabase.from('partner_targets').select('id, place_id, line, category, distance_mi, fit, status, ref_code, next_action_at, contact_name, notes, known_name').eq('tenant_id', ctx.tenant.tenantId).neq('status', 'opted_out').order('fit', { ascending: false }).limit(2000),
    supabase.from('leads').select('partner_id').eq('tenant_id', ctx.tenant.tenantId).not('partner_id', 'is', null),
  ]);
  const all = (rows ?? []) as P[];
  const cats = partnerCategories(prof?.lines);
  const catOf = (k: string) => cats.find((c) => c.key === k);
  const inSeason = new Set<string>(momentsNow(prof?.lines).map((m) => m.line));
  const referred = (refs ?? []).reduce<Record<string, number>>((a, r) => ({ ...a, [r.partner_id!]: (a[r.partner_id!] ?? 0) + 1 }), {});
  const now = Date.now();
  // The Call Desk: unworked or due partners, best fit first, a nudge for lines in season.
  const desk = all
    .filter((p) => p.status === 'new' || (p.status === 'called' && (!p.next_action_at || new Date(p.next_action_at).getTime() <= now)))
    .map((p) => ({ ...p, score: p.fit + (inSeason.has(p.line) ? 15 : 0) - (p.status === 'called' ? 5 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const working = all.filter((p) => p.status !== 'new' && p.status !== 'not_now');
  const [deskInfo, boardInfo] = await Promise.all([Promise.all(desk.map((p) => getDetails(p.place_id))), Promise.all(working.slice(0, 40).map((p) => (p.known_name ? Promise.resolve({ name: p.known_name, address: '' }) : getSummary(p.place_id))))]);
  const nameOf = new Map(working.slice(0, 40).map((p, i) => [p.id, boardInfo[i]?.name ?? null]));
  const refLink = (code: string) => prof?.website ? `${prof.website}/?utm_source=partner&utm_campaign=${code}` : null;
  const byLine = (Object.keys(LINES) as LineId[]).filter((l) => (prof?.lines ?? []).includes(l)).map((l) => ({ l, n: all.filter((p) => p.line === l).length }));
  const partnersNow = all.filter((p) => p.status === 'partner' || p.status === 'referring').length;
  const totalReferred = Object.values(referred).reduce((a, b) => a + b, 0);

  if (!all.length) {
    return (
      <AgencyShell ctx={ctx} title="Partners">
        <Empty title="Your partner map is being drawn">
          Genovus maps the businesses within {prof?.service_radius_mi ?? 15} miles of your office whose customers buy what you sell: {cats.length ? [...new Set(cats.map((c) => c.label.toLowerCase()))].slice(0, 6).join(', ') : 'set your lines of business first'}. They’ll appear here, best fit first, with who to call and why.
        </Empty>
      </AgencyShell>
    );
  }
  return (
    <AgencyShell ctx={ctx} title="Partners">
      <div className="grid g4">
        <Tile label="Mapped near you" value={all.length} hint={`Within ${prof?.service_radius_mi ?? 15} miles, only businesses that fit your lines`} />
        <Tile label="In conversation" value={all.filter((p) => p.status === 'called' || p.status === 'meeting').length} hint={(() => { const v = all.filter((p) => p.status === 'meeting').length; return `${v} visit${v === 1 ? '' : 's'} booked`; })()} />
        <Tile label="Partners" value={partnersNow} hint="Agreed to refer customers" />
        <Tile label="Referred leads" value={totalReferred} hint="Came in through a partner’s link" />
      </div>

      <Panel title="Call Desk" sub="The next best partners to call. One tap logs the outcome; a booked visit goes on your calendar.">
        {desk.length ? desk.map((p, i) => {
          const d = deskInfo[i], c = catOf(p.category), season = inSeason.has(p.line);
          return (
            <article key={p.id} className="partner-card" data-helix-item={d?.name || c?.label || p.category} data-helix-ref={`partner:${p.id}`}
              data-helix-facts={`${c?.label ?? p.category} · ${p.distance_mi} mi · ${LINES[p.line as LineId]?.label ?? p.line} · fit ${p.fit} · ${STATUS[p.status]?.[0] ?? p.status}${season ? ' · in season now' : ''}${d?.website ? ' · has a website' : ''}`}>
              <div className="spread" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span style={{ display: 'grid', gap: 2 }}>
                  <b>{d?.name || c?.label || p.category}</b>
                  <span className="muted" style={{ fontSize: 13 }}>{c?.label ?? p.category} · {p.distance_mi} mi · {LINES[p.line as LineId]?.label}{season ? ` · ${momentsNow(prof?.lines).find((m) => m.line === p.line)?.label} now` : ''}</span>
                </span>
                <span className="row" style={{ gap: 6 }}>{p.status === 'called' ? <Chip kind="pending">Try again</Chip> : null}<Chip kind={p.fit >= 80 ? 'done' : 'info'}>Fit {p.fit}</Chip></span>
              </div>
              {c ? <p className="muted" style={{ margin: 0, fontSize: 13 }}><b>Why they’d refer:</b> {c.pitch}</p> : null}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {d?.phone ? <a className="btn small" href={`tel:${d.phone.replace(/[^\d+]/g, '')}`}>Call {d.phone}</a> : null}
                <a className="btn small ghost" href={d?.mapsUrl ?? mapsUrl(p.place_id)} target="_blank" rel="noreferrer">Map</a>
                {d?.website ? <a className="btn small ghost" href={d.website} target="_blank" rel="noreferrer">Website</a> : null}
                <HelixAskButton label="Talking points" question={`Give me talking points for calling this ${c?.label ?? 'business'} about referring their customers to us (use their card and their website).`} context={`partner partner:${p.id}: ${c?.label ?? p.category}, ${p.distance_mi} miles from the office, line ${LINES[p.line as LineId]?.label}${season ? ', in season now' : ''}, status ${p.status}`} />
              </div>
              <PartnerActions id={p.id} status={p.status} refLink={refLink(p.ref_code)} name={d?.name ?? null} knownName={p.known_name} />
            </article>
          );
        }) : <p className="muted" style={{ margin: 0 }}>Everyone on your map has been called. New businesses appear after the next map refresh.</p>}
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>{GOOGLE_ATTRIBUTION}</p>
      </Panel>

      <Panel title="Your partner board" sub={`From first call to referring. ${prof?.website ? 'Partners get a referral link: their leads arrive tagged with their name.' : 'Add your website in your profile to give partners a referral link.'}`}>
        <div className="board">
          {COLS.map(([key, label]) => {
            const col = working.filter((p) => p.status === key);
            return (
              <section key={key} className="board-col" aria-label={label}>
                <header><b>{label}</b><span className="num muted">{col.length}</span></header>
                {col.map((p) => (
                  <article key={p.id} className="board-card" data-helix-item={nameOf.get(p.id) || catOf(p.category)?.label || p.category} data-helix-ref={`partner:${p.id}`}
                    data-helix-facts={`${catOf(p.category)?.label ?? p.category} · ${p.distance_mi} mi · fit ${p.fit} · ${STATUS[p.status]?.[0] ?? p.status}${p.next_action_at && p.status === 'meeting' ? ` · visit ${when(p.next_action_at)}` : ''}${p.contact_name ? ` · contact ${p.contact_name}` : ''}${referred[p.id] ? ` · ${referred[p.id]} referred` : ''}`}>
                    <b>{nameOf.get(p.id) || catOf(p.category)?.label || p.category}</b>
                    <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}><Chip kind={STATUS[p.status][1]}>{STATUS[p.status][0]}</Chip><span className="muted" style={{ fontSize: 12 }}>{catOf(p.category)?.label} · {p.distance_mi} mi</span></span>
                    {p.next_action_at && p.status === 'meeting' ? <span style={{ fontSize: 13 }}><b>Visit:</b> {when(p.next_action_at)}{p.contact_name ? ` with ${p.contact_name}` : ''}</span> : null}
                    {referred[p.id] ? <span style={{ fontSize: 13 }}><b>{referred[p.id]}</b> referred lead{referred[p.id] === 1 ? '' : 's'}</span> : null}
                    <PartnerActions id={p.id} status={p.status} refLink={refLink(p.ref_code)} name={nameOf.get(p.id) ?? null} knownName={p.known_name} />
                  </article>
                ))}
                {!col.length ? <span className="muted" style={{ fontSize: 13, padding: '8px 0' }}>None yet.</span> : null}
              </section>
            );
          })}
        </div>
      </Panel>

      <Panel title="Who’s on your map" sub="Counted by the line their customers buy.">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {byLine.map(({ l, n }) => <Chip key={l} kind={inSeason.has(l) ? 'done' : 'info'}>{LINES[l].label} · {n}{inSeason.has(l) ? ' · in season' : ''}</Chip>)}
          <Link className="btn small ghost" href={`/app/${slug}/market`}>See your market →</Link>
        </div>
      </Panel>
    </AgencyShell>
  );
}
