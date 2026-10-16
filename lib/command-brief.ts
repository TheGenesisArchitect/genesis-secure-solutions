// The Command Brief's action cards: the day's moves, each built from real records (a lead, an inquiry, an approval)
// so every button does its job right there. Read with the viewer's own session (row-level security). Helix's written
// brief is the summary above them; these are what you can do about it.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { businessToday } from './billing';
import { momentsNow, LINES, partnerCategories } from './lines';
import { STAGE_LABEL, type Stage } from '@/components/ui';

export type BriefAction =
  | { kind: 'tel'; label: string; href: string; primary?: boolean; done?: boolean }
  | { kind: 'link'; label: string; href: string; primary?: boolean }
  | { kind: 'helix'; label: string; question: string; context?: string; primary?: boolean }
  | { kind: 'act'; label: string; action: 'mark_lead'; args: Record<string, string>; primary?: boolean };
export type BriefCard = { id: string; lane: string; tone: 'urgent' | 'today' | 'idea'; title: string; why: string; actions: BriefAction[] };

const ago = (iso: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000)); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const et = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const tel = (p?: string | null) => (p ? `tel:${p.replace(/[^\d+]/g, '')}` : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** An agency's day: calls first, then today's consults, follow-ups, approvals, the team's questions, the market. */
export async function agencyCards(db: SupabaseClient, tenantId: string, slug: string, opts: { isOwner: boolean; has: (k: string) => boolean }): Promise<BriefCard[]> {
  const base = `/app/${slug}`;
  const today = businessToday();
  const dayStart = new Date(`${today}T00:00:00-04:00`).toISOString(), dayEnd = new Date(`${today}T23:59:59-04:00`).toISOString();
  const [fresh, missed, consults, due, approvals, care, prof, partners] = await Promise.all([
    db.from('leads').select('id, name, phone, topic, source, channel, created_at').eq('tenant_id', tenantId).eq('status', 'new').order('created_at', { ascending: false }).limit(4),
    db.from('calls').select('id, from_e164, started_at, lead_id').eq('tenant_id', tenantId).eq('status', 'missed').gte('started_at', new Date(Date.now() - 86_400_000).toISOString()).order('started_at', { ascending: false }).limit(3),
    db.from('leads').select('id, name, phone, topic, booked_for').eq('tenant_id', tenantId).eq('status', 'booked').gte('booked_for', dayStart).lte('booked_for', dayEnd).order('booked_for'),
    db.from('follow_ups').select('id, who, reason, due_on, due_at').eq('tenant_id', tenantId).eq('status', 'open').lte('due_on', today).order('due_on').limit(20),
    opts.isOwner ? db.from('approvals').select('id, title').eq('tenant_id', tenantId).eq('status', 'pending').eq('approver', 'client') : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    db.from('care_requests').select('id, title').eq('tenant_id', tenantId).eq('status', 'waiting_client').limit(3),
    db.from('agency_profiles').select('lines').eq('tenant_id', tenantId).maybeSingle(),
    opts.has('partners') ? db.from('partner_targets').select('id, category, line, distance_mi, fit').eq('tenant_id', tenantId).eq('status', 'new').order('fit', { ascending: false }).limit(1) : Promise.resolve({ data: [] as { id: string; category: string; line: string; distance_mi: number; fit: number }[] }),
  ]);
  const cards: BriefCard[] = [];
  for (const l of fresh.data ?? []) {
    const how = [l.topic, l.channel === 'call' ? 'called the office' : l.channel === 'partner' ? 'from a partner' : `via ${l.source}`, ago(l.created_at)].filter(Boolean).join(' · ');
    cards.push({ id: `lead:${l.id}`, lane: 'Call now', tone: 'urgent', title: `Call ${l.name}`, why: `New lead · ${how}`, actions: [
      ...(tel(l.phone) ? [{ kind: 'tel' as const, label: 'Call', href: tel(l.phone)!, primary: true }] : []),
      { kind: 'helix', label: 'What should I ask?', question: `What should I ask ${l.name} on the first call? A short intake checklist for their line.`, context: `lead ${l.name}, ${l.topic ?? 'no topic'}` },
      { kind: 'act', label: 'Mark called', action: 'mark_lead', args: { lead: l.name, status: 'contacted' } },
    ] });
  }
  for (const c of missed.data ?? []) {
    if (c.lead_id && (fresh.data ?? []).some((l) => l.id === c.lead_id)) continue; // already a "Call" card
    cards.push({ id: `call:${c.id}`, lane: 'Call now', tone: 'urgent', title: `Call back ${c.from_e164 ?? 'a missed caller'}`, why: `Missed call · ${ago(c.started_at)}`, actions: [
      ...(tel(c.from_e164) ? [{ kind: 'tel' as const, label: 'Call back', href: tel(c.from_e164)!, primary: true }] : []),
      { kind: 'link', label: 'Open Today', href: `${base}/today` },
    ] });
  }
  for (const l of consults.data ?? []) {
    cards.push({ id: `consult:${l.id}`, lane: 'Today', tone: 'today', title: `Consult with ${l.name} at ${et(l.booked_for!)}`, why: l.topic ? `${l.topic} · booked` : 'Booked consult', actions: [
      { kind: 'helix', label: 'Prep me', question: `Prep me for my consult with ${l.name}: what to cover and what to ask.`, context: `lead ${l.name}, ${l.topic ?? ''}, consult ${et(l.booked_for!)}`, primary: true },
      ...(tel(l.phone) ? [{ kind: 'tel' as const, label: 'Call', href: tel(l.phone)! }] : []),
    ] });
  }
  const dueList = due.data ?? [];
  if (dueList.length) {
    const first = dueList[0];
    cards.push({ id: `followups:${today}`, lane: 'Today', tone: dueList.some((f) => f.due_on < today) ? 'urgent' : 'today', title: `${plural(dueList.length, 'follow-up')} due`, why: `First: ${first.who}${first.reason ? ` · ${first.reason}` : ''}${first.due_on < today ? ' · overdue' : ''}`, actions: [
      { kind: 'link', label: 'Open Today', href: `${base}/today`, primary: true },
      { kind: 'helix', label: 'Plan my calls', question: 'Put my follow-ups due today in the best order and tell me what to say on the first one.' },
    ] });
  }
  const appr = approvals.data ?? [];
  if (appr.length) cards.push({ id: `approvals:${appr.map((a) => a.id).join(',').slice(0, 60)}`, lane: 'Approve', tone: 'today', title: `${plural(appr.length, 'approval')} waiting for you`, why: appr.slice(0, 2).map((a) => a.title).join(' · '), actions: [{ kind: 'link', label: 'Review now', href: `${base}/approvals`, primary: true }] });
  for (const c of care.data ?? []) cards.push({ id: `care:${c.id}`, lane: 'Genovus team', tone: 'today', title: 'The Genovus team needs your answer', why: c.title, actions: [{ kind: 'link', label: 'Answer', href: `${base}/care`, primary: true }] });
  const p = (partners.data ?? [])[0];
  if (p) {
    const cat = partnerCategories(prof.data?.lines).find((c) => c.key === p.category)?.label ?? p.category;
    cards.push({ id: `partner:${p.id}`, lane: 'Grow', tone: 'idea', title: `Call a ${cat.toLowerCase()} ${p.distance_mi} mi away`, why: `Best unworked referral partner (fit ${p.fit}) for ${LINES[p.line as keyof typeof LINES]?.label ?? p.line}`, actions: [
      { kind: 'link', label: 'Open Partners', href: `${base}/partners`, primary: true },
      { kind: 'helix', label: 'Talking points', question: `Give me talking points for calling a ${cat.toLowerCase()} about referrals.` },
    ] });
  }
  const m = momentsNow(prof.data?.lines)[0];
  if (m) cards.push({ id: `market:${m.line}:${m.label}`, lane: 'Grow', tone: 'idea', title: `${LINES[m.line].label}: ${m.label}`, why: `${m.starting ? 'Starts next month' : 'On now'} · ${m.why}`, actions: [
    { kind: 'helix', label: 'Plan it', question: `Plan a simple push for ${LINES[m.line].label} around "${m.label}" this month: who to call, what to post, what to say.`, primary: true },
    { kind: 'helix', label: 'Draft a post', question: `Draft a short social post for ${LINES[m.line].label} around "${m.label}" (no prices or coverage claims).` },
  ] });
  return cards;
}

/** The Genovus team's day, by department: Sales, Clients, Pipeline, Helix, Studio. */
export async function enterpriseCards(db: SupabaseClient): Promise<BriefCard[]> {
  const nowIso = new Date().toISOString();
  const [inq, approvals, care, due, trials, stuck, notes, posts] = await Promise.all([
    db.from('inquiries').select('id, kind, org, name, created_at').eq('status', 'new').order('created_at', { ascending: false }).limit(4),
    db.from('approvals').select('id, title, tenant_id').eq('status', 'pending').eq('approver', 'team').eq('is_sample', false).order('requested_at').limit(50),
    db.from('care_requests').select('id, title, tenant_id').in('status', ['new', 'in_progress']).eq('is_sample', false).order('created_at').limit(50),
    db.from('prospects').select('id', { count: 'exact', head: true }).in('status', ['new', 'verified', 'contacting']).or(`next_action_at.is.null,next_action_at.lte.${nowIso}`),
    db.from('module_grants').select('tenant_id, until, tenants(slug, name, is_sample)').is('revoked_at', null).gte('until', nowIso).lte('until', new Date(Date.now() + 7 * 86_400_000).toISOString()),
    db.from('tenants').select('slug, name, stage, stage_since').eq('kind', 'agency').eq('is_sample', false).neq('stage', 'care').lte('stage_since', new Date(Date.now() - 14 * 86_400_000).toISOString()).limit(3),
    db.from('helix_notes').select('id, text', { count: 'exact' }).eq('status', 'new').or('chapter.is.null,chapter.neq.agency').order('created_at', { ascending: false }).limit(1),
    db.from('studio_posts').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
  ]);
  const cards: BriefCard[] = [];
  for (const q of inq.data ?? []) {
    const who = q.org || q.name || 'a new inquiry';
    cards.push({ id: `inquiry:${q.id}`, lane: 'Sales', tone: 'urgent', title: `Reply to ${who}`, why: `${q.kind === 'carrier' ? 'Carrier' : 'Agency'} inquiry · ${ago(q.created_at)}`, actions: [
      { kind: 'helix', label: 'Draft reply', question: `Draft a short, warm reply email to the ${who} inquiry that books a 15-minute consult.`, context: `inquiry from ${who} (${q.kind}), ${ago(q.created_at)}`, primary: true },
      { kind: 'link', label: 'Open Inquiries', href: '/console/inquiries' },
    ] });
  }
  if (due.count) cards.push({ id: 'prospects:due', lane: 'Sales', tone: 'today', title: `${plural(due.count, 'office')} to call`, why: 'The call list is ready, with talking points for each office', actions: [
    { kind: 'link', label: 'Open the call list', href: '/console/prospects/calls', primary: true },
    { kind: 'helix', label: 'Who first?', question: 'Which offices should we call first today, and what should we lead with?' },
  ] });
  const appr = approvals.data ?? [];
  if (appr.length) cards.push({ id: `approvals:${appr.length}`, lane: 'Clients', tone: 'today', title: `${plural(appr.length, 'approval')} waiting on us`, why: appr.slice(0, 2).map((a) => a.title).join(' · '), actions: [{ kind: 'link', label: 'Review now', href: '/console/approvals', primary: true }] });
  const cr = care.data ?? [];
  if (cr.length) cards.push({ id: `care:${cr.length}`, lane: 'Clients', tone: 'today', title: `${plural(cr.length, 'care request')} open`, why: `Oldest: ${cr[0].title}`, actions: [{ kind: 'link', label: 'Open the care desk', href: '/console/care', primary: true }] });
  const seenTrial = new Set<string>();
  for (const g of trials.data ?? []) {
    const t = g.tenants as unknown as { slug: string; name: string; is_sample: boolean } | null;
    if (!t || t.is_sample || seenTrial.has(t.slug)) continue;
    seenTrial.add(t.slug);
    const day = new Date(g.until).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/New_York' });
    cards.push({ id: `trial:${t.slug}`, lane: 'Clients', tone: 'today', title: `${t.name}: trial ends ${day}`, why: 'Turn the trial into Growth while it’s fresh', actions: [
      { kind: 'helix', label: 'Draft the offer', question: `Draft a short note offering ${t.name} Growth before their trial ends ${day}, with what they got out of it.`, context: `client ${t.name}`, primary: true },
      { kind: 'link', label: 'Open client', href: `/console/clients/${t.slug}` },
    ] });
  }
  for (const s of stuck.data ?? []) {
    const days = Math.round((Date.now() - new Date(s.stage_since).getTime()) / 86_400_000);
    cards.push({ id: `stuck:${s.slug}`, lane: 'Pipeline', tone: 'today', title: `${s.name} stuck in ${STAGE_LABEL[s.stage as Stage] ?? s.stage} for ${days} days`, why: 'The next step needs a push', actions: [
      { kind: 'link', label: 'Open client', href: `/console/clients/${s.slug}`, primary: true },
      { kind: 'helix', label: 'Next step?', question: `${s.name} has been in ${STAGE_LABEL[s.stage as Stage] ?? s.stage} for ${days} days. What is the next step and who owns it?`, context: `client ${s.name}` },
    ] });
  }
  if (notes.count) cards.push({ id: `notes:${notes.count}`, lane: 'Helix', tone: 'idea', title: `${plural(notes.count, 'Helix note')} to review`, why: `Newest: ${notes.data?.[0]?.text ?? ''}`, actions: [{ kind: 'link', label: 'Open Helix notes', href: '/console/helix', primary: true }] });
  if (posts.count) cards.push({ id: `posts:${posts.count}`, lane: 'Studio', tone: 'idea', title: `${plural(posts.count, 'post')} drafted in the Studio`, why: 'Ready for a look before they go out', actions: [{ kind: 'link', label: 'Open the Studio', href: '/console/studio', primary: true }] });
  return cards;
}
