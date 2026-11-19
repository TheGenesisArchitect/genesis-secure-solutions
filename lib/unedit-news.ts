// The newsroom's sources sheet: the operator-approved facts an episode shows on screen, each tied to the words the
// speaker says when it should appear. Nothing here is written by a model: a source chip, quote card, timeline or
// ticker exists only if it is on the sheet, and it lands where its spoken words are found in the transcript. An
// entry whose words aren't found is not guessed into place; it comes back as a note for the card.
//
// The sheet is plain text, one entry per line, fields split by " | " (JSON with the same fields also works):
//   source   | <spoken words> | <source shown, e.g. NVIDIA board statement · Nov 8, 2026>
//   quote    | <spoken words> | <exact quote> | <who said it> | <when>
//   timeline | <spoken words> | <title> | <date>: <text> @ <spoken words> ; <date>: <text> @ <spoken words> ; …
//   ticker   | <spoken words> | <headline> | <label> | <item> ; <item> ; …
//   globe    | <spoken words> | alone | fall | lit [| <caption>]   (the figure on the globe, a full-frame insert)
//   article  | <spoken words> | <headline> | <publisher> | <date> | <url> | <passage> [| <image url>]
//            (a cut to the article itself, the passage highlighted, the speaker in a corner bubble; built by the
//            newsroom from the verified citation, never by a model)
//   scene    | <spoken words> | <type> | <title> | <fact> ; <fact> (or - for none) | <source shown> [| <url>]
//            (a purpose-built scene from the episode's article: model, bench, cad, lab or assembly; facts are
//            "label: value" or "label: before → after"; drafted by Helix from the article, checked by code against
//            the article's own words, added here only when a person approves the scene plan; lib/unedit-scenes.ts)
// Items are split by " ; " with a space on both sides, so a ";" inside a line of text stays in the text.
import type { Word } from '@/lib/unedit-media';
import { findRun } from '@/lib/unedit-edit';
import { SCENES, parseFact, type SceneType } from '@/lib/unedit-scene-kit';

export type NewsKind = 'source' | 'quote' | 'timeline' | 'ticker' | 'globe' | 'article' | 'scene';
export const NEWS_KINDS: readonly NewsKind[] = ['source', 'quote', 'timeline', 'ticker', 'globe', 'article', 'scene'];
export type GlobePhase = 'alone' | 'fall' | 'lit';
export type NewsEntry = {
  kind: NewsKind; say: string; text: string; who?: string; when?: string; title?: string;
  items?: { date: string; text: string; say?: string }[]; crawl?: string[]; label?: string; phase?: GlobePhase;
  /** article: the page and its preview image (an outside link, or a stored copy's Blob path once planned). */ url?: string; image?: string;
  /** scene: which scene and the facts it draws ("label: value" or "label: before → after"); who = the source shown. */ scene?: SceneType; facts?: string[];
};
/** What the reel draws for a newsroom item (Genovus Motion src/hf/news.tsx). */
export type NewsData = { who?: string; when?: string; title?: string; items?: { date: string; text: string; t: number }[]; crawl?: string[]; desk?: string; label?: string; phase?: GlobePhase;
  /** article: the page's host for the address bar, and the preview image (Blob path; a link in the reel). */ url?: string; image?: string };

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const DESK = () => (process.env.UNEDIT_NEWS_DESK || 'Genovus Signal').trim();

/** Read a sheet (text or JSON). Lines that don't parse come back as errors, never half-entries. */
export function parseSheet(input: string | unknown[]): { entries: NewsEntry[]; errors: string[] } {
  const entries: NewsEntry[] = [], errors: string[] = [];
  const raw: unknown[] = Array.isArray(input) ? input
    : input.trim().startsWith('[') ? (JSON.parse(input) as unknown[])
    : input.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  raw.forEach((row, i) => {
    let e: NewsEntry | null = null;
    if (typeof row === 'string') {
      const f = row.split(/\s+\|\s+/).map((x) => x.trim());
      const kind = f[0]?.toLowerCase() as NewsKind;
      if (kind === 'source' && f.length >= 3) e = { kind, say: f[1], text: f[2] };
      else if (kind === 'quote' && f.length >= 4) e = { kind, say: f[1], text: f[2].replace(/^["“]|["”]$/g, ''), who: f[3], when: f[4] };
      else if (kind === 'timeline' && f.length >= 4) {
        const items = f[3].split(/\s+;\s+/).filter(Boolean).map((x) => {
          const [body, say] = x.split(/\s+@\s+/);
          const m = body.match(/^([^:]{1,24}):\s*(.+)$/);
          return m ? { date: m[1].trim(), text: m[2].trim(), say: say?.trim() } : null;
        });
        if (items.every(Boolean)) e = { kind, say: f[1], text: f[2], title: f[2], items: items as NonNullable<NewsEntry['items']> };
      } else if (kind === 'globe' && f.length >= 3 && ['alone', 'fall', 'lit'].includes(f[2].toLowerCase())) e = { kind, say: f[1], text: f[3] ?? '', phase: f[2].toLowerCase() as GlobePhase };
      else if (kind === 'ticker' && f.length >= 5) e = { kind, say: f[1], text: f[2], label: f[3], crawl: f[4].split(/\s+;\s+/).filter(Boolean) };
      else if (kind === 'scene' && f.length >= 6 && SCENES[f[2].toLowerCase() as SceneType]) e = { kind, say: f[1], scene: f[2].toLowerCase() as SceneType, text: f[3], title: f[3], facts: f[4] === '-' ? [] : f[4].split(/\s+;\s+/).filter(Boolean), who: f[5], url: /^https?:\/\//.test(f[6] ?? '') ? f[6] : undefined };
      else if (kind === 'article' && f.length >= 7 && /^https?:\/\//.test(f[5])) e = { kind, say: f[1], title: f[2], who: f[3], when: f[4] && f[4] !== '-' ? f[4] : undefined, url: f[5], text: f[6], image: /^https:\/\//.test(f[7] ?? '') ? f[7] : undefined };
    } else if (row && typeof row === 'object') {
      const o = row as Record<string, unknown>;
      if (NEWS_KINDS.includes(o.kind as NewsKind) && o.say && (o.text || o.kind === 'globe')) e = { ...(o as unknown as NewsEntry), text: String(o.text ?? '') };
    }
    if (!e) { errors.push(`line ${i + 1} isn't a source, quote, timeline, ticker, globe, article or scene entry`); return; }
    if (e.kind === 'scene') {
      const def = SCENES[e.scene as SceneType], facts = e.facts ?? [];
      if (!def) { errors.push(`line ${i + 1}: a scene's type is one of ${Object.keys(SCENES).join(', ')}`); return; }
      const bad = facts.find((x) => !parseFact(x));
      if (bad) { errors.push(`line ${i + 1}: "${bad}" isn't a "label: number" fact`); return; }
      if (facts.length < def.facts.min || facts.length > def.facts.max || facts.some((x) => Boolean(parseFact(x)!.b) !== def.facts.pair)) { errors.push(`line ${i + 1}: a ${def.label.toLowerCase()} takes ${def.facts.min === def.facts.max ? def.facts.min : `${def.facts.min} to ${def.facts.max}`} ${def.facts.pair ? 'before → after' : 'single-number'} facts`); return; }
      if (!e.who) { errors.push(`line ${i + 1}: a scene needs its source shown`); return; }
    }
    if (e.kind === 'quote' && !e.who) { errors.push(`line ${i + 1}: a quote needs who said it`); return; }
    if (e.say.split(/\s+/).length < 2) { errors.push(`line ${i + 1}: give at least two spoken words to place it`); return; }
    entries.push({
      kind: e.kind, say: clip(e.say, 160), text: clip(e.text, e.kind === 'quote' ? 220 : 90), who: e.who ? clip(e.who, 60) : undefined, when: e.when ? clip(e.when, 30) : undefined,
      title: e.title ? clip(e.title, e.kind === 'article' ? 140 : 50) : undefined, label: e.label ? clip(e.label, 16) : undefined,
      ...(e.kind === 'article' ? { url: clip(e.url, 1000), image: e.image ? clip(e.image, 1000) : undefined, text: clip(e.text, 280) } : {}),
      ...(e.kind === 'scene' ? { scene: e.scene, facts: (e.facts ?? []).slice(0, 5).map((x) => clip(x, 80)), title: clip(e.title ?? e.text, 80), url: e.url ? clip(e.url, 1000) : undefined } : {}),
      items: e.items?.slice(0, 5).map((x) => ({ date: clip(x.date, 16), text: clip(x.text, 70), say: x.say ? clip(x.say, 120) : undefined })),
      crawl: e.crawl?.slice(0, 8).map((x) => clip(x, 70)), phase: e.phase,
    });
  });
  return { entries, errors };
}

/** Where the spoken words start (source seconds), trying the whole phrase, then its first six, then first four words. */
function spokenAt(words: Word[], say: string): number | null {
  const w = say.split(/\s+/).filter(Boolean);
  for (const n of [w.length, 6, 4]) {
    if (n > w.length || n < 2) continue;
    const run = findRun(words, w.slice(0, n).join(' '));
    if (run.length) return words[run[0]].s;
  }
  return null;
}

export type PlacedNews = { T: number; D: number; kind: NewsKind; text: string; news: NewsData; sound: string | null };

/** Place the sheet on the edited timeline. `epTime` maps a source second to the episode (null = cut). */
export function placeNews(entries: NewsEntry[], words: Word[], epTime: (s: number) => number | null, secs: number): { items: PlacedNews[]; notes: string[] } {
  const items: PlacedNews[] = [], notes: string[] = [];
  for (const e of entries) {
    const at = spokenAt(words, e.say);
    const T0 = at == null ? null : epTime(at);
    if (T0 == null) { notes.push(`${e.kind} "${e.text.slice(0, 40)}" not placed: "${e.say.slice(0, 40)}" isn't in the episode`); continue; }
    // Scenes are placed but not drawn yet: their renders join the episode in the next step (lib/unedit-scenes.ts).
    if (e.kind === 'scene') { notes.push(`scene "${e.text.slice(0, 40)}" lands at ${Math.floor(T0 / 60)}:${String(Math.floor(T0 % 60)).padStart(2, '0')} (planned; scene renders aren't on episodes yet)`); continue; }
    const T = Math.max(0, T0 - (e.kind === 'source' ? 0.1 : 0.25));
    if (e.kind === 'source') items.push({ T, D: 4.5, kind: e.kind, text: e.text, news: {}, sound: 'tick' });
    else if (e.kind === 'quote') items.push({ T, D: Math.min(8, 3.6 + e.text.split(/\s+/).length * 0.22), kind: e.kind, text: e.text, news: { who: e.who, when: e.when }, sound: 'swish' });
    else if (e.kind === 'globe') { const ph = e.phase ?? 'alone'; items.push({ T, D: ph === 'lit' ? 5 : ph === 'fall' ? 3 : 4, kind: e.kind, text: e.text, news: { phase: ph }, sound: ph === 'alone' ? 'riser' : ph === 'fall' ? 'hit' : 'sting' }); }
    else if (e.kind === 'ticker') items.push({ T, D: 7, kind: e.kind, text: e.text, news: { desk: DESK(), label: e.label ?? 'Sourced', crawl: e.crawl ?? [] }, sound: 'swish' });
    // The cut to the article: long enough to read the highlighted passage (about 3 words a second), 5 to 8 s.
    else if (e.kind === 'article') items.push({ T, D: Math.min(8, Math.max(5, 2.2 + e.text.split(/\s+/).length / 3)), kind: e.kind, text: e.text, news: { who: e.who, when: e.when, title: e.title, url: e.url, image: e.image }, sound: 'whoosh' });
    else {
      const its = (e.items ?? []).map((x, i) => {
        const s = x.say ? spokenAt(words, x.say) : null;
        const t = s == null ? null : epTime(s);
        return { date: x.date, text: x.text, t: t == null ? 0.4 + i * 1.4 : Math.max(0.3, t - T) };
      });
      for (let i = 1; i < its.length; i++) its[i].t = Math.max(its[i].t, its[i - 1].t + 0.6); // in order, never on top of each other
      // A timeline holds at most 16 s; a beat said later than that can't land on it, so it is named, not hidden.
      const fit = its.filter((x) => x.t <= 12.8);
      for (const x of its.slice(fit.length)) notes.push(`timeline beat "${x.date}" not placed: it's said ${x.t.toFixed(0)} s after the timeline starts (16 s at most)`);
      const D = (fit.length ? fit[fit.length - 1].t : 0) + 3.2;
      items.push({ T, D, kind: e.kind, text: e.title ?? e.text, news: { title: e.title, items: fit }, sound: 'whoosh' });
    }
  }
  for (const it of items) if (it.T + it.D > secs) it.D = Math.max(1.5, secs - it.T);
  return { items: items.filter((x) => x.T < secs - 1), notes };
}

/** The sheet back as text, for editing on the card (the same format parseSheet reads). */
export function sheetText(entries: NewsEntry[] | null | undefined): string {
  return (entries ?? []).map((e) => {
    if (e.kind === 'source') return `source | ${e.say} | ${e.text}`;
    if (e.kind === 'quote') return `quote | ${e.say} | ${e.text} | ${e.who ?? ''}${e.when ? ` | ${e.when}` : ''}`;
    if (e.kind === 'ticker') return `ticker | ${e.say} | ${e.text} | ${e.label ?? 'Sourced'} | ${(e.crawl ?? []).join(' ; ')}`;
    if (e.kind === 'globe') return `globe | ${e.say} | ${e.phase ?? 'alone'}${e.text ? ` | ${e.text}` : ''}`;
    if (e.kind === 'scene') return `scene | ${e.say} | ${e.scene} | ${e.title ?? e.text} | ${(e.facts ?? []).join(' ; ') || '-'} | ${e.who ?? ''}${e.url ? ` | ${e.url}` : ''}`;
    if (e.kind === 'article') return `article | ${e.say} | ${e.title ?? ''} | ${e.who ?? ''} | ${e.when ?? '-'} | ${e.url ?? ''} | ${e.text}${e.image ? ` | ${e.image}` : ''}`;
    return `timeline | ${e.say} | ${e.title ?? e.text} | ${(e.items ?? []).map((x) => `${x.date}: ${x.text}${x.say ? ` @ ${x.say}` : ''}`).join(' ; ')}`;
  }).join('\n');
}
