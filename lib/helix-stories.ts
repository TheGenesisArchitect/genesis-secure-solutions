// Helix knows the Newsroom's stories and UnEdit's recordings inside out, so the team can decide what to shoot, what to
// post and when. Three lookups, the same pattern as the prospect lookups (typed Ask Helix asks for one and is asked again
// with the result; voice calls them as tools through /api/helix/lookup):
//   story_list      the desk: every story of the last days with its heat, angles, claims and how far it got
//   story_card      one story in full: why it's hot, angles, every claim with its source and status, the script and
//                   teleprompter written for it, the recording it became, its clips and where they posted
//   recording_card  one recording in full: what it is about, its clips (titles, hooks, captions, copy), its posts and
//                   calendar, the story it was cut against, cost
// Staff only (the Newsroom and UnEdit tables are staff-read). Reads with the caller's own client; never writes.
import type { SupabaseClient } from '@supabase/supabase-js';

export const STORY_LOOKUPS = ['story_list', 'story_card', 'recording_card'] as const;
type Args = Record<string, unknown>;
const TZ = 'America/New_York';
const NETS: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', tiktok: 'TikTok', twitter: 'X', linkedin: 'LinkedIn' };
const clean = (s: unknown, n = 120) => String(s ?? '').replace(/[%,()]/g, ' ').trim().slice(0, n);
const cut = (s: unknown, n: number) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ }) : null);
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'that', 'story', 'about', 'recording', 'video'].includes(w));

type Story = { id: string; beat: string; sub: string | null; headline: string; source: string; url: string; published_on: string | null; why: string | null; fit: number | null; status: string; angles: { title?: string; line?: string }[]; chosen_angle: number | null; build: string[]; created_at: string };
type Hot = { story_id?: string; heat?: number; why?: string; angle?: string };
const SCOLS = 'id, beat, sub, headline, source, url, published_on, why, fit, status, angles, chosen_angle, build, created_at';

/** Best match by shared words (ties go to the newest); null with the closest names when nothing fits. */
function best<T>(rows: T[], want: string, name: (r: T) => string): { row: T | null; others: string[] } {
  const w = words(want);
  if (!w.length) return { row: null, others: [] };
  const scored = rows.map((r) => ({ r, k: w.filter((x) => words(name(r)).some((y) => y.startsWith(x) || x.startsWith(y))).length })).filter((x) => x.k > 0).sort((a, b) => b.k - a.k);
  if (!scored.length || scored[0].k < Math.min(2, w.length)) return { row: null, others: scored.slice(0, 4).map((x) => name(x.r)) };
  return { row: scored[0].r, others: scored.slice(1, 4).filter((x) => x.k === scored[0].k).map((x) => name(x.r)) };
}

/** Heat per story from the last week of morning briefs (the latest brief that rated it). */
async function heatMap(db: SupabaseClient): Promise<Map<string, Hot & { day: string }>> {
  const { data } = await db.from('newsroom_briefs').select('day, hot').order('day', { ascending: false }).limit(10);
  const m = new Map<string, Hot & { day: string }>();
  for (const b of (data ?? []) as { day: string; hot: Hot[] }[]) for (const h of b.hot ?? []) if (h.story_id && !m.has(h.story_id)) m.set(h.story_id, { ...h, day: b.day });
  return m;
}

/** How far a story got: angle chosen → script written → recorded → posted. */
async function pipeline(db: SupabaseClient, ids: string[]) {
  const [prods, claims] = await Promise.all([
    ids.length ? db.from('newsroom_productions').select('id, story_id, angle, formats, outputs, next_upload, vlog_id, faceless, cost_cents, created_at').in('story_id', ids).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    ids.length ? db.from('newsroom_claims').select('story_id, status, approved').in('story_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const P = (prods.data ?? []) as { id: string; story_id: string; angle: string; formats: string[]; outputs: Record<string, unknown>; next_upload: boolean; vlog_id: string | null; faceless: { status?: string; vlog_id?: string } | null; cost_cents: number; created_at: string }[];
  const vlogIds = [...new Set(P.flatMap((p) => [p.vlog_id, p.faceless?.vlog_id]).filter(Boolean))] as string[];
  const [{ data: vs }, { data: ps }] = await Promise.all([
    vlogIds.length ? db.from('unedit_vlogs').select('id, title, episode, stage').in('id', vlogIds) : Promise.resolve({ data: [] }),
    vlogIds.length ? db.from('unedit_posts').select('vlog_id, status').in('vlog_id', vlogIds) : Promise.resolve({ data: [] }),
  ]);
  return { P, C: (claims.data ?? []) as { story_id: string; status: string; approved: boolean }[], V: (vs ?? []) as { id: string; title: string | null; episode: { title?: string } | null; stage: string }[], posts: (ps ?? []) as { vlog_id: string; status: string }[] };
}

function stateOf(s: Story, pl: Awaited<ReturnType<typeof pipeline>>): string {
  const prods = pl.P.filter((p) => p.story_id === s.id);
  const vl = prods.flatMap((p) => [p.vlog_id, p.faceless?.vlog_id]).filter(Boolean) as string[];
  const posts = pl.posts.filter((p) => vl.includes(p.vlog_id));
  if (posts.some((p) => p.status === 'posted')) return `posted (${posts.filter((p) => p.status === 'posted').length} live)`;
  if (posts.some((p) => p.status === 'queued')) return 'recorded, on the calendar';
  if (vl.length) return `recorded (${pl.V.find((v) => vl.includes(v.id))?.stage ?? 'processing'})`;
  if (prods.length) return prods.some((p) => p.next_upload) ? 'script written, the next upload is cut against it' : 'script written, not recorded';
  if (s.chosen_angle != null) return 'angle chosen';
  return s.status === 'new' ? 'on the desk' : s.status;
}

export async function runStoryLookup(db: SupabaseClient, tool: string, args: Args): Promise<Record<string, unknown>> {
  if (tool === 'story_list') {
    const days = Math.min(30, Math.max(1, Number(args.days) || 7));
    let q = db.from('newsroom_stories').select(SCOLS).gte('created_at', new Date(Date.now() - days * 86_400_000).toISOString()).neq('status', 'dismissed');
    const beat = clean(args.beat, 40).toLowerCase();
    const status = clean(args.status, 20);
    if (status) q = q.eq('status', status);
    const { data } = await q.order('created_at', { ascending: false }).limit(120);
    let S = (data ?? []) as Story[];
    if (beat) S = S.filter((s) => s.beat.toLowerCase().includes(beat) || (s.sub ?? '').toLowerCase().includes(beat));
    const heat = await heatMap(db);
    // Hottest first, then the best fit, then the newest.
    S.sort((a, b) => (heat.get(b.id)?.heat ?? -1) - (heat.get(a.id)?.heat ?? -1) || (b.fit ?? 0) - (a.fit ?? 0) || b.created_at.localeCompare(a.created_at));
    const top = S.slice(0, Math.min(25, Math.max(1, Number(args.limit) || 15)));
    const pl = await pipeline(db, top.map((s) => s.id));
    return {
      ok: true, total: S.length, days,
      stories: top.map((s) => { const h = heat.get(s.id); const c = pl.C.filter((x) => x.story_id === s.id); return `${cut(s.headline, 120)} | ${s.beat}${s.sub ? `/${s.sub}` : ''} | ${s.source} | ${h?.heat != null ? `heat ${Math.round(h.heat)}` : 'not in a brief'} | fit ${s.fit ?? '?'} | ${s.angles?.length ?? 0} angles | ${c.length} claims (${c.filter((x) => x.status === 'confirmed').length} confirmed) | ${stateOf(s, pl)}`; }),
      next: 'For one story in full (claims, script, clips, posts) call story_card with words from its headline.',
    };
  }

  if (tool === 'story_card') {
    const want = clean(args.headline ?? args.id, 160);
    let s: Story | null = null, others: string[] = [];
    if (isUuid(want)) s = ((await db.from('newsroom_stories').select(SCOLS).eq('id', want).maybeSingle()).data as Story | null);
    else {
      const { data } = await db.from('newsroom_stories').select(SCOLS).gte('created_at', new Date(Date.now() - 45 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(400);
      ({ row: s, others } = best((data ?? []) as Story[], want, (r) => r.headline));
    }
    if (!s) return { found: false, note: `No story matches “${want}”. Use words from its headline (story_list shows the desk).`, ...(others.length ? { closest: others } : {}) };
    const [heat, pl, { data: claims }] = await Promise.all([heatMap(db), pipeline(db, [s.id]), db.from('newsroom_claims').select('text, status, attribution, denial, names_person, source_title, source_url, passage_verified, approved').eq('story_id', s.id).order('created_at')]);
    const h = heat.get(s.id);
    const prods = pl.P.filter((p) => p.story_id === s!.id);
    const vlogIds = prods.flatMap((p) => [p.vlog_id, p.faceless?.vlog_id]).filter(Boolean) as string[];
    const recordings = await Promise.all(vlogIds.map((id) => recordingCard(db, id, false)));
    return {
      found: true,
      story: { headline: s.headline, source: s.source, url: s.url, published: s.published_on, beat: s.sub ? `${s.beat} / ${s.sub}` : s.beat, on_desk_since: when(s.created_at), status: s.status, fit: s.fit, why_it_fits: s.why,
        heat: h ? { heat: h.heat != null ? Math.round(h.heat) : null, in_brief_of: h.day, why_hot: h.why, suggested_angle: h.angle } : 'not rated in a recent morning brief',
        angles: (s.angles ?? []).map((a, i) => `${i === s!.chosen_angle ? '[CHOSEN] ' : ''}${a.title ?? ''}${a.line ? `: ${a.line}` : ''}`), build: s.build, state: stateOf(s, pl) },
      claims: ((claims ?? []) as { text: string; status: string; attribution: string | null; denial: string | null; names_person: boolean; source_title: string | null; source_url: string; passage_verified: boolean; approved: boolean }[])
        .map((c) => `${c.status.toUpperCase()}${c.approved ? '' : ' (waiting for a person)'}${c.passage_verified ? ', passage verified' : ''}: ${cut(c.text, 220)}${c.attribution ? ` (per ${c.attribution})` : ''}${c.denial ? ` Other side: ${cut(c.denial, 140)}` : ''}${c.names_person ? ' [names a person]' : ''} Source: ${c.source_title ?? c.source_url}`),
      productions: prods.map((p) => {
        const o = (p.outputs ?? {}) as Record<string, unknown>;
        const social = o.social && typeof o.social === 'object' ? Object.keys(o.social as object) : [];
        return { angle: p.angle, formats: p.formats, written: when(p.created_at), cost: `$${(Number(p.cost_cents) / 100).toFixed(2)}`, next_upload_cut_against_it: p.next_upload,
          script: cut(o.script ?? '', 1400) || null, teleprompter: cut(o.teleprompter ?? '', 1400) || null, broll: Array.isArray(o.broll) ? (o.broll as unknown[]).slice(0, 8).map((b) => cut(typeof b === 'string' ? b : JSON.stringify(b), 100)) : [],
          article: o.article ? cut(o.article, 400) : null, social_drafts_for: social, faceless: p.faceless?.status ?? null };
      }),
      recordings,
    };
  }

  if (tool === 'recording_card') {
    const want = clean(args.title ?? args.id, 160);
    let id: string | null = isUuid(want) ? want : null, others: string[] = [];
    if (!id) {
      const { data } = await db.from('unedit_vlogs').select('id, title, episode, created_at').order('created_at', { ascending: false }).limit(200);
      const r = best((data ?? []) as { id: string; title: string | null; episode: { title?: string } | null }[], want, (v) => v.episode?.title || v.title || '');
      id = r.row?.id ?? null; others = r.others;
    }
    if (!id) return { found: false, note: `No recording matches “${want}”. Use words from its title.`, ...(others.length ? { closest: others } : {}) };
    return { found: true, ...(await recordingCard(db, id, true)) };
  }
  return { error: 'Helix can’t look that up yet.' };
}

/** One recording: what it is, its clips and copy, its posts and calendar, and (when asked) the story behind it. */
async function recordingCard(db: SupabaseClient, id: string, withStory: boolean): Promise<Record<string, unknown>> {
  const [{ data: v }, { data: cs }, { data: ps }, { data: prod }] = await Promise.all([
    db.from('unedit_vlogs').select('id, title, episode, stage, stage_at, error, duration_s, words, cost_cents, created_at, approved_at, post_plan, faceless').eq('id', id).maybeSingle(),
    db.from('unedit_clips').select('id, n, title, caption, copy, secs, status, hook_start_s, note, error').eq('vlog_id', id).order('n'),
    db.from('unedit_posts').select('clip_id, platform, kind, status, scheduled_at, posted_url, mc_error').eq('vlog_id', id).order('scheduled_at'),
    withStory ? db.from('newsroom_productions').select('angle, story_id, newsroom_stories(headline, source)').eq('vlog_id', id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!v) return { recording: 'not found' };
  const ep = (v.episode ?? {}) as { title?: string; description?: string; chapters?: { t?: number; title?: string }[]; tags?: string[] };
  const nOf = new Map(((cs ?? []) as { id: string; n: number }[]).map((c) => [c.id, c.n]));
  const plan = v.post_plan as { mode?: string; rhythm?: string; why?: string } | null;
  const story = prod as { angle: string; newsroom_stories: { headline: string; source: string } | null } | null;
  return {
    recording: { title: ep.title || v.title || 'Recording', stage: v.error ? `stopped: ${cut(v.error, 160)}` : v.stage, since: when(v.stage_at), recorded: when(v.created_at), length: v.duration_s ? `${Math.floor(Number(v.duration_s) / 60)}:${String(Math.round(Number(v.duration_s) % 60)).padStart(2, '0')}` : null, words: v.words, cost: `$${(Number(v.cost_cents) / 100).toFixed(2)}`,
      approved: when(v.approved_at), description: cut(ep.description, 600) || null, chapters: (ep.chapters ?? []).slice(0, 12).map((c) => c.title).filter(Boolean), faceless: Boolean(v.faceless),
      posting_plan: plan ? `${plan.mode ?? ''}${plan.rhythm ? ` · ${plan.rhythm}` : ''}${plan.why ? ` (${cut(plan.why, 160)})` : ''}` : null },
    ...(story ? { cut_against_story: { headline: story.newsroom_stories?.headline, source: story.newsroom_stories?.source, angle: story.angle } } : {}),
    clips: ((cs ?? []) as { n: number; title: string | null; caption: string | null; copy: Record<string, string> | null; secs: number | null; status: string; hook_start_s: number | null; note: string | null; error: string | null }[]).map((c) =>
      `Clip ${c.n} [${c.status}${c.hook_start_s != null ? ', hook first' : ''}${c.secs ? `, ${Math.round(Number(c.secs))} s` : ''}]: ${cut(c.title, 100)}. Caption: ${cut(c.caption, 200)}${c.copy && Object.keys(c.copy).length ? ` Copy for ${Object.keys(c.copy).join(', ')}: ${cut(Object.values(c.copy)[0], 160)}` : ''}${c.note ? ` Note: ${cut(c.note, 100)}` : ''}${c.error ? ` Error: ${cut(c.error, 100)}` : ''}`),
    posts: ((ps ?? []) as { clip_id: string | null; platform: string; kind: string; status: string; scheduled_at: string | null; posted_url: string | null; mc_error: string | null }[]).map((p) =>
      `${p.clip_id ? `Clip ${nOf.get(p.clip_id) ?? '?'}` : 'Full video'} on ${NETS[p.platform] ?? p.platform}: ${p.status === 'posted' ? 'live' : p.status === 'queued' ? 'waiting' : p.status}${p.scheduled_at ? ` ${when(p.scheduled_at)}` : ''}${p.posted_url ? ` ${p.posted_url}` : ''}${p.mc_error ? ` (${cut(p.mc_error, 100)})` : ''}`),
    performance: 'Views and engagement per post are not in Genovus yet (Metricool has them).',
  };
}

/** Typed Helix: how to ask for a story lookup. Voice: the same as tools. */
export const storyLookupRules = (voice: boolean) => `
STORIES AND RECORDINGS (the Newsroom desk and UnEdit Studio; you know them inside out by looking them up): ${voice ? 'call the tool' : 'reply with only {"lookup": {"tool": <name>, "args": {...}}, "answer": "One moment."} and you will be asked again with the result (two lookups at most)'}.
- story_list {beat?, status?, days?: 1-30, limit?}: the desk, hottest first: heat, fit, angles, claims and how far each story got (on the desk, script written, recorded, on the calendar, posted).
- story_card {headline: words from it}: one story in full: why it's hot now, every angle, every claim with its source and status, the script and teleprompter written for it, the recording it became, its clips and posts.
- recording_card {title: words from it}: one recording in full: what it covers, chapters, clips with titles, hooks, captions and copy, every post and when, the story it was cut against, cost.
Use them to advise on what to shoot (heat, confirmed claims, angle not yet recorded), what to post and when (clips ready, calendar gaps), and what to drop. Quote claims with their status (confirmed, reported, alleged); never present an alleged claim as fact. Never invent views or results.`;

/** Voice tool declarations (Gemini Live). */
export const storyTools = [
  { name: 'story_list', description: 'The Newsroom desk, hottest first: each story with heat, fit, angles, claims and how far it got (on the desk, script written, recorded, on the calendar, posted).', parameters: { type: 'OBJECT', properties: { beat: { type: 'STRING' }, status: { type: 'STRING' }, days: { type: 'NUMBER' }, limit: { type: 'NUMBER' } } } },
  { name: 'story_card', description: 'One Newsroom story in full: why it is hot, angles, every claim with source and status, the script and teleprompter, the recording it became, its clips and posts. Pass words from the headline.', parameters: { type: 'OBJECT', properties: { headline: { type: 'STRING' } }, required: ['headline'] } },
  { name: 'recording_card', description: 'One UnEdit recording in full: what it covers, chapters, clips with titles, hooks, captions and copy, every post and when, the story it was cut against. Pass words from its title.', parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' } }, required: ['title'] } },
];
