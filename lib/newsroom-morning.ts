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
  const system = [
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
