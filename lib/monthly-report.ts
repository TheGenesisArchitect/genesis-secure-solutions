// The monthly report (Growth and Premium): last month's numbers for an agency and the one improvement for next month.
// Written on the 1st by the daily job as a kpi_snapshots row (the Performance page reads the same rows), then
// waiting on one team tap ("Send <agency>'s October report") before it emails the owner. Only real numbers; what
// isn't measured is left out, never zero. Server only.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminDb } from './supabase/admin';
import { MODULES, includes, programOf } from './programs';
import { sourceLabel } from './visibility';

const monthLabel = (period: string) => new Date(`${period}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const nextMonth = (period: string) => { const d = new Date(`${period}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
/** The first of last month, in office time. */
export const lastPeriod = (now = new Date()) => { const ny = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })); return new Date(Date.UTC(ny.getFullYear(), ny.getMonth() - 1, 1)).toISOString().slice(0, 10); };

export type ReportMetrics = {
  leads: number; reached: number; bookings: number; policies: number; callbacks: number; responseMinutes?: number;
  bySource: { source: string; leads: number; won: number }[]; posts: number; reach?: number; views?: number; engagement?: number;
  reviewsAsked: number; improvement: string; why: string;
};

export async function buildReport(db: SupabaseClient, tenantId: string, period: string): Promise<ReportMetrics> {
  const from = new Date(`${period}T05:00:00Z`).toISOString(), to = new Date(`${nextMonth(period)}T05:00:00Z`).toISOString();
  const [{ data: leads }, { data: posts }, { data: social }] = await Promise.all([
    db.from('leads').select('source, channel, medium, status, created_at, first_contact_at, booked_for, review_requested_at').eq('tenant_id', tenantId).gte('created_at', from).lt('created_at', to),
    db.from('content_items').select('id').eq('tenant_id', tenantId).eq('status', 'published').eq('is_sample', false).gte('scheduled_for', from).lt('scheduled_for', to),
    db.from('social_daily').select('metric, value').eq('tenant_id', tenantId).gte('day', period).lt('day', nextMonth(period)),
  ]);
  const L = leads ?? [];
  const replies = L.filter((l) => l.first_contact_at).map((l) => (Date.parse(l.first_contact_at!) - Date.parse(l.created_at)) / 60_000).sort((a, b) => a - b);
  const src = (l: (typeof L)[number]) => (l.channel && l.channel !== 'form' ? l.channel : l.source) || 'direct';
  const by = new Map<string, { leads: number; won: number }>();
  for (const l of L) { const g = by.get(src(l)) ?? { leads: 0, won: 0 }; g.leads++; if (l.status === 'won') g.won++; by.set(src(l), g); }
  const sum = (m: string) => { const v = (social ?? []).filter((x) => x.metric === m); return v.length ? v.reduce((a, x) => a + Number(x.value), 0) : undefined; };
  const m = {
    leads: L.length, reached: L.filter((l) => l.status !== 'new' || l.first_contact_at).length,
    bookings: L.filter((l) => l.booked_for || ['booked', 'won'].includes(l.status)).length, policies: L.filter((l) => l.status === 'won').length,
    callbacks: L.filter((l) => l.medium === 'callback').length, ...(replies.length ? { responseMinutes: Math.round(replies[Math.floor(replies.length / 2)]) } : {}),
    bySource: [...by].map(([source, g]) => ({ source, ...g })).sort((a, b) => b.leads - a.leads),
    posts: (posts ?? []).length, reach: sum('reach'), views: sum('views'), engagement: sum('interactions'),
    reviewsAsked: L.filter((l) => l.review_requested_at).length,
  };
  // One improvement: the weakest link that moves the most, in plain words.
  const pick = (): [string, string] => {
    if (m.leads && m.responseMinutes != null && m.responseMinutes > 15) return ['Call new leads back within 15 minutes', `Your median first call was ${m.responseMinutes} minutes. Leads reached in the first few minutes book far more often.`];
    if (m.leads >= 3 && m.bookings / m.leads < 0.3) return ['Book more of the leads you reach', `${m.bookings} of ${m.leads} leads booked a consult. Offer two times on the first call.`];
    if (m.policies && m.reviewsAsked < m.policies) return ['Ask every new customer for a review', `${m.policies} new customer${m.policies === 1 ? '' : 's'}, ${m.reviewsAsked} asked. One tap on each won lead sends the same ask to all.`];
    if (m.posts < 4) return ['Post at least once a week', `${m.posts} post${m.posts === 1 ? '' : 's'} went out. A steady rhythm keeps you in front of the people who already follow you.`];
    const top = m.bySource[0];
    if (top) return [`Lean into ${sourceLabel(top.source)}`, `It brought ${top.leads} of your ${m.leads} leads. Give it one more push next month.`];
    return ['Get your first leads flowing', 'Share your site and Google listing with past customers and your referral partners.'];
  };
  const [improvement, why] = pick();
  return { ...m, improvement, why };
}

/** The daily job: on or after the 1st, write last month's report for each Growth/Premium agency (once) and queue the
 *  team's "send it" tap. */
export async function writeMonthlyReports(now = new Date(), only?: string): Promise<number> {
  const db = adminDb();
  const period = lastPeriod(now);
  let q = db.from('tenants').select('id, name, plan').eq('kind', 'agency').eq('is_sample', false).in('stage', ['care', 'review', 'build']);
  if (only) q = q.eq('id', only);
  const { data: ts } = await q;
  let n = 0;
  for (const t of ts ?? []) {
    // The report is a Growth module: the plan includes it, or a live grant (a trial) does (as lib/access.ts decides).
    const mod = MODULES.find((x) => x.key === 'report')!;
    const granted = (await db.from('module_grants').select('until').eq('tenant_id', t.id).eq('module_key', 'report').is('revoked_at', null)).data?.some((g) => !g.until || Date.parse(g.until) > Date.now());
    if (!includes(programOf(t.plan as string | null), mod) && !granted) continue;
    const { data: have } = await db.from('kpi_snapshots').select('tenant_id').eq('tenant_id', t.id).eq('period', period).maybeSingle();
    if (have) continue;
    const metrics = await buildReport(db, t.id as string, period);
    const { error } = await db.from('kpi_snapshots').insert({ tenant_id: t.id, period, metrics });
    if (error) continue;
    await db.from('approvals').insert({ tenant_id: t.id, subject_kind: 'report', approver: 'team', lane: 'queued', title: `Send ${t.name}’s ${monthLabel(period)} report`, body: { action: 'send_report', period, text: `${metrics.leads} leads, ${metrics.bookings} booked, ${metrics.policies} won. Next month: ${metrics.improvement}.` } });
    n++;
  }
  return n;
}

/** After the team's tap: the report email to the agency's owners (or the email on record before they have a dashboard). */
export async function sendReport(tenantId: string, period: string, origin: string): Promise<{ ok: string } | { err: string }> {
  const db = adminDb();
  const [{ data: t }, { data: snap }, { data: owners }, { data: rec }] = await Promise.all([
    db.from('tenants').select('name, slug, is_sample').eq('id', tenantId).single(),
    db.from('kpi_snapshots').select('metrics').eq('tenant_id', tenantId).eq('period', period).maybeSingle(),
    db.from('memberships').select('user_id').eq('tenant_id', tenantId).eq('role', 'owner'),
    db.from('agent_records').select('data').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle(),
  ]);
  if (!t || !snap) return { err: 'That report isn’t written yet.' };
  const emails = new Set<string>();
  for (const o of owners ?? []) { const e = (await db.auth.admin.getUserById(o.user_id as string)).data.user?.email; if (e) emails.add(e.toLowerCase()); }
  const recEmail = (rec?.data as { email?: string } | null)?.email;
  if (!emails.size && recEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recEmail)) emails.add(recEmail.toLowerCase());
  if (!emails.size) return { err: 'No email for this agency yet.' };
  const m = snap.metrics as ReportMetrics;
  if (!t.is_sample) for (const to of emails) {
    await db.from('outbox').insert({ tenant_id: tenantId, to_email: to, template: 'monthly_report', data: { agency: t.name, month: monthLabel(period), leads: String(m.leads), booked: String(m.bookings), won: String(m.policies), improvement: m.improvement, why: m.why, link: `${origin}/app/${t.slug}/report` }, dedupe_key: `report:${tenantId}:${period}:${to}` });
  }
  return { ok: `The ${monthLabel(period)} report went to ${[...emails].join(', ')}.` };
}
