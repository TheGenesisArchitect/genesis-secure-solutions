// Episode Pro's edit: what of the recording stays, and which camera each piece uses. Pure code over the timed words,
// so it is testable and the model never owns a cut.
//   - Head and tail: the take starts just before the first real word and ends just after the last, so walking up to
//     the camera, reaching for the phone, or walking off to stop the recording never reaches the video.
//   - Hands-free camera commands ("start recording", "stop recording", "hey Siri, …") come out wherever they are.
//   - Fillers (uh, um, er, hmm) come out with the silence around them; long pauses shrink to a natural breath.
//   - False starts Claude names (an exact run of words) come out too.
//   - Cameras: one 8K (or 4K) frame gives a medium shot and a close-up. Every place a piece was cut out is hidden by a
//     change of camera when the last change was long enough ago; a long stretch changes camera at a sentence end.
import type { Span, Word } from '@/lib/unedit-media';

export type Cut = { from: number; to: number; why: 'head' | 'tail' | 'command' | 'filler' | 'pause' | 'false start' };
export type Camera = 'medium' | 'close';
export type Seg = { from: number; to: number; cam: Camera; /** a split piece: framed from the whole piece's middle */ mid?: number };
export type Edit = { keep: Span[]; cuts: Cut[]; segs: Seg[]; secs: number; removed: number };

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
const FILLER = new Set(['uh', 'um', 'uhm', 'umm', 'uhh', 'uhhh', 'er', 'erm', 'ah', 'ahh', 'hmm', 'hm', 'mm', 'mmm', 'eh']);
export const isFiller = (w: string) => FILLER.has(norm(w));
// Spoken camera and assistant commands (normalized word runs). Matched anywhere in the take.
const COMMANDS: string[][] = [
  'start recording', 'stop recording', 'start the recording', 'stop the recording', 'end recording', 'end the recording',
  'begin recording', 'start video', 'stop video', 'start the video', 'stop the video', 'start a video', 'take a video',
  'record a video', 'start filming', 'stop filming', 'hey siri', 'ok google', 'okay google', 'hey google', 'alexa',
].map((p) => p.split(' '));
// One-word cues only count when they stand alone (a pause on both sides) near the start or end of the take.
const CUES = new Set(['record', 'recording', 'action', 'cut', 'rolling', 'go']);
const EDGE_S = 15;
const ALONE_S = 0.6;

const PAD = 0.08;        // silence kept on each side of a cut, so a join never clips a word
const BREATH = 0.45;     // the longest pause kept between two words
const PAUSE_OVER = 0.8;  // a pause longer than this shrinks to BREATH
const MIN_KEEP = 0.3;    // a kept piece shorter than this joins the cut around it
const CAM_HOLD = 2.5;    // the least time on one camera before a cut may change it
const CAM_MAX = 9;       // the longest time on one camera before it changes at a sentence end

/** Word indexes that are a hands-free command: a listed phrase anywhere, or a lone cue word near either end. */
export function commandWords(words: Word[], duration: number): Set<number> {
  const out = new Set<number>();
  const n = words.map((w) => norm(w.w));
  for (let i = 0; i < n.length; i++) {
    for (const p of COMMANDS) {
      if (p.every((t, k) => n[i + k] === t)) { for (let k = 0; k < p.length; k++) out.add(i + k); }
    }
    const nearEdge = words[i].s < EDGE_S || words[i].e > duration - EDGE_S;
    const alone = (i === 0 || words[i].s - words[i - 1].e >= ALONE_S) && (i === n.length - 1 || words[i + 1].s - words[i].e >= ALONE_S);
    if (nearEdge && alone && CUES.has(n[i])) out.add(i);
  }
  // A countdown before the first real line ("3, 2, 1", "321", "three two one"), in the first few seconds.
  // A lone "one" could open a real line ("One thing I learned…"), so a run counts only when it is two or more count
  // words, written as digits, or followed by a clear pause.
  let run = 0;
  while (run < n.length && words[run].s < 10 && COUNT.test(n[run])) run++;
  const gapAfter = run < n.length && run > 0 ? words[run].s - words[run - 1].e : 0;
  if (run >= 2 || (run === 1 && (/^\d+$/.test(n[0]) || gapAfter >= 0.5))) for (let i = 0; i < run; i++) out.add(i);
  return out;
}
const COUNT = /^(?:[1-5]{1,5}|one|two|three|four|five|go)$/;


/** Find an exact run of words (a false start Claude named) and return its word indexes, or none. */
export function findRun(words: Word[], say: string, used = new Set<number>()): number[] {
  const want = say.split(/\s+/).map(norm).filter(Boolean);
  if (want.length < 2) return [];
  const n = words.map((w) => norm(w.w));
  for (let i = 0; i + want.length <= n.length; i++) {
    if (want.every((t, k) => n[i + k] === t) && !want.some((_, k) => used.has(i + k))) return want.map((_, k) => i + k);
  }
  return [];
}

function merge(cuts: Cut[]): Cut[] {
  const s = cuts.filter((c) => c.to - c.from > 0.01).sort((a, b) => a.from - b.from);
  const out: Cut[] = [];
  for (const c of s) {
    const last = out[out.length - 1];
    // Overlapping cuts join; the walk-up or walk-off names the joined cut (it is what the person would recognize).
    if (last && c.from <= last.to + 0.01) { last.to = Math.max(last.to, c.to); if (c.why === 'head' || c.why === 'tail') last.why = c.why; continue; }
    out.push({ ...c });
  }
  return out;
}

/** The edit: what stays, what was cut and why, and the camera for each kept piece. */
export function editList(words: Word[], duration: number, falseStarts: string[] = []): Edit {
  const drop = commandWords(words, duration);
  const why = new Map<number, Cut['why']>([...drop].map((i) => [i, 'command' as const]));
  words.forEach((w, i) => { if (!why.has(i) && isFiller(w.w)) why.set(i, 'filler'); });
  const used = new Set(why.keys());
  for (const say of falseStarts.slice(0, 20)) for (const i of findRun(words, say, used)) { why.set(i, 'false start'); used.add(i); }

  const real = words.map((_, i) => i).filter((i) => !why.has(i));
  if (!real.length) return { keep: [], cuts: [], segs: [], secs: 0, removed: duration };
  const start = Math.max(0, words[real[0]].s - 0.3);
  const end = Math.min(duration, words[real[real.length - 1]].e + 0.4);
  const cuts: Cut[] = [];
  if (start > 0.05) cuts.push({ from: 0, to: start, why: 'head' });
  if (end < duration - 0.05) cuts.push({ from: end, to: duration, why: 'tail' });

  // Each dropped word goes with the silence around it, up to the neighbouring kept words (less a little padding).
  for (const [i, w] of why) {
    const prev = [...real].reverse().find((k) => k < i);
    const next = real.find((k) => k > i);
    const from = prev == null ? start : Math.min(words[i].s, words[prev].e + PAD);
    const to = next == null ? end : Math.max(words[i].e, words[next].s - PAD);
    if (to > from) cuts.push({ from, to, why: w });
  }
  // Long pauses between kept words shrink to a breath.
  for (let k = 1; k < real.length; k++) {
    const a = words[real[k - 1]], b = words[real[k]];
    if (b.s - a.e > PAUSE_OVER) cuts.push({ from: a.e + BREATH / 2, to: b.s - BREATH / 2, why: 'pause' });
  }

  // What stays: [start, end] minus the cuts; slivers too short to read join the cut around them.
  let merged = merge(cuts);
  let keep: Span[] = [];
  let t = start;
  for (const c of merged) {
    if (c.to <= start || c.from >= end) continue;
    if (c.from > t) keep.push({ from: t, to: Math.min(c.from, end) });
    t = Math.max(t, c.to);
  }
  if (t < end) keep.push({ from: t, to: end });
  const slivers = keep.filter((k) => k.to - k.from < MIN_KEEP);
  if (slivers.length) {
    merged = merge([...merged, ...slivers.map((s) => ({ ...s, why: 'pause' as const }))]);
    keep = keep.filter((k) => k.to - k.from >= MIN_KEEP);
  }
  // Every edge sits on the 30 fps frame grid, so each piece is a whole number of frames and the soundtrack (cut by
  // time) matches the picture (cut by frames) exactly, however many joins there are.
  keep = keep.map((k) => ({ from: frame(k.from), to: frame(k.to) })).filter((k) => k.to - k.from >= MIN_KEEP);
  const secs = keep.reduce((a, k) => a + (k.to - k.from), 0);
  return { keep, cuts: merged.map((c) => ({ ...c, from: round(c.from), to: round(c.to) })), segs: cameras(keep, words), secs: round(secs), removed: round(duration - secs) };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
const frame = (x: number) => Math.round(Math.round(x * 30) / 30 * 1e6) / 1e6;

/** Which camera each kept piece uses. A join changes camera (hiding the jump) once the current camera has held
 *  CAM_HOLD seconds; a piece that runs past CAM_MAX on one camera changes at a sentence end inside it. */
export function cameras(keep: Span[], words: Word[]): Seg[] {
  const ends = words.filter((w) => /[.!?]["')\]]?$/.test(w.w)).map((w) => w.e);
  const segs: Seg[] = [];
  let cam: Camera = 'medium';
  let held = 0;
  for (const [i, k] of keep.entries()) {
    if (i > 0 && held >= CAM_HOLD) { cam = cam === 'medium' ? 'close' : 'medium'; held = 0; }
    let from = k.from;
    // Long piece: change camera at sentence ends, so no shot holds forever.
    for (const e of ends) {
      if (e <= from + 0.5 || e >= k.to - 0.5) continue;
      if (held + (e - from) >= CAM_MAX) {
        const at = frame(e + 0.06);
        segs.push({ from, to: at, cam });
        cam = cam === 'medium' ? 'close' : 'medium';
        held = 0;
        from = at;
      }
    }
    segs.push({ from, to: k.to, cam });
    held += k.to - from;
  }
  return segs;
}

/** A clip's spans with the edit applied: each span keeps only the parts of it the edit keeps. */
export function within(spans: Span[], keep: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    for (const k of keep) {
      const from = Math.max(s.from, k.from), to = Math.min(s.to, k.to);
      if (to - from >= MIN_KEEP) out.push({ from: round(from), to: round(to) });
    }
  }
  return out;
}
