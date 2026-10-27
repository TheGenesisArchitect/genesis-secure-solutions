// Visibility (Growth): one read of how the market finds, chooses, visits and converts for an agency, from what
// Genovus holds for it. Shared by the board (/app/<slug>/visibility) and Helix's brief, so both say the same thing.
// Only real numbers: anything not connected is `null` with the reason, never 0. The Google rating is read live by the
// page (never stored), so it isn't here.
import type { SupabaseClient } from '@supabase/supabase-js';

const DAY = 86_400_000;
export const WINDOW_DAYS = 28;

export type Social = {
  connected: boolean;
  pulledAt: string | null;
  error: string | null;
  followers: { facebook: number | null; instagram: number | null };
  /** Last 28 days, with the 28 days before for comparison (null when Metricool has no history that far back). */
  reach: { now: number | null; before: number | null };
  views: { now: number | null; before: number | null };
  interactions: { now: number | null; before: number | null };
  daily: { day: string; reach: number; views: number }[];
};
export type Funnel = { leads: number; reached: number; booked: number; won: number; medianReplyMin: number | null; bySource: { source: string; leads: number; booked: number; won: number }[] };
export type Rhythm = { published: number; scheduled: number; waiting: number; nextAt: string | null };
export type Move = { title: string; why: string; href: string; cta: string };
export type Visibility = { social: Social; funnel: Funnel; rhythm: Rhythm; ownPlaceId: string | null; moves: Move[] };

const SOURCE: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google', direct: 'Direct visit', partner: 'Partner referral', meta: 'Meta lead form', call: 'Phone call', form: 'Website form' };
export const sourceLabel = (s: string) => SOURCE[s] ?? s.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export async function visibility(db: SupabaseClient, tenantId: string, slug: string): Promise<Visibility> {
  const now = Date.now();
  const since = new Date(now - WINDOW_DAYS * DAY).toISOString();
  const sinceDay = new Date(now - 2 * WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const [t, pull, rows, leads, posts, scan, waitingLeads] = await Promise.all([
    db.from('tenants').select('metricool_blog_id').eq('id', tenantId).single(),
    db.from('visibility_pulls').select('pulled_at, ok, detail').eq('tenant_id', tenantId).eq('source', 'metricool').maybeSingle(),
    db.from('social_daily').select('network, metric, day, value').eq('tenant_id', tenantId).gte('day', sinceDay).order('day'),
    db.from('leads').select('source, channel, status, created_at, first_contact_at, booked_for').eq('tenant_id', tenantId).gte('created_at', since),
    db.from('content_items').select('status, scheduled_for').eq('tenant_id', tenantId).eq('is_sample', false).gte('scheduled_for', since),
    db.from('competitor_scans').select('own_place_id').eq('tenant_id', tenantId).not('own_place_id', 'is', null).order('started_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'new').lt('created_at', new Date(now - 3_600_000).toISOString()),
  ]);

  // Social: sums over the last 28 days (and the 28 before), followers as the latest count.
  const R = (rows.data ?? []) as { network: string; metric: string; day: string; value: number }[];
  const cut = new Date(now - WINDOW_DAYS * DAY).toISOString().slice(0, 10);
  const sum = (metric: string, from: string, to?: string) => {
    const v = R.filter((r) => r.metric === metric && r.day >= from && (!to || r.day < to));
    return v.length ? v.reduce((a, r) => a + Number(r.value), 0) : null;
  };
  const span = (metric: string) => { const d = R.filter((r) => r.metric === metric).map((r) => r.day); return d.length ? d[0] : null; };
  const pair = (metric: string) => {
    const first = span(metric);
    return { now: sum(metric, cut), before: first && first <= sinceDay ? sum(metric, sinceDay, cut) : null };
  };
  const latest = (network: string) => { const f = R.filter((r) => r.network === network && r.metric === 'followers'); return f.length ? Number(f.at(-1)!.value) : null; };
  const days = [...new Set(R.filter((r) => r.day >= cut).map((r) => r.day))].sort();
  const p = pull.data as { pulled_at: string; ok: boolean; detail: { errors?: string[] } } | null;
  const social: Social = {
    connected: Boolean(t.data?.metricool_blog_id),
    pulledAt: p?.pulled_at ?? null,
    error: p && !p.ok ? (p.detail?.errors?.[0] ?? 'Metricool had no numbers yet') : null,
    followers: { facebook: latest('facebook'), instagram: latest('instagram') },
    reach: pair('reach'), views: pair('views'), interactions: pair('interactions'),
    daily: days.map((day) => ({ day, reach: R.filter((r) => r.day === day && r.metric === 'reach').reduce((a, r) => a + Number(r.value), 0), views: R.filter((r) => r.day === day && r.metric === 'views').reduce((a, r) => a + Number(r.value), 0) })),
  };

  // Converted: last 28 days of leads, by where they came from.
  const L = (leads.data ?? []) as { source: string; channel: string; status: string; created_at: string; first_contact_at: string | null; booked_for: string | null }[];
  const isBooked = (l: (typeof L)[number]) => Boolean(l.booked_for) || l.status === 'booked' || l.status === 'won';
  const src = (l: (typeof L)[number]) => (l.channel && l.channel !== 'form' ? l.channel : l.source) || 'direct';
  const groups = new Map<string, { leads: number; booked: number; won: number }>();
  for (const l of L) { const g = groups.get(src(l)) ?? { leads: 0, booked: 0, won: 0 }; g.leads++; if (isBooked(l)) g.booked++; if (l.status === 'won') g.won++; groups.set(src(l), g); }
  const replies = L.filter((l) => l.first_contact_at).map((l) => (Date.parse(l.first_contact_at!) - Date.parse(l.created_at)) / 60_000).sort((a, b) => a - b);
  const funnel: Funnel = {
    leads: L.length, reached: L.filter((l) => l.status !== 'new' || l.first_contact_at).length, booked: L.filter(isBooked).length, won: L.filter((l) => l.status === 'won').length,
    medianReplyMin: replies.length ? replies[Math.floor(replies.length / 2)] : null,
    bySource: [...groups].map(([source, g]) => ({ source, ...g })).sort((a, b) => b.leads - a.leads),
  };

  // Posting rhythm: what went out in the window and what's coming.
  const P = (posts.data ?? []) as { status: string; scheduled_for: string | null }[];
  const ahead = P.filter((x) => x.scheduled_for && Date.parse(x.scheduled_for) > now).sort((a, b) => a.scheduled_for!.localeCompare(b.scheduled_for!));
  const rhythm: Rhythm = {
    published: P.filter((x) => x.status === 'published').length,
    scheduled: ahead.filter((x) => ['approved', 'scheduled'].includes(x.status)).length,
    waiting: ahead.filter((x) => x.status === 'in_review').length,
    nextAt: ahead.find((x) => ['approved', 'scheduled'].includes(x.status))?.scheduled_for ?? null,
  };

  // The moves: what the numbers say to do next, most urgent first. Each opens the tool that does it.
  const base = `/app/${slug}`;
  const moves: Move[] = [];
  const stale = waitingLeads.count ?? 0;
  if (stale) moves.push({ title: `Call back ${stale} new lead${stale === 1 ? '' : 's'} waiting over an hour`, why: 'A lead reached in the first five minutes is far likelier to book than one reached an hour later.', href: `${base}/leads`, cta: 'Open Leads' });
  if (rhythm.waiting) moves.push({ title: `Approve ${rhythm.waiting} post${rhythm.waiting === 1 ? '' : 's'} waiting on you`, why: 'Approved posts go out on time; a post approved after its time waits for a new one.', href: `${base}/approvals`, cta: 'Review posts' });
  if (!rhythm.scheduled && !rhythm.waiting) moves.push({ title: 'Nothing is scheduled to post', why: 'A steady rhythm keeps your name in front of the people who already follow you.', href: `${base}/care`, cta: 'Ask for posts' });
  if (funnel.won) moves.push({ title: `Ask your ${funnel.won} newest customer${funnel.won === 1 ? '' : 's'} for a Google review`, why: 'Ask every customer the same way. Reviews help you get picked on the map.', href: `${base}/assets`, cta: 'Review card' });
  if (funnel.leads && funnel.booked / funnel.leads < 0.3) moves.push({ title: 'Book more of the leads you reach', why: `${funnel.booked} of ${funnel.leads} leads booked in ${WINDOW_DAYS} days.`, href: `${base}/pipeline`, cta: 'Open Pipeline' });
  return { social, funnel, rhythm, ownPlaceId: scan.data?.own_place_id ?? null, moves: moves.slice(0, 3) };
}

/** One line for Helix's brief, from the same numbers. */
export function visibilityLine(v: Visibility): string {
  const n = (x: number | null) => (x == null ? 'not available' : Math.round(x).toLocaleString('en-US'));
  const s = v.social;
  const social = s.connected
    ? `social (Metricool${s.pulledAt ? `, pulled ${s.pulledAt.slice(0, 10)}` : ', not pulled yet'}): followers Facebook ${n(s.followers.facebook)}, Instagram ${n(s.followers.instagram)}; last ${WINDOW_DAYS} days reach ${n(s.reach.now)}, views ${n(s.views.now)}, interactions ${n(s.interactions.now)}`
    : 'social: no Metricool brand connected';
  return `VISIBILITY (last ${WINDOW_DAYS} days): ${social}; posts published ${v.rhythm.published}, scheduled ${v.rhythm.scheduled}, waiting on the owner ${v.rhythm.waiting}; leads ${v.funnel.leads}, reached ${v.funnel.reached}, booked ${v.funnel.booked}, won ${v.funnel.won}. Not connected yet: Google search positions, Business Profile views and reviews, website visits (say so; never guess them).`;
}
