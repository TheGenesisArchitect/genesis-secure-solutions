// Unedit Pro's shot plan: one shot per sentence of a clip, each with a layout, an optional real-screen insert or
// figure, and one accent word (the caption's emphasis, and a punch-in on the cut). Claude proposes it in the same call
// that picks the clips; code owns it, like the cuts: layouts come from a fixed list, screens must exist in the screen
// library, the accent is a word index inside its own sentence, the first shot on screen is the speaker's face, and a
// shot too short to read takes the layout before it. Invalid parts are repaired or dropped, never trusted.
import library from '@/data/screen-library.json';

export const LAYOUTS = ['face', 'card', 'screen', 'split', 'number', 'word'] as const;
export type Layout = (typeof LAYOUTS)[number];
/** Global word indexes (into the transcript) and seconds on the recording's timeline. */
export type Shot = { w0: number; w1: number; s: number; e: number; layout: Layout; accent: number | null; screen: string | null; figure: string | null };
export type RawShot = { s?: number; layout?: string; accent?: string; screen?: string | null; figure?: string | null };
type Sentence = { i: number; s: number; e: number; text: string; w0: number; w1: number };

const SCREENS = new Map(((library as { screens: { code: string; title: string }[] }).screens ?? []).map((x) => [x.code, x.title]));
const MIN_SHOT_S = 1.6;
const STOP = new Set(['the', 'and', 'but', 'for', 'that', 'this', 'with', 'you', 'your', 'are', 'was', 'were', 'have', 'has', 'had', 'its', "it's", 'our', 'they', 'them', 'then', 'than', 'just', 'like', 'into', 'from', 'what', 'when', 'where', 'there', 'their', 'about', 'some', 'really', 'very', 'gonna', 'kind']);
const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9$%']/g, '');

/** Every real screen code in the library. */
export const screenCodes = () => new Set(SCREENS.keys());

/** The screen-library lines the prompt offers Claude (code: what it shows). */
export function screenMenu(): string {
  return [...SCREENS].map(([code, title]) => `${code}: ${title}`).join('\n');
}

/** The prompt's instructions for the "shots" field of each clip. */
export const SHOTS_RULES = [
  'For every clip also write "shots": one entry per sentence the clip plays (its hook sentences too), in sentence order.',
  `Each shot: {"s":<sentence #>,"layout":"${LAYOUTS.join('|')}","accent":"<ONE word copied exactly from that sentence: the number, name or verb that carries its point; never a filler word>","screen":"<a screen code from the list or null>","figure":"<a number or 1-3 words from the sentence for a big card, or null>"}.`,
  'Layouts: face = the speaker full frame. card = the speaker in a card on a light canvas. screen = a real product screen with the speaker in a corner bubble (needs "screen"). split = the speaker above, a screen or figure below. number = one big figure from the sentence (needs "figure"). word = the accent word huge, kinetic type.',
  'The audience should SEE the product working, not read about it. Whenever a sentence mentions the product, a feature, a step, a page, a result or what someone does in it, show the closest real screen from the list (screen, or split when the speaker’s face matters). When the clip talks about the product, at least half its shots should be screen or split. A screen may repeat across sentences while the speaker is still describing it.',
  'Use card and word for opinions, feelings and punchlines; number only for a figure the speaker says word for word in that sentence. Change layout every one or two sentences, except a screen may hold while it is still being described. The first shot is always face. Never invent screen codes.',
].join('\n');

/** Repair Claude's shots for one clip into code-checked shots over the sentences the clip plays. */
export function toShots(raw: RawShot[] | undefined, ss: Sentence[], order: number[]): Shot[] {
  const bySentence = new Map<number, RawShot>();
  for (const r of Array.isArray(raw) ? raw : []) if (Number.isInteger(Number(r?.s))) bySentence.set(Number(r.s), r);
  const shots: Shot[] = [];
  for (const [k, i] of order.entries()) {
    const sen = ss[i];
    if (!sen) continue;
    const r = bySentence.get(i) ?? {};
    let layout: Layout = (LAYOUTS as readonly string[]).includes(String(r.layout)) ? (r.layout as Layout) : 'face';
    const screen = typeof r.screen === 'string' && SCREENS.has(r.screen) ? r.screen : null;
    // A figure is shown only if the speaker says all of it in this sentence ("three hours" never over "three minutes").
    const said = (f: string) => { const want = f.toLowerCase().split(/\s+/).map(norm).filter(Boolean); const have = new Set(sen.text.split(' ').map(norm)); return want.length > 0 && want.every((w) => have.has(w)); };
    const figure = typeof r.figure === 'string' && r.figure.trim() && r.figure.trim().length <= 14 && said(r.figure.trim()) ? r.figure.trim() : null;
    if (layout === 'screen' && !screen) layout = 'face';
    if (layout === 'split' && !screen && !figure) layout = 'card';
    if (layout === 'number' && !figure) layout = 'card';
    // The accent: the first word of this sentence matching the model's pick (not a stop word, 3+ letters).
    const want = norm(String(r.accent ?? ''));
    const toks = sen.text.split(' ');
    let accent: number | null = null;
    if (want.length >= 3 && !STOP.has(want)) {
      const j = toks.findIndex((t) => norm(t) === want);
      if (j >= 0 && sen.w0 + j <= sen.w1) accent = sen.w0 + j;
    }
    if (layout === 'word' && accent == null) layout = 'card';
    if (k === 0) layout = 'face';
    const shot: Shot = { w0: sen.w0, w1: sen.w1, s: sen.s, e: sen.e, layout, accent, screen: layout === 'screen' || layout === 'split' ? screen : null, figure: layout === 'number' || layout === 'split' ? figure : null };
    const prev = shots[shots.length - 1];
    // One huge word at a time: a word shot right after another becomes a card.
    if (prev && shot.layout === 'word' && prev.layout === 'word') shot.layout = 'card';
    // Too short to read as its own shot: it keeps the previous layout (its accent word still counts).
    // A figure or a huge word belongs to the sentence that says it, so after one the short shot becomes a card.
    if (prev && shot.e - shot.s < MIN_SHOT_S) {
      if (prev.layout === 'number' || prev.layout === 'word') { shot.layout = 'card'; shot.screen = null; shot.figure = null; }
      else { shot.layout = prev.layout; shot.screen = prev.screen; shot.figure = prev.figure; }
    }
    shots.push(shot);
  }
  return shots;
}

/** Sentence numbers a clip plays, in playback order: the hook first (when there is one), then the moment. */
export function playOrder(ss: Sentence[], from: number, to: number, hookFrom: number | null, hookTo: number | null): number[] {
  const inRange = (a: number, b: number) => ss.filter((x) => x.s >= a - 0.1 && x.e <= b + 0.2).map((x) => x.i);
  return [...(hookFrom != null && hookTo != null ? inRange(hookFrom, hookTo) : []), ...inRange(from, to)];
}
