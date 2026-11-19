// Faceless clips, server only: a faceless recording (narration over a background, lib/unedit-faceless.ts) has no
// speaker, so its clips render the UneditFaceless composition (Genovus Motion) instead of UneditPro's speaker layouts.
// Every moment is a visual beat, and every beat is grounded:
//   hook       the clip's title, huge, in the first seconds (always the first beat)
//   number     a figure the narrator says word for word in that sentence (toShots checks it)
//   word       the sentence's accent word, kinetic
//   statement  the sentence itself as bold kinetic type (never an empty frame)
//   verdict    confirmed vs not confirmed, from the story's approved claims (confirmed = status 'confirmed'; not
//              confirmed = reported, alleged or unsupported, each with who says it); a statement when there are none
//   quote / timeline / source / scene   the sources sheet's lines, on the sentence where their words are said; an
//              article shows as a document labelled SUMMARY (the sheet's words, not the source's); a source chip is a
//              statement with "Source · outlet" under it. Only a quote beat carries verbatim words.
// A beat never shows a person's photo or likeness: people appear as text only.
import 'server-only';
import { wordsForSpans, type Span, type Word } from '@/lib/unedit-media';
import type { Shot } from '@/lib/unedit-shots';
import type { NewsEntry } from '@/lib/unedit-news';

export type FacelessClaim = { text: string; status: string; attribution: string | null; approved: boolean };
export type FBeat = {
  s: number; e: number;
  kind: 'hook' | 'number' | 'word' | 'statement' | 'verdict' | 'quote' | 'timeline' | 'source' | 'scene';
  text?: string; accent?: string | null; figure?: string | null; who?: string; when?: string;
  items?: { date: string; text: string }[];
  confirmed?: string[]; unconfirmed?: { text: string; who: string }[];
  scene?: { type: string; title: string; facts: string[]; who: string };
};
export type FacelessProps = {
  src: string; secs: number; words: { w: string; s: number; e: number; a?: boolean }[]; beats: FBeat[];
  kicker: string; subject: string; sfx: boolean; gl: boolean;
  end: { line: string; cta: string; site: string };
};

const END_SECS = 2.8; // the end card after the narration (composition adds it)
const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}$%']/gu, '');
const MAX_CLAIM = 220;

/** Where a sheet line's spoken words start, as a global word index (the first exact run), or -1. */
export function findSaid(words: Word[], say: string): number {
  const want = say.split(/\s+/).map(norm).filter(Boolean);
  if (!want.length) return -1;
  outer: for (let i = 0; i + want.length <= words.length; i++) {
    for (let k = 0; k < want.length; k++) if (norm(words[i + k].w) !== want[k]) continue outer;
    return i;
  }
  return -1;
}

/** The story's subject for the ghost type: the proper noun the narrator says most (not at a sentence start), or ''. */
export function subjectOf(words: Word[]): string {
  const count = new Map<string, number>();
  for (let i = 1; i < words.length; i++) {
    if (/[.!?]$/.test(words[i - 1].w)) continue;
    const w = words[i].w.replace(/['’]s$/, '').replace(/[^\p{L}\p{N}-]/gu, '');
    if (w.length < 3 || !/^\p{Lu}/u.test(w) || ['The', 'And', 'But', 'This', 'That', 'Here', 'What', 'CEO', 'CFO', 'SEC'].includes(w)) continue;
    count.set(w, (count.get(w) ?? 0) + 1);
  }
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : '';
}

/** The verdict card's two columns from the story's claims (approved ones only, short enough to read). Confirmed needs
 *  at least one approved confirmed claim; "not confirmed" lists approved reported/alleged/unsupported claims with who
 *  says them, or else the narrator's own sentence (from the approved script) about what isn't confirmed. */
export function verdictOf(claims: FacelessClaim[], said: string): { confirmed: string[]; unconfirmed: { text: string; who: string }[] } | null {
  const ok = claims.filter((c) => c.approved && c.text.length <= MAX_CLAIM);
  const confirmed = ok.filter((c) => c.status === 'confirmed').slice(0, 2).map((c) => c.text);
  const reported = ok.filter((c) => ['reported', 'alleged', 'unsupported'].includes(c.status)).slice(0, 2).map((c) => ({ text: c.text, who: c.attribution || 'Reported' }));
  if (!confirmed.length) return null;
  return { confirmed, unconfirmed: reported.length ? reported : [{ text: said, who: 'Still open' }] };
}

/** The composition's props: the clip's shots moved onto its own timeline as beats, sheet lines placed on their words. */
export function facelessProps(src: string, words: Word[], spans: Span[], shots: Shot[], accents: number[], opts: { title: string; sheet: NewsEntry[]; claims: FacelessClaim[]; kicker?: string }): FacelessProps {
  const marks = new Set(accents);
  const timed = wordsForSpans(words.map((w, i) => (marks.has(i) ? { ...w, a: true } : w)), spans);
  const secs = spans.reduce((a, s) => a + (s.to - s.from), 0);
  const owns = (sh: Shot, i: number) => {
    const lead = i > 0 && spans[i - 1].to <= spans[i].from ? spans[i - 1].to : spans[i].from - 0.2;
    return sh.s >= lead && sh.s < spans[i].to;
  };
  const sentence = (sh: Shot) => words.slice(sh.w0, sh.w1 + 1).map((w) => w.w).join(' ');
  // Sheet lines by the word they start on, for the shot that plays that word.
  const placed = new Map<number, NewsEntry>();
  // Article lines first: an article and a source chip on the same words is the article (it has the headline).
  for (const e of [...opts.sheet].sort((a, b) => Number(b.kind === 'article') - Number(a.kind === 'article'))) {
    if (!['quote', 'timeline', 'source', 'article', 'scene'].includes(e.kind)) continue;
    const i = findSaid(words, e.say);
    if (i >= 0 && !placed.has(i)) placed.set(i, e);
  }
  const used = new Set<NewsEntry>();
  const beats: FBeat[] = [];
  let k = 0, offset = 0, carry = false;
  for (const [n, sh] of shots.entries()) {
    while (k < spans.length && !owns(sh, k)) { offset += spans[k].to - spans[k].from; k++; }
    if (k >= spans.length) break;
    const sp = spans[k];
    const s = offset + Math.max(0, sh.s - sp.from), e = Math.min(secs, offset + Math.min(sh.e, sp.to) - sp.from);
    const accent = sh.accent != null ? words[sh.accent]?.w ?? null : null;
    let b: FBeat = { s, e, kind: 'statement', text: sentence(sh), accent };
    if (n === 0) b = { s, e, kind: 'hook', text: opts.title, accent };
    else if (sh.layout === 'number' && sh.figure) b = { s, e, kind: 'number', figure: sh.figure, text: sentence(sh), accent };
    else if (sh.layout === 'word' && accent) b = { s, e, kind: 'word', accent, text: sentence(sh) };
    else if (sh.layout === 'verdict') { const v = verdictOf(opts.claims, sentence(sh)); if (v) b = { s, e, kind: 'verdict', ...v }; }
    // A sheet line said in this sentence takes the beat (it is the article's own material). One said during the hook
    // waits for the next beat rather than being lost under the title.
    const hit = [...placed].find(([i, en]) => !used.has(en) && (i >= sh.w0 && i <= sh.w1 || (carry && i < sh.w0)));
    carry = false;
    if (hit && n === 0) carry = true;
    else if (hit) {
      const en = hit[1]; used.add(en);
      if (en.kind === 'quote') b = { s, e, kind: 'quote', text: en.text, who: en.who ?? '', when: en.when };
      else if (en.kind === 'timeline' && en.items?.length) b = { s, e, kind: 'timeline', text: en.title ?? en.text, items: en.items.slice(0, 4).map((x) => ({ date: x.date, text: x.text })) };
      // An article: its outlet, its own description and the site; a source chip: the outlet over the sentence it backs.
      else if (en.kind === 'article') b = { s, e, kind: 'source', who: en.title ?? en.who ?? '', text: en.text, when: [en.who, en.when].filter(Boolean).join(' · ') };
      // A source chip is the narrator's sentence with the outlet cited under it, never the sentence dressed as the
      // outlet's own document (2026-11-19: an 8-K card read as a quote of the filing).
      else if (en.kind === 'source') b = { s, e, kind: 'statement', text: sentence(sh), accent, who: en.text };
      else if (en.kind === 'scene' && en.scene) b = { s, e, kind: 'scene', scene: { type: en.scene, title: en.text, facts: en.facts ?? [], who: en.who ?? '' } };
    }
    beats.push(b);
  }
  if (beats[0]) beats[0].s = 0;
  // A big word or figure is a beat, not a scene: after 2.4 s the sentence takes over as a statement.
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if ((b.kind === 'word' || b.kind === 'number') && b.e - b.s > 3.4) {
      beats.splice(i + 1, 0, { s: b.s + 2.4, e: b.e, kind: 'statement', text: b.text, accent: b.accent });
      b.e = b.s + 2.4;
    }
  }
  // Beats touch: each holds until the next begins (a sentence pause never leaves an empty frame), the last to the end.
  for (let i = 0; i < beats.length; i++) beats[i].e = i + 1 < beats.length ? beats[i + 1].s : secs;
  const out = beats.length ? beats : [{ s: 0, e: secs, kind: 'hook' as const, text: opts.title }];
  return {
    src, secs, words: timed, beats: out, kicker: opts.kicker ?? 'The story, explained', subject: subjectOf(words.filter((w) => spans.some((sp) => w.s >= sp.from && w.e <= sp.to))), sfx: process.env.UNEDIT_SFX !== 'off',
    gl: out.some((b) => b.scene?.type === 'assembly'),
    end: { line: 'Get the full story', cta: 'Free strategy session', site: 'genovus.io' },
  };
}

export const FACELESS_END_SECS = END_SECS;

/** One narrated line and where it sits in the faceless recording (seconds), stored at build time. */
export type ScriptLine = { text: string; s: number; e: number };

/** The transcript of a faceless recording, spelled as the script. The narrator reads the script word for word, so
 *  speech-to-text only adds mistakes ("8-K" heard as "eight k"). Each line is aligned only with the words heard in its
 *  own time window (a mismatch can't drift into the next line): matching words take the script's spelling and keep
 *  their timing; a run that differs ("eight k" ↔ "8-K") becomes the script's tokens spread over the run's time;
 *  script words the transcript missed get the gap they were said in; extra heard words are dropped. */
export function alignToScript(words: Word[], lines: ScriptLine[]): Word[] {
  if (!lines.length) return words;
  const out: Word[] = [];
  const key = (w: string) => norm(w).replace(/'/g, '');
  const spread = (toks: string[], from: number, to: number, c?: number) => {
    const d = Math.max(0.02 * toks.length, to - from) / toks.length;
    toks.forEach((w, i) => out.push({ w, s: from + i * d, e: from + (i + 1) * d, ...(c != null ? { c } : {}) }));
  };
  let wi = 0;
  for (const [k, ln] of lines.entries()) {
    const toks = ln.text.split(/\s+/).filter(Boolean);
    const until = k + 1 < lines.length ? lines[k + 1].s - 0.2 : Infinity;
    const heard: Word[] = [];
    while (wi < words.length && (words[wi].s + words[wi].e) / 2 < until) heard.push(words[wi++]);
    if (!toks.length) continue;
    if (!heard.length) { spread(toks, ln.s, ln.e); continue; }
    // Longest common subsequence of the normalised tokens, then walk it.
    const A = heard.map((w) => key(w.w)), B = toks.map(key), n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] && A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0, ri = 0, rj = 0; // ri/rj: start of the current unmatched runs
    let prevEnd = Math.min(ln.s, heard[0].s);
    const flush = (nextStart: number) => {
      const run = heard.slice(ri, i), tk = toks.slice(rj, j);
      if (tk.length) run.length ? spread(tk, run[0].s, run[run.length - 1].e, run[0].c) : spread(tk, prevEnd, Math.max(prevEnd, nextStart));
    };
    while (i < n && j < m) {
      if (A[i] && A[i] === B[j]) {
        flush(heard[i].s);
        out.push({ ...heard[i], w: toks[j] });
        prevEnd = heard[i].e; i++; j++; ri = i; rj = j;
      } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
    }
    i = n; j = m; flush(Math.max(prevEnd, ln.e));
  }
  return out;
}
