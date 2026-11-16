// The dialogue editor: what makes one take sound like a clean take, so nobody has to record it again (the whole idea of
// Unedit). Claude reads the numbered transcript and marks what a human editor would cut: restarts, repeated phrases,
// abandoned fragments, self-corrections (the wrong version), and filler tics that add nothing. It also fixes words the
// transcriber misheard, with the story's names as context ("sea harness" was "DeepSeek harness").
//
// Guarded: a cut is at most 15 words, never touches a number or a fact on the sources sheet, never removes the last
// attempt, and the whole pass removes at most 12% of the words. Uh/um, pauses and simple repeats are cut by the edit
// itself (lib/unedit-edit.ts); this pass catches what rules can't.
import 'server-only';
import { claude } from '@/lib/unedit-moments';
import { findRun } from '@/lib/unedit-edit';
import { jsonMatch } from '@/lib/json-reply';
import type { Word } from '@/lib/unedit-media';
import type { NewsEntry } from '@/lib/unedit-news';

export type DropWhy = 'restart' | 'repeat' | 'abandoned' | 'correction' | 'tic';
export type Drop = { i: number; why: DropWhy };
export type Clean = { drops: Drop[]; fixes: { i: number; from: string; to: string }[]; cents: number };

const WHY = new Set<DropWhy>(['restart', 'repeat', 'abandoned', 'correction', 'tic']);
const RANK: Record<DropWhy, number> = { repeat: 0, restart: 1, correction: 2, abandoned: 3, tic: 4 };
const CHUNK = 1400;      // words per request (a 45-minute talk is about five)
const MAX_SHARE = 0.12;  // the pass never removes more than this share of the words
const FILLER = /^(uh|um|uhm|umm|uhh|er|erm|ah|ahh|hmm|hm|mm|eh)$/;
const bare = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

/** Names worth teaching the transcriber for this recording: proper nouns from its sources sheet and title. */
export function keyterms(sources: NewsEntry[] | null | undefined, extra: string[] = []): string[] {
  const text = [...(sources ?? []).flatMap((e) => [e.text, e.say, e.who ?? '', e.title ?? '', ...(e.items ?? []).map((x) => x.text)]), ...extra].join(' ');
  const stop = new Set(['The', 'A', 'An', 'This', 'That', 'It', 'In', 'On', 'For', 'And', 'But', 'We', 'You', 'I', 'They', 'Our', 'What', 'How', 'Why', 'When', 'If', 'So', 'As']);
  const found = new Map<string, number>();
  for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9]*(?:[-\s][A-Z][A-Za-z0-9]*){0,2}\b/g)) {
    const t = m[0].trim();
    if (t.length < 3 || stop.has(t)) continue;
    found.set(t, (found.get(t) ?? 0) + 1);
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 25);
}

const SYSTEM = [
  'You are the dialogue editor for Unedit. The speaker recorded ONE take and will not record it again. Make it play like a clean take by choosing words to cut, the way a professional editor would, and fix words the transcriber misheard.',
  'Cut (by word number, as ranges):',
  '- "restart": the speaker starts a phrase, stops, and starts again. Cut the earlier attempt, keep the final one ("we\'re going to, we\'re gonna build" → cut "we\'re going to,").',
  '- "repeat": a word or phrase said twice in a row ("from a, from a"; "is is"). Cut the first.',
  '- "abandoned": a fragment that trails off and goes nowhere before a new sentence starts.',
  '- "correction": the speaker misspeaks and corrects it. Cut the wrong version, keep the correction.',
  '- "tic": a verbal tic that adds nothing ("you know", "I mean", "like" as filler, "right?", "kind of" as filler, "so" opening every sentence). Only when the sentence reads cleanly and keeps its meaning without it, and never more than one tic every 20 seconds or so: the speaker should still sound like themselves.',
  'Never cut content: facts, numbers, names, opinions, examples, jokes, deliberate emphasis or repetition for effect ("never, ever"). Never cut so a sentence loses its subject or verb, and never cut the final attempt. When unsure, do not cut.',
  'Uh/um are already cut; ignore them. Pauses are handled separately.',
  'Fixes: a word the transcriber clearly misheard (usually a name or a technical term; the context lists this story\'s names). Give the word number and the correct text, only when the context makes it certain. A fix replaces that one word; if the correct name is two words ("DeepSeek" heard as "Deep Seek" or "sea"), fix the first word and cut the leftover as "repeat".',
  'Return only JSON: {"cuts":[{"from":<first word #>,"to":<last word #>,"why":"restart|repeat|abandoned|correction|tic"}],"fixes":[{"i":<word #>,"to":"<correct text>"}]}',
].join('\n');

/** The cleanup for a whole transcript (words as transcribed; fillers included, they're numbered too). */
export async function cleanTake(words: Word[], ctx: { title?: string; terms?: string[]; sources?: NewsEntry[] | null }): Promise<Clean> {
  if (words.length < 30) return { drops: [], fixes: [], cents: 0 };
  // Words the sources sheet places on screen are facts the viewer must hear: never cut.
  const protect = new Set<number>();
  for (const e of ctx.sources ?? []) for (const say of [e.say, ...(e.items ?? []).map((x) => x.say ?? '')]) if (say) for (const i of findRun(words, say)) protect.add(i);
  const context = [ctx.title ? `Title: ${ctx.title}` : '', ctx.terms?.length ? `Names and terms in this story: ${ctx.terms.join(', ')}` : '', 'Speaker: Anthony at Genovus (Genovus, Unedit, Helix are our own names).'].filter(Boolean).join('\n');
  const cuts: { from: number; to: number; why: DropWhy }[] = [];
  const fixes: Clean['fixes'] = [];
  let cents = 0;
  for (let a = 0; a < words.length; a += CHUNK) {
    const b = Math.min(words.length, a + CHUNK + 40); // a little overlap so a restart across the seam is seen whole
    const text = words.slice(a, b).map((w, k) => `[${a + k}]${w.w}`).join(' ');
    const r = await claude(SYSTEM, `${context}\n\nTranscript (each word is preceded by its number):\n${text}`);
    cents += r.cents;
    const m = jsonMatch(r.text);
    if (!m) continue;
    const j = JSON.parse(m[0]) as { cuts?: { from?: number; to?: number; why?: string }[]; fixes?: { i?: number; to?: string }[] };
    for (const c of j.cuts ?? []) {
      const from = Number(c.from), to = Number(c.to ?? c.from), why = String(c.why) as DropWhy;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < a || to >= b || to < from || to - from > 14 || !WHY.has(why)) continue;
      cuts.push({ from, to, why });
    }
    for (const f of j.fixes ?? []) {
      const i = Number(f.i), to = String(f.to ?? '').trim();
      if (!Number.isInteger(i) || i < a || i >= b || !to || to.length > 40 || to.split(/\s+/).length > 3 || bare(to) === bare(words[i].w)) continue;
      if (fixes.some((x) => x.i === i)) continue;
      // Keep the original word's punctuation ("sea," → "DeepSeek,").
      const tail = words[i].w.match(/[^\p{L}\p{N}]+$/u)?.[0] ?? '';
      fixes.push({ i, from: words[i].w, to: /[^\p{L}\p{N}]$/u.test(to) ? to : `${to}${tail}` });
    }
  }
  // Guards: no numbers, no sheet facts, something kept after the cut; then the most certain kinds first, under the cap.
  const ok = cuts.filter((c) => {
    const idx = Array.from({ length: c.to - c.from + 1 }, (_, k) => c.from + k);
    if (idx.some((i) => protect.has(i) || /\d/.test(words[i].w))) return false;
    return words.slice(c.to + 1).some((w) => !FILLER.test(bare(w.w)));
  }).sort((x, y) => RANK[x.why] - RANK[y.why] || x.from - y.from);
  const cap = Math.floor(words.length * MAX_SHARE);
  const drops = new Map<number, DropWhy>();
  for (const c of ok) {
    const idx = Array.from({ length: c.to - c.from + 1 }, (_, k) => c.from + k).filter((i) => !drops.has(i));
    if (drops.size + idx.length > cap) continue;
    for (const i of idx) drops.set(i, c.why);
  }
  return { drops: [...drops.entries()].sort((x, y) => x[0] - y[0]).map(([i, why]) => ({ i, why })), fixes: fixes.slice(0, 40), cents };
}
