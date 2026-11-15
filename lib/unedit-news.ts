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
// Items are split by " ; " with a space on both sides, so a ";" inside a line of text stays in the text.
import type { Word } from '@/lib/unedit-media';
import { findRun } from '@/lib/unedit-edit';

export type NewsKind = 'source' | 'quote' | 'timeline' | 'ticker';
export const NEWS_KINDS: readonly NewsKind[] = ['source', 'quote', 'timeline', 'ticker'];
export type NewsEntry = {
  kind: NewsKind; say: string; text: string; who?: string; when?: string; title?: string;
  items?: { date: string; text: string; say?: string }[]; crawl?: string[]; label?: string;
};
/** What the reel draws for a newsroom item (Genovus Motion src/hf/news.tsx). */
export type NewsData = { who?: string; when?: string; title?: string; items?: { date: string; text: string; t: number }[]; crawl?: string[]; desk?: string; label?: string };

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
      } else if (kind === 'ticker' && f.length >= 5) e = { kind, say: f[1], text: f[2], label: f[3], crawl: f[4].split(/\s+;\s+/).filter(Boolean) };
    } else if (row && typeof row === 'object') {
      const o = row as Record<string, unknown>;
      if (NEWS_KINDS.includes(o.kind as NewsKind) && o.say && o.text) e = o as unknown as NewsEntry;
    }
    if (!e) { errors.push(`line ${i + 1} isn't a source, quote, timeline or ticker entry`); return; }
    if (e.kind === 'quote' && !e.who) { errors.push(`line ${i + 1}: a quote needs who said it`); return; }
    if (e.say.split(/\s+/).length < 2) { errors.push(`line ${i + 1}: give at least two spoken words to place it`); return; }
    entries.push({
      kind: e.kind, say: clip(e.say, 160), text: clip(e.text, e.kind === 'quote' ? 220 : 90), who: e.who ? clip(e.who, 60) : undefined, when: e.when ? clip(e.when, 30) : undefined,
      title: e.title ? clip(e.title, 50) : undefined, label: e.label ? clip(e.label, 16) : undefined,
      items: e.items?.slice(0, 5).map((x) => ({ date: clip(x.date, 16), text: clip(x.text, 70), say: x.say ? clip(x.say, 120) : undefined })),
      crawl: e.crawl?.slice(0, 8).map((x) => clip(x, 70)),
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
    const T = Math.max(0, T0 - (e.kind === 'source' ? 0.1 : 0.25));
    if (e.kind === 'source') items.push({ T, D: 4.5, kind: e.kind, text: e.text, news: {}, sound: 'tick' });
    else if (e.kind === 'quote') items.push({ T, D: Math.min(8, 3.6 + e.text.split(/\s+/).length * 0.22), kind: e.kind, text: e.text, news: { who: e.who, when: e.when }, sound: 'swish' });
    else if (e.kind === 'ticker') items.push({ T, D: 7, kind: e.kind, text: e.text, news: { desk: DESK(), label: e.label ?? 'Sourced', crawl: e.crawl ?? [] }, sound: 'swish' });
    else {
      const its = (e.items ?? []).map((x, i) => {
        const s = x.say ? spokenAt(words, x.say) : null;
        const t = s == null ? null : epTime(s);
        return { date: x.date, text: x.text, t: t == null ? 0.4 + i * 1.4 : Math.max(0.3, t - T) };
      });
      for (let i = 1; i < its.length; i++) its[i].t = Math.max(its[i].t, its[i - 1].t + 0.6); // in order, never on top of each other
      const D = Math.min(14, (its.length ? its[its.length - 1].t : 0) + 3.2);
      items.push({ T, D, kind: e.kind, text: e.title ?? e.text, news: { title: e.title, items: its }, sound: 'whoosh' });
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
    return `timeline | ${e.say} | ${e.title ?? e.text} | ${(e.items ?? []).map((x) => `${x.date}: ${x.text}${x.say ? ` @ ${x.say}` : ''}`).join(' ; ')}`;
  }).join('\n');
}
