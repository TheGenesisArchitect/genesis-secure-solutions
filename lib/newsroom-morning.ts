// The newsroom's morning: nobody presses a button. At 5:00 ET every beat is researched in its own worker (the morning
// sweep: what broke in the last 48 hours, each topic searched separately); at 6:00 ET Helix writes the brief: what
// changed, and the hot topics to review today, each pointing at a story on the desk with why it is hot now and an
// angle. The brief shows at the top of the Newsroom. Research stays within the newsroom's daily cap.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { siteOrigin } from '@/lib/cron';
import { businessToday } from '@/lib/billing';
import { ask, record, researchBeat, settings } from '@/lib/newsroom';
import { jsonMatch } from '@/lib/json-reply';
import { nyAt, nyDay } from '@/lib/unedit-plan';

const db = () => adminDb();
export type Hot = { story_id: string; why: string; angle: string; heat: number };
export type Brief = { day: string; summary: string; hot: Hot[]; stats: { beats: number; added: number; cents: number }; created_at: string };

/** Black Tech's topic for today (its four rotate by weekday); other beats are swept whole. */
export function morningSub(beat: { subs?: string[] }, day = new Date()): string | null {
  return beat.subs?.length ? beat.subs[day.getUTCDay() % beat.subs.length] : null;
}

/** Kick one research worker per beat (each runs in its own function, side by side). */
export async function startMorning(tenant: string): Promise<number> {
  const s = await settings(tenant);
  const secret = process.env.CRON_SECRET;
  if (!secret) return 0;
  await Promise.all(s.beats.map((b) => fetch(`${siteOrigin()}/api/studio/newsroom/morning`, {
    method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ tenant, beat: b.id }), signal: AbortSignal.timeout(20_000),
  }).catch((e) => console.error(`[newsroom] morning kick ${b.id}: ${e instanceof Error ? e.message : e}`))));
  return s.beats.length;
}

/** One beat's morning sweep. */
export async function sweepBeat(tenant: string, beatId: string): Promise<string> {
  const s = await settings(tenant);
  const beat = s.beats.find((b) => b.id === beatId);
  if (!beat) return `No beat ${beatId}.`;
  const r = await researchBeat(tenant, beat.id, null, morningSub(beat), { morning: true });
  return `${beat.label}: ${r.added} new (${(r.cents / 100).toFixed(2)} USD).`;
}

/** Helix's brief for today, from the stories filed in the last ~30 hours plus anything still new from before. */
export async function writeBrief(tenant: string): Promise<Brief | null> {
  const day = businessToday();
  const since = new Date(Date.now() - 30 * 3600_000).toISOString();
  const { data: rows } = await db().from('newsroom_stories').select('id, beat, sub, headline, source, published_on, why, fit, status, created_at').eq('tenant_id', tenant).in('status', ['new', 'drafting']).order('created_at', { ascending: false }).limit(40);
  const stories = rows ?? [];
  if (!stories.length) return null;
  const fresh = stories.filter((x) => x.created_at >= since);
  const s = await settings(tenant);
  const label = (b: string) => s.beats.find((x) => x.id === b)?.label ?? b;
  const p = s.profile;
  // An agency desk (lib/desk.ts): the brief is for the agency's host, about his neighbors, under his copy rules.
  const system = p ? [
    `You are Helix, the editor of ${p.agency}'s local desk (${p.carrier_line}, ${p.office}), writing the morning brief for ${p.host} on ${day}. His audience: ${p.audience}. He writes ${p.lines.join(', ')}.`,
    `From the stories on the desk, write: "summary" (3 short sentences, plain words: what is happening around ${p.area.label} that his customers care about, and the one story worth 60 seconds of his time today), and "hot": the 3 to 5 stories most worth a short video TODAY, hottest first. For each: "id" (copy it exactly), "why" (why his customers care right now, one sentence), "angle" (a helpful, neighborly angle under 12 words that gives a reason to call a local office), "heat" (0-100: local x fits his lines x act today x in season).`,
    `His rules, which every angle follows: ${p.rules.join('; ')}. Never a loss, crime or tragedy as the hook. Never say what a policy covers. No prices or savings. Never name another insurer.`,
    'Only stories in the list. Prefer local, useful and timely over national. Never invent a fact; you only rank and frame what is on the desk.',
    'Return only JSON: {"summary":"","hot":[{"id":"","why":"","angle":"","heat":0}]}',
  ].join('\n') : [
    `You are Helix, the editor-in-chief of the Genovus Newsroom, writing the morning brief for the host (Anthony) on ${day}. The audience: founders, agency owners and small teams who want to know what changed and what to do about it.`,
    'From the stories on the desk, write: "summary" (3 short sentences, plain words: what changed overnight across the beats and the one thing worth his first look), and "hot": the 3 to 5 stories most worth an episode TODAY, hottest first. For each: "id" (copy it exactly), "why" (why it is hot right now, one sentence), "angle" (the episode angle for this audience, under 12 words), "heat" (0-100: urgency x audience fit).',
    'Only stories in the list. Prefer what broke in the last day, primary-source news, and what the audience can act on. Never invent a fact; you only rank and frame what is on the desk.',
    'Return only JSON: {"summary":"","hot":[{"id":"","why":"","angle":"","heat":0}]}',
  ].join('\n');
  const user = `Stories on the desk (newest first; "NEW" = filed in the last day):\n${stories.map((x) => `[${x.id}] ${x.created_at >= since ? 'NEW ' : ''}${label(x.beat)}${x.sub ? ` / ${x.sub}` : ''} · ${x.source}${x.published_on ? ` · ${x.published_on}` : ''} · fit ${x.fit ?? '?'} · ${x.headline}${x.why ? ` (${x.why})` : ''}`).join('\n')}`;
  const o = await ask(system, user, { maxTokens: 2000 });
  const m = jsonMatch(o.text);
  if (!m) throw new Error('Helix did not return the brief.');
  const j = JSON.parse(m[0]) as { summary?: string; hot?: { id?: string; why?: string; angle?: string; heat?: number }[] };
  const ids = new Set(stories.map((x) => x.id as string));
  const hot: Hot[] = (j.hot ?? []).filter((h) => h.id && ids.has(h.id)).slice(0, 5).map((h) => ({ story_id: h.id!, why: String(h.why ?? '').slice(0, 240), angle: String(h.angle ?? '').slice(0, 120), heat: Math.max(0, Math.min(100, Math.round(Number(h.heat) || 0))) }));
  const { data: runs } = await db().from('newsroom_runs').select('cost_cents').eq('tenant_id', tenant).eq('kind', 'wire').gte('created_at', since);
  const stats = { beats: s.beats.length, added: fresh.length, cents: (runs ?? []).reduce((a, r) => a + Number(r.cost_cents ?? 0), 0) + o.cents };
  const brief = { tenant_id: tenant, day, summary: String(j.summary ?? '').slice(0, 800), hot, stats, cents: o.cents };
  await db().from('newsroom_briefs').upsert(brief, { onConflict: 'tenant_id,day' });
  await record(tenant, { kind: 'brief', cost_cents: o.cents, stories: hot.length, by: null });
  return { day, summary: brief.summary, hot, stats, created_at: new Date().toISOString() };
}

/** The latest brief (today's, or the last one written). */
export async function latestBrief(tenant: string): Promise<Brief | null> {
  const { data } = await db().from('newsroom_briefs').select('day, summary, hot, stats, created_at').eq('tenant_id', tenant).order('day', { ascending: false }).limit(1).maybeSingle();
  return (data as Brief | null) ?? null;
}

/** An agency desk's brief goes to its host: an email at 7 AM ET (to brief_to, else the agency's owners) and an alert on
 *  every device where an agency member turned alerts on. Only once the operator has approved a preview (brief_on);
 *  the house desk's brief stays in the Newsroom. One of each per day (dedupe keys). Returns how many were queued. */
export async function queueBriefNotices(tenant: string, brief: Brief): Promise<number> {
  const s = await settings(tenant);
  if (!s.profile || !brief.hot.length) return 0;
  const { data: row } = await db().from('newsroom_settings').select('brief_on, brief_to').eq('tenant_id', tenant).maybeSingle();
  if (!row?.brief_on) return 0;
  return (await briefNotices(tenant, brief, (row.brief_to as string | null) ?? null)).length;
}

export type NoticeRow = { tenant_id: string; to_email: string; template: string; data: Record<string, string>; dedupe_key: string; send_after: string };

/** The brief's email and push rows (also what the preview script renders); queued unless preview is set. */
export async function briefNotices(tenant: string, brief: Brief, briefTo: string | null, preview = false): Promise<NoticeRow[]> {
  const p = (await settings(tenant)).profile;
  if (!p) return [];
  const { data: t } = await db().from('tenants').select('slug').eq('id', tenant).single();
  const slug = t!.slug as string;
  const top = brief.hot.slice(0, 3);
  const { data: st } = top.length ? await db().from('newsroom_stories').select('id, headline').eq('tenant_id', tenant).in('id', top.map((h) => h.story_id)) : { data: [] };
  const head = new Map((st ?? []).map((x) => [x.id as string, String(x.headline)]));
  const hot = top.map((h) => ({ headline: (head.get(h.story_id) ?? '').slice(0, 140), angle: h.angle.replace(/[.\s]+$/, ''), why: h.why }));
  let to: string[] = briefTo ? [briefTo] : [];
  if (!to.length) {
    const { data: owners } = await db().from('memberships').select('user_id').eq('tenant_id', tenant).eq('role', 'owner');
    for (const o of owners ?? []) { const u = (await db().auth.admin.getUserById(o.user_id as string)).data.user; if (u?.email) to.push(u.email); }
  }
  to = [...new Set(to)];
  const at = new Date(Math.max(Date.now(), nyAt(nyDay(new Date()), 0, 7).getTime())).toISOString();
  const data = { host: p.host, area: p.area.label, slug, summary: brief.summary, hot: JSON.stringify(hot) };
  const rows: NoticeRow[] = [
    ...to.map((e) => ({ tenant_id: tenant, to_email: e, template: 'agency_brief', data, dedupe_key: `brief:${tenant}:${brief.day}:${e}`, send_after: at })),
    { tenant_id: tenant, to_email: 'push', template: 'brief_push', send_after: at, dedupe_key: `brief-push:${tenant}:${brief.day}`,
      data: { slug, title: `Good morning, ${p.host}: ${hot.length} ${hot.length === 1 ? 'story' : 'stories'} worth a video`, body: hot[0] ? `Top pick: ${hot[0].angle}.` : brief.summary.slice(0, 120), url: `/app/${slug}`, tag: `brief-${brief.day}` } },
  ];
  if (!preview) await db().from('outbox').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  return rows;
}
