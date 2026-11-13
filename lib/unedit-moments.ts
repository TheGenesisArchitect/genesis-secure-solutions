// Unedit's editor, server only: Claude reads the timed transcript (as numbered sentences) and picks the moments
// that stand on their own as short clips, each with an optional hook (its strongest line, moved to the front),
// titles and copy for each network, plus the full video's title and description and three thumbnail lines.
// Code, not the model, owns the cuts: picks are sentence numbers, turned into times from the words, and clips that
// run too short or long, overlap, or break the copy rules are dropped. ANTHROPIC_API_BASE points tests at a stand-in.
import 'server-only';
import type { Word } from '@/lib/unedit-media';
import { playOrder, screenCodes, screenMenu, SHOTS_RULES, toShots, type RawShot, type Shot } from '@/lib/unedit-shots';
import { CUES_RULES, tagWords, taggedText, toCues, type Cue, type RawCue, type Tag } from '@/lib/unedit-cues';

export type Sentence = { i: number; s: number; e: number; text: string; w0: number; w1: number };
export type Pick = {
  from: number; to: number; hookFrom: number | null; hookTo: number | null;
  title: string; caption: string; copy: { instagram: string; facebook: string; youtube: string };
  features: { hook: string; topic: string; why: string; at: number; shots: Shot[]; cues: Cue[] };
};
export type Plan = { clips: Pick[]; episode: { title: string; description: string; tags: string[] }; thumbs: string[]; cents: number; dropped: string[]; falseStarts: string[] };

const MODEL = () => (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5').trim();
const BASE = () => (process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com').replace(/\/$/, '');
// Per million tokens (input, output), for the budget: an estimate, recorded with the spend.
const PRICE = { in: 300, out: 1500 };
const MIN_S = 15;
const MAX_S = 75;
const BANNED = /\b(guarantee[sd]?|guaranteeing|cheapest|lowest price|best rates?)\b/i;

/** Sentences from the words: a new one after . ! ? or a pause over 1.2 s, or past 40 words. */
export function sentences(words: Word[]): Sentence[] {
  const out: Sentence[] = [];
  let w0 = 0;
  for (let k = 0; k < words.length; k++) {
    const next = words[k + 1];
    const end = !next || /[.!?]["')\]]?$/.test(words[k].w) || next.s - words[k].e > 1.2 || k - w0 >= 39;
    if (end) { out.push({ i: out.length, s: words[w0].s, e: words[k].e, text: words.slice(w0, k + 1).map((w) => w.w).join(' '), w0, w1: k }); w0 = k + 1; }
  }
  return out;
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function prompt(ss: Sentence[], opts: { who: string; tagged?: (s: Sentence) => string; redo?: { title: string; from: number; to: number; note: string }; avoid?: { from: number; to: number }[] }) {
  const system = [
    `You are the editor for ${opts.who}'s one-take vlogs. The video is real footage of a real person talking to camera.`,
    'You pick moments that work as stand-alone short clips (Instagram Reels, Facebook Reels, YouTube Shorts) and write the copy.',
    'A great clip: one idea, makes sense to someone who never saw the vlog, a strong first line, a clear payoff. 20 to 60 seconds.',
    'Hook: if the moment\'s most surprising or quotable sentence is not its first, name it as the hook; it plays first, then the moment from its start. The hook must be one or two sentences, inside the moment, under 8 seconds.',
    'Pick as many clips as the talk truly supports, up to 6. Fewer good clips beat more weak ones. Clips must not overlap.',
    'Copy rules: plain, confident, in the speaker\'s voice. No guarantees, no prices or savings claims, no "best rates", no claims the speaker did not make. Hashtags only at the end of Instagram copy, at most 3.',
    'The thumbnail lines are for the full video: each 4 words or fewer, distinct from the title, drawn from the talk.',
    'False starts: where the speaker begins a sentence, stops, and says it again, list the abandoned words (copied exactly from the transcript, at least two words) in "false_starts", so the full video can cut them. Only clear restarts; never a sentence the speaker finished.',
    SHOTS_RULES,
    CUES_RULES,
    `Screen codes (real Genovus screens):
${screenMenu()}`,
    'Return only JSON, no prose: {"clips":[{"from":<first sentence #>,"to":<last sentence #>,"hook":<sentence # or null>,"hook_to":<sentence # or null>,"title":"<6 words max>","caption":"<one line under 90 chars>","instagram":"<caption>","facebook":"<caption>","youtube":"<Shorts title under 90 chars>","hook_type":"question|claim|story|number|contrast","topic":"<2-4 words>","why":"<one line>","shots":[{"s":0,"layout":"face","accent":"","screen":null,"figure":null}],"cues":[{"w":"","s":0,"kind":"counter","text":""}]}],"episode":{"title":"<under 90 chars>","description":"<2-4 sentences>","tags":["..."]},"thumbs":["","",""],"false_starts":["<exact abandoned words>"]}',
  ].join('\n');
  const lines = ss.map((x) => `[${x.i} ${mmss(x.s)}–${mmss(x.e)}] ${opts.tagged ? opts.tagged(x) : x.text}`).join('\n');
  const user = opts.redo
    ? `Transcript (numbered sentences):\n${lines}\n\nRedo ONE clip. The clip "${opts.redo.title}" (sentences ${opts.redo.from}–${opts.redo.to}) was sent back with this note: "${opts.redo.note || 'try a better moment'}". Return the JSON with exactly one clip in "clips" (a different or tightened moment that answers the note)${opts.avoid?.length ? `, not overlapping sentences ${opts.avoid.map((a) => `${a.from}–${a.to}`).join(', ')}` : ''}. Keep "episode" and "thumbs" as you would write them.`
    : `Transcript (numbered sentences):\n${lines}`;
  return { system, user };
}

async function claude(system: string, user: string): Promise<{ text: string; cents: number }> {
  const k = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!k) throw new Error('ANTHROPIC_API_KEY is not set on this deployment.');
  const r = await fetch(`${BASE()}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL(), max_tokens: 12000, system, messages: [{ role: 'user', content: user }] }),
    signal: AbortSignal.timeout(240_000),
  });
  const j = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
  if (!r.ok) throw new Error(`Claude: ${j.error?.message || `HTTP ${r.status}`}`);
  const cents = Math.ceil(((j.usage?.input_tokens ?? 0) * PRICE.in + (j.usage?.output_tokens ?? 0) * PRICE.out) / 1_000_000);
  return { text: (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''), cents };
}

type RawClip = { cues?: RawCue[]; from?: number; to?: number; hook?: number | null; hook_to?: number | null; title?: string; caption?: string; instagram?: string; facebook?: string; youtube?: string; hook_type?: string; topic?: string; why?: string; shots?: RawShot[] };
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Turn the model's sentence picks into timed clips, enforcing length, no overlap and the copy rules. */
export function toPicks(raw: RawClip[], ss: Sentence[], taken: { from: number; to: number }[] = [], cueCtx?: { words: Word[]; tags: Tag[][] }): { picks: Pick[]; dropped: string[] } {
  const picks: Pick[] = [];
  const dropped: string[] = [];
  for (const c of raw) {
    const title = str(c.title, 80) || 'Untitled clip';
    const a = ss[Number(c.from)], b = ss[Number(c.to)];
    if (!a || !b || b.i < a.i) { dropped.push(`${title}: sentence numbers out of range`); continue; }
    const from = Math.max(0, a.s - 0.08), to = b.e + 0.15;
    let hookFrom: number | null = null, hookTo: number | null = null;
    const h0 = c.hook == null ? null : ss[Number(c.hook)];
    const h1 = c.hook_to == null ? h0 : ss[Number(c.hook_to)] ?? h0;
    // A hook that is the moment's own first line adds nothing; one outside the moment or too long is ignored.
    if (h0 && h1 && h1.i >= h0.i && h0.i > a.i && h1.i <= b.i && h1.e - h0.s <= 8.5) { hookFrom = Math.max(0, h0.s - 0.05); hookTo = h1.e + 0.12; }
    const secs = to - from + (hookFrom != null ? hookTo! - hookFrom : 0);
    if (secs < MIN_S || secs > MAX_S) { dropped.push(`${title}: ${Math.round(secs)} s (clips run ${MIN_S}–${MAX_S} s)`); continue; }
    if ([...taken, ...picks].some((p) => from < p.to && to > p.from)) { dropped.push(`${title}: overlaps another clip`); continue; }
    const copy = { instagram: str(c.instagram, 2000), facebook: str(c.facebook, 2000), youtube: str(c.youtube, 95) || title };
    const caption = str(c.caption, 120);
    if ([title, caption, ...Object.values(copy)].some((t) => BANNED.test(t))) { dropped.push(`${title}: copy broke the wording rules`); continue; }
    picks.push({ from, to, hookFrom, hookTo, title, caption, copy, features: { hook: str(c.hook_type, 20) || 'claim', topic: str(c.topic, 40), why: str(c.why, 160), at: Math.round((from / Math.max(1, ss[ss.length - 1].e)) * 100) / 100, shots: toShots(c.shots, ss, playOrder(ss, from, to, hookFrom, hookTo)), cues: cueCtx ? toCues(c.cues, ss, playOrder(ss, from, to, hookFrom, hookTo), cueCtx.words, cueCtx.tags, screenCodes()) : [] } });
  }
  return { picks, dropped };
}

function parse(text: string): { clips: RawClip[]; episode: { title?: string; description?: string; tags?: unknown[] }; thumbs: unknown[]; falseStarts: string[] } {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Claude did not return the clip plan.');
  const j = JSON.parse(m[0]) as { clips?: RawClip[]; episode?: { title?: string; description?: string; tags?: unknown[] }; thumbs?: unknown[]; false_starts?: unknown[] };
  return { clips: Array.isArray(j.clips) ? j.clips : [], episode: j.episode ?? {}, thumbs: Array.isArray(j.thumbs) ? j.thumbs : [], falseStarts: (Array.isArray(j.false_starts) ? j.false_starts : []).map((x) => str(x, 200)).filter((x) => x.split(' ').length >= 2).slice(0, 20) };
}

/** Plan the whole vlog: clips, the full video's title and description, thumbnail lines. */
export async function planVlog(words: Word[], who = 'Anthony at Genovus'): Promise<Plan> {
  const ss = sentences(words);
  if (ss.length < 3) throw new Error('The transcript is too short to cut clips from.');
  const tags = tagWords(words);
  const p = prompt(ss, { who, tagged: (s) => taggedText(words, tags, s.w0, s.w1) });
  const r = await claude(p.system, p.user);
  const j = parse(r.text);
  const { picks, dropped } = toPicks(j.clips.slice(0, 6), ss, [], { words, tags });
  const thumbs = j.thumbs.map((t) => str(t, 40)).filter((t) => t && t.split(/\s+/).length <= 5 && !BANNED.test(t)).slice(0, 3);
  return {
    clips: picks, dropped, cents: r.cents, falseStarts: j.falseStarts,
    episode: { title: str(j.episode.title, 95) || 'New video', description: str(j.episode.description, 4500), tags: (j.episode.tags ?? []).map((t) => str(t, 30)).filter(Boolean).slice(0, 12) },
    thumbs: thumbs.length ? thumbs : [str(j.episode.title, 40)].filter(Boolean),
  };
}

/** Redo one clip from its note: a new or tightened moment that doesn't overlap the vlog's other clips. */
export async function redoClip(words: Word[], clip: { title: string; from: number; to: number; note: string }, others: { from: number; to: number }[], who = 'Anthony at Genovus'): Promise<{ pick: Pick | null; why: string; cents: number }> {
  const ss = sentences(words);
  const idx = (t: number) => ss.findIndex((x) => x.e >= t - 0.2);
  const avoid = others.map((o) => ({ from: Math.max(0, idx(o.from)), to: Math.max(0, idx(o.to)) }));
  const tags = tagWords(words);
  const p = prompt(ss, { who, tagged: (s) => taggedText(words, tags, s.w0, s.w1), redo: { title: clip.title, from: Math.max(0, idx(clip.from)), to: Math.max(0, idx(clip.to)), note: clip.note }, avoid });
  const r = await claude(p.system, p.user);
  const { picks, dropped } = toPicks(parse(r.text).clips.slice(0, 1), ss, others, { words, tags });
  return { pick: picks[0] ?? null, why: dropped[0] ?? '', cents: r.cents };
}

/** Pick which stills make the best thumbnails (a clear, expressive face, eyes open, not mid-blink or blurred).
 *  Returns indexes into `stills`, best first; without a Claude key, the first ones. */
export async function pickStills(stills: Buffer[], want = 3): Promise<{ order: number[]; cents: number }> {
  const k = (process.env.ANTHROPIC_API_KEY || '').trim();
  const fallback = { order: stills.map((_, i) => i).slice(0, want), cents: 0 };
  if (!k || !stills.length) return fallback;
  try {
    const content = [
      ...stills.flatMap((b, i) => [{ type: 'text', text: `Still ${i}:` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } }]),
      { type: 'text', text: `Which ${want} stills make the best video thumbnails of the speaker? Prefer a sharp frame, a clear expressive face, eyes open, mouth not mid-word, good light. Return only JSON: {"order":[best index, next, ...]}` },
    ];
    const r = await fetch(`${BASE()}/v1/messages`, {
      method: 'POST',
      headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 300, messages: [{ role: 'user', content }] }),
      signal: AbortSignal.timeout(120_000),
    });
    const j = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    if (!r.ok) return fallback;
    const m = (j.content ?? []).map((b) => b.text ?? '').join('').match(/\{[\s\S]*\}/);
    const order = (m ? (JSON.parse(m[0]).order as unknown[]) : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < stills.length);
    const uniq = [...new Set([...order, ...fallback.order])].slice(0, want);
    return { order: uniq, cents: Math.ceil(((j.usage?.input_tokens ?? 0) * PRICE.in + (j.usage?.output_tokens ?? 0) * PRICE.out) / 1_000_000) };
  } catch { return fallback; }
}
