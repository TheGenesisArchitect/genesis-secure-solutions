// Footage Desk, server only: real footage under faceless clips, from sources UnEdit is allowed to use.
//   pixabay   Pixabay Content License (commercial use, no credit needed; we still list it in the post)
//   nasa      NASA Image and Video Library (generally public domain in the US; never implies NASA endorsement)
//   commons   Wikimedia Commons, ONLY public domain, CC0 and CC BY (credited on screen); never share-alike,
//             no-derivatives or non-commercial
// Never broadcast news, ripped online video, or a licence we can't read. Footage shows places, objects, documents,
// screens and markets, and (operator 2026-11-19, edutainment, no sales pitch on the close) the PUBLIC FIGURES at the
// centre of a story: licensed Commons photos and video only, picked only when the file's own title or description
// names the person (never by face), shown with a name plate and credit on the lines about them. Never private people,
// victims or minors, and never on an agency desk's clips. Never a brand's logo as the subject. Every clip is stored in private Blob with its source page, licence and credit
// (unedit_footage); searches are cached 24 hours (Pixabay's API terms). Gated by UNEDIT_FOOTAGE=on.
import 'server-only';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { put } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { ffmpeg, probe } from '@/lib/unedit-media';
import { claude } from '@/lib/unedit-moments';

export type FootageSource = 'pixabay' | 'nasa' | 'commons';
export type Candidate = {
  source: FootageSource; source_id: string; page_url: string; file_url: string; title: string; author: string | null;
  tags: string[]; width: number; height: number; secs: number;
  license: 'pixabay' | 'public-domain' | 'cc0' | 'cc-by'; license_note: string; credit: string | null;
  /** a still photo (shown with a slow push) instead of video; person = the public figure the source names */
  kind?: 'video' | 'photo'; person?: string;
};
export type Footage = { id: string; source: FootageSource; blob_path: string; title: string; page_url: string; license: string; license_note: string; credit: string | null; secs: number; width: number; height: number; kind: 'video' | 'photo'; person: string | null };
/** A line's footage plan: what to search and where, or null when a card says it better. */
export type FootagePlan = { i: number; query: string; source: FootageSource; /** a public figure named in the story */ person?: string } | null;

export const footageOn = () => process.env.UNEDIT_FOOTAGE === 'on';
// Wikimedia asks every client to identify itself with a way to reach it (a site, not a person's address).
const UA = 'GenovusUnEdit/1.0 (+https://genovus.io)';
const MAX_SECS = 12, MAX_BYTES = 150 * 1024 * 1024, DAY = 24 * 3600_000;
const db = () => adminDb();
const clip = (s: unknown, n: number) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// ---- sources -------------------------------------------------------------------------------------------------------

/** Pixabay video search (key from PIXABAY_API_KEY): real footage (not animation), safe search, at least 1280 wide. */
export async function searchPixabay(q: string): Promise<Candidate[]> {
  const key = (process.env.PIXABAY_API_KEY || '').trim();
  if (!key) return [];
  const u = new URL('https://pixabay.com/api/videos/');
  for (const [k, v] of Object.entries({ key, q: q.slice(0, 100), video_type: 'film', safesearch: 'true', min_width: '1280', per_page: '12', order: 'popular' })) u.searchParams.set(k, v);
  const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
  if (r.status === 429) throw new Error('Pixabay rate limit reached; try again in a minute.');
  if (!r.ok) throw new Error(`Pixabay search failed (${r.status}).`);
  const j = (await r.json()) as { hits?: { id: number; pageURL: string; tags: string; duration: number; user: string; videos: Record<string, { url: string; width: number; height: number; size: number }> }[] };
  return (j.hits ?? []).map((h) => {
    const f = [h.videos.medium, h.videos.large, h.videos.small].find((x) => x?.url && x.width >= 1280 && x.width <= 2600) ?? h.videos.small ?? h.videos.tiny;
    return { source: 'pixabay' as const, source_id: String(h.id), page_url: h.pageURL, file_url: f?.url ?? '', title: clip(h.tags, 140), author: h.user || null, tags: h.tags.split(',').map((t) => t.trim()).filter(Boolean),
      width: f?.width ?? 0, height: f?.height ?? 0, secs: h.duration, license: 'pixabay' as const, license_note: 'Pixabay Content License', credit: null };
  }).filter((c) => c.file_url);
}

/** NASA Image and Video Library (no key): video items, then each item's file list for a web-size MP4. */
export async function searchNasa(q: string): Promise<Candidate[]> {
  const u = new URL('https://images-api.nasa.gov/search');
  u.searchParams.set('q', q.slice(0, 100)); u.searchParams.set('media_type', 'video'); u.searchParams.set('page_size', '8');
  const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`NASA search failed (${r.status}).`);
  const j = (await r.json()) as { collection?: { items?: { href: string; data?: { nasa_id: string; title?: string; keywords?: string[]; center?: string }[] }[] } };
  const out: Candidate[] = [];
  for (const it of (j.collection?.items ?? []).slice(0, 6)) {
    const d = it.data?.[0];
    if (!d?.nasa_id) continue;
    const files = (await fetch(it.href, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) }).then((x) => (x.ok ? x.json() : [])).catch(() => [])) as string[];
    const mp4 = ['~medium.mp4', '~mobile.mp4', '~orig.mp4'].map((s) => files.find((f) => f.endsWith(s))).find(Boolean);
    if (!mp4) continue;
    out.push({ source: 'nasa', source_id: d.nasa_id, page_url: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, file_url: mp4.replace(/^http:/, 'https:'),
      title: clip(d.title, 140), author: d.center ?? 'NASA', tags: (d.keywords ?? []).slice(0, 12), width: 0, height: 0, secs: 0,
      license: 'public-domain', license_note: 'NASA media, generally not subject to US copyright; no NASA endorsement implied', credit: null });
  }
  return out;
}

/** The licence of a Commons file, only when it is one we take: public domain, CC0 or CC BY (any version). */
export function commonsLicense(meta: Record<string, { value?: string } | undefined>): { license: 'public-domain' | 'cc0' | 'cc-by'; note: string } | null {
  const code = String(meta.License?.value ?? '').toLowerCase().trim(), short = clip(meta.LicenseShortName?.value, 60);
  if (/(^|-)(sa|nd|nc)(-|$)/.test(code) || /\b(SA|ND|NC)\b/.test(short)) return null;
  if (code === 'cc0' || /^cc0/.test(code)) return { license: 'cc0', note: short || 'CC0' };
  if (/^pd($|-)/.test(code) || /^public domain/i.test(short)) return { license: 'public-domain', note: short || 'Public domain' };
  if (/^cc-by-\d/.test(code) || /^CC BY \d/.test(short)) return { license: 'cc-by', note: short || code.toUpperCase() };
  return null;
}

/** Wikimedia Commons video search with each file's licence; anything outside PD / CC0 / CC BY is dropped here. */
export async function searchCommons(q: string): Promise<Candidate[]> {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: `${q.slice(0, 100)} filetype:video`, gsrlimit: '12',
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'License|LicenseShortName|Artist|ObjectName' })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`Commons search failed (${r.status}).`);
  const j = (await r.json()) as { query?: { pages?: Record<string, { title: string; imageinfo?: { url: string; descriptionurl: string; width: number; height: number; duration?: number; size: number; mime: string; extmetadata?: Record<string, { value?: string }> }[] }> } };
  const out: Candidate[] = [];
  for (const p of Object.values(j.query?.pages ?? {})) {
    const ii = p.imageinfo?.[0];
    if (!ii || !/^video\//.test(ii.mime) || ii.size > MAX_BYTES) continue;
    const lic = commonsLicense(ii.extmetadata ?? {});
    if (!lic) continue;
    const artist = clip(ii.extmetadata?.Artist?.value, 80) || null;
    out.push({ source: 'commons', source_id: p.title, page_url: ii.descriptionurl, file_url: ii.url, title: clip(ii.extmetadata?.ObjectName?.value || p.title.replace(/^File:/, ''), 140), author: artist, tags: [],
      width: ii.width, height: ii.height, secs: ii.duration ?? 0, license: lic.license, license_note: lic.note,
      credit: lic.license === 'cc-by' ? `${artist ?? 'Wikimedia Commons'} · ${lic.note}` : null });
  }
  return out;
}

/** Does a file's own text name this person (every part of the name)? Identity comes from the source, never a face. */
export function namesPerson(text: string, person: string): boolean {
  const hay = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const parts = person.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  return parts.length >= 2 && parts.every((w) => hay.includes(` ${w} `));
}

/** A public figure on Commons: photos and video whose own title or description names them, PD / CC0 / CC BY only,
 *  always credited on screen (who took it and the licence). */
export async function searchPeople(person: string): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const type of ['video', 'bitmap'] as const) {
    const u = new URL('https://commons.wikimedia.org/w/api.php');
    for (const [k, v] of Object.entries({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: `"${person.slice(0, 80)}" filetype:${type}`, gsrlimit: '15',
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1920', iiextmetadatafilter: 'License|LicenseShortName|Artist|ObjectName|ImageDescription' })) u.searchParams.set(k, v);
    const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) continue;
    const j = (await r.json()) as { query?: { pages?: Record<string, { title: string; imageinfo?: { url: string; thumburl?: string; descriptionurl: string; width: number; height: number; duration?: number; size: number; mime: string; extmetadata?: Record<string, { value?: string }> }[] }> } };
    for (const p of Object.values(j.query?.pages ?? {})) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const photo = /^image\/(jpeg|png|webp)/.test(ii.mime), video = /^video\//.test(ii.mime);
      if (!(photo || video) || (video && ii.size > MAX_BYTES) || Math.max(ii.width, ii.height) < 800) continue;
      const lic = commonsLicense(ii.extmetadata ?? {});
      if (!lic) continue;
      const meta = ii.extmetadata ?? {};
      if (!namesPerson(`${p.title} ${clip(meta.ObjectName?.value, 300)} ${clip(meta.ImageDescription?.value, 600)}`, person)) continue;
      const artist = clip(meta.Artist?.value, 60) || 'Wikimedia Commons';
      out.push({ source: 'commons', source_id: p.title, page_url: ii.descriptionurl, file_url: photo ? (ii.thumburl ?? ii.url) : ii.url, title: clip(meta.ObjectName?.value || p.title.replace(/^File:/, ''), 140),
        author: artist, tags: [person], width: ii.width, height: ii.height, secs: ii.duration ?? 0, license: lic.license, license_note: lic.note,
        credit: `${photo ? 'Photo' : 'Video'}: ${artist} · ${lic.note}`, kind: photo ? 'photo' : 'video', person });
    }
  }
  // Video first (it moves), then photos.
  return out.sort((a, b) => Number(a.kind === 'photo') - Number(b.kind === 'photo'));
}

const SEARCH: Record<FootageSource, (q: string) => Promise<Candidate[]>> = { pixabay: searchPixabay, nasa: searchNasa, commons: searchCommons };

/** A search through the 24-hour cache (one source, one query, once a day per tenant). */
export async function search(tenant: string, source: FootageSource, query: string): Promise<Candidate[]> {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const { data: hit } = await db().from('unedit_footage_search').select('results, at').eq('tenant_id', tenant).eq('source', source).eq('query', q).maybeSingle();
  if (hit && Date.now() - Date.parse(hit.at) < DAY) return hit.results as Candidate[];
  // "person:<name>" is a people search (Commons only); the name keeps its capitals for the search.
  const results = q.startsWith('person:') ? await searchPeople(query.trim().slice(7).trim()) : await SEARCH[source](q);
  await db().from('unedit_footage_search').upsert({ tenant_id: tenant, source, query: q, results, at: new Date().toISOString() });
  return results;
}

// ---- taking a clip -------------------------------------------------------------------------------------------------

/** Store one candidate (or reuse our copy): the first 12 s, H.264 at most 1920 wide, no sound, in private Blob, with
 *  its source, licence and credit in the ledger. */
export async function acquire(tenant: string, c: Candidate, query: string, spent: { cents: number } = { cents: 0 }, need = 3): Promise<Footage> {
  const want = Math.min(MAX_SECS, need + 0.3);
  const cols = 'id, source, blob_path, title, page_url, license, license_note, credit, secs, width, height, kind, person';
  const { data: have } = await db().from('unedit_footage').select(cols).eq('tenant_id', tenant).eq('source', c.source).eq('source_id', c.source_id).maybeSingle();
  if (have) { if (have.kind === 'photo' || Number(have.secs) >= want) return have as Footage; throw new Error(`stored copy is ${have.secs} s, the line needs ${want.toFixed(1)} s`); }
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-footage-'));
  try {
    if (c.kind === 'photo') return await acquirePhoto(tenant, c, query, spent, d, cols);
    // Read only what is needed straight from the source (ffmpeg range-reads the file): never the whole file in memory
    // or on /tmp (an 8K-era lesson: memory and disk run out long before the step's time does).
    // NASA and Commons videos open (and close) on title slates: logos, names, phone numbers (2026-11-19). Take the
    // middle. Pixabay clips are single shots, taken from the start.
    // The source's own length when it gives one (Commons refuses a probe without our client name).
    const dur = c.secs || (await probe(c.file_url)).duration;
    if (!dur) throw new Error('source unreadable');
    const from = c.source === 'pixabay' || dur < 8 ? 0 : Math.min(dur * 0.33, Math.max(0, dur - MAX_SECS - 2));
    await ffmpeg(['-user_agent', UA, '-ss', from.toFixed(2), '-i', c.file_url, '-t', String(MAX_SECS), '-an', '-vf', "scale='min(1920,iw)':-2,fps=30", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'out.mp4'], d, 300_000);
    const p = await probe(path.join(d, 'out.mp4'));
    // Shorter than its line would drop back to the background mid-sentence.
    if (p.duration < want) throw new Error(`${p.duration.toFixed(1)} s, the line needs ${want.toFixed(1)} s`);
    // Claude looks before anything is stored or used: no logos, slates or captions, no recognisable person, on topic.
    const frames: Buffer[] = [];
    for (const [k, at] of [0.15, 0.5, 0.85].entries()) {
      await ffmpeg(['-ss', (p.duration * at).toFixed(2), '-i', 'out.mp4', '-frames:v', '1', '-vf', 'scale=512:-2', '-q:v', '4', `f${k}.jpg`], d, 60_000);
      frames.push(await fs.readFile(path.join(d, `f${k}.jpg`)));
    }
    const look = await lookCheck(frames, query, c.person);
    spent.cents += look.cents;
    if (!look.ok) throw new Error(`look-check: ${look.why}`);
    const safe = c.source_id.replace(/[^\w.-]+/g, '_').slice(0, 90);
    const blob_path = `studio/footage/${c.source}/${safe}.mp4`;
    await put(blob_path, await fs.readFile(path.join(d, 'out.mp4')), { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true });
    const row = { tenant_id: tenant, source: c.source, source_id: c.source_id, page_url: c.page_url, blob_path, license: c.license, license_note: c.license_note, credit: c.credit, author: c.author,
      title: c.title || c.source_id, tags: c.tags, width: p.width, height: p.height, secs: Math.round(p.duration * 100) / 100, query, kind: 'video', person: c.person ?? null };
    const { data, error } = await db().from('unedit_footage').upsert(row, { onConflict: 'tenant_id,source,source_id' }).select(cols).single();
    if (error || !data) throw new Error(error?.message ?? 'ledger write failed');
    return data as Footage;
  } finally {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
}

/** A licensed photo of a public figure: at most 1920 wide as JPEG, checked, stored, in the ledger. */
async function acquirePhoto(tenant: string, c: Candidate, query: string, spent: { cents: number }, d: string, cols: string): Promise<Footage> {
  await ffmpeg(['-user_agent', UA, '-i', c.file_url, '-frames:v', '1', '-vf', "scale='min(1920,iw)':-2", '-q:v', '3', 'out.jpg'], d, 120_000);
  await ffmpeg(['-i', 'out.jpg', '-vf', 'scale=512:-2', '-q:v', '4', 'f0.jpg'], d, 60_000);
  const look = await lookCheck([await fs.readFile(path.join(d, 'f0.jpg'))], query, c.person);
  spent.cents += look.cents;
  if (!look.ok) throw new Error(`look-check: ${look.why}`);
  const p = await probe(path.join(d, 'out.jpg'));
  const blob_path = `studio/footage/${c.source}/${c.source_id.replace(/[^\w.-]+/g, '_').slice(0, 90)}.jpg`;
  await put(blob_path, await fs.readFile(path.join(d, 'out.jpg')), { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true });
  const row = { tenant_id: tenant, source: c.source, source_id: c.source_id, page_url: c.page_url, blob_path, license: c.license, license_note: c.license_note, credit: c.credit, author: c.author,
    title: c.title || c.source_id, tags: c.tags, width: p.width || c.width, height: p.height || c.height, secs: 0, query, kind: 'photo', person: c.person ?? null };
  const { data, error } = await db().from('unedit_footage').upsert(row, { onConflict: 'tenant_id,source,source_id' }).select(cols).single();
  if (error || !data) throw new Error(error?.message ?? 'ledger write failed');
  return data as unknown as Footage;
}

const PEOPLE_LOOK = `You check a licensed photo or video of a public figure before it appears in a news explainer, with
the person's name on screen. You do NOT identify anyone from their face; the name comes from the source. Reject it if
ANY frame shows: a watermark, title slate, caption or other overlaid text; a readable product or brand logo as the main
subject; a child; anything graphic, private (home, family) or demeaning; no single clear main subject; or it is not a
photo of a person at all. A plain conference backdrop or name badge is fine.
Return only JSON: {"ok":true|false,"why":"<under 12 words>"}.`;

const LOOK_RULES = `You check stock footage before it goes under a news explainer. You see three frames from one clip.
Reject it if ANY frame shows: a logo, brand mark or product branding that can be read; a title slate, caption, lower
third, watermark, phone number or other overlaid text; a person whose face could be recognised (backs of heads, hands
and distant silhouettes are fine); anything graphic or unsafe; or if it is clearly unrelated to the search.
Judge the topic loosely: this is mood B-roll under a sentence, so it only needs to fit the search's subject and feel
(hands typing fits "documents on a desk"; a busy office fits "empty office"). Do not reject for missing details.
Return only JSON: {"ok":true|false,"why":"<under 12 words>"}.`;

/** Claude's look at three frames of a stored clip (cents for the call). Unreadable answers count as a rejection. */
export async function lookCheck(frames: Buffer[], query: string, person?: string): Promise<{ ok: boolean; why: string; cents: number }> {
  const k = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!k) throw new Error('ANTHROPIC_API_KEY is not set on this deployment.');
  const base = (process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com').replace(/\/$/, '');
  const r = await fetch(`${base}/v1/messages`, {
    method: 'POST', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ model: (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5').trim(), max_tokens: 300, system: person ? PEOPLE_LOOK : LOOK_RULES,
      messages: [{ role: 'user', content: [{ type: 'text', text: person ? `Shown as: ${person}` : `Search: "${query}"` }, ...frames.map((b) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } }))] }] }),
  });
  const j = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; error?: { message?: string } };
  if (!r.ok) throw new Error(`look-check: ${j.error?.message || `HTTP ${r.status}`}`);
  const cents = Math.ceil(((j.usage?.input_tokens ?? 0) * 300 + (j.usage?.output_tokens ?? 0) * 1500) / 1_000_000);
  const text = (j.content ?? []).map((b) => b.text ?? '').join('');
  try { const o = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { ok?: unknown; why?: unknown }; return { ok: o.ok === true, why: clip(o.why, 80) || (o.ok === true ? 'ok' : 'rejected'), cents }; }
  catch { return { ok: false, why: 'unreadable check', cents }; }
}

// ---- planning -------------------------------------------------------------------------------------------------------

const PLAN_RULES = `You choose real stock footage for a faceless news explainer, one decision per numbered line.
For each line return either null (a text card says it better: numbers, quotes, verdicts, the call to action, abstract
claims) or {"i":<line #>,"query":"<2-5 word visual search>","source":"pixabay|nasa|commons"}.
Rules:
- Search for what can be FILMED: places, buildings, objects, screens, documents, machines, markets, cities, nature.
- NEVER a person's name, a public figure, a face, or a crowd as the subject. NEVER a company or brand name or logo.
  "Jensen Huang resigned" -> "empty corporate office" ; "Nvidia chips" -> "computer chip macro".
- pixabay: everyday, business, technology, finance, city. nasa: space, rockets, Earth from orbit, labs, aviation.
  commons: public landmarks and buildings (e.g. "US Capitol building", "Wall Street"). Never a name used in the story.
- Footage on at most about half the lines, never on the first line, and never on two lines in a row with the same query.
Return only JSON: {"plan":[...]}.`;

const PEOPLE_RULES = `
PEOPLE (this desk shows public figures): when a line is about a named public figure at the centre of the story (an
executive, official, founder, investor), return {"i":<line #>,"person":"<their full name as in the story>"} instead of
a query: real people make the story. At most 3 person lines per clip, never two in a row for the same person. Never a
private person, a victim, a child, or anyone in a story about a crime, death or tragedy.`;

/** Claude's footage plan for a clip's sentences (cents for the call). Lines it can't use come back null. */
export async function planFootage(lines: { i: number; text: string }[], title: string, people = false): Promise<{ plan: FootagePlan[]; cents: number }> {
  const { text, cents } = await claude(people ? PLAN_RULES + PEOPLE_RULES : PLAN_RULES, `Clip title: ${title}\n\n${lines.map((l) => `[${l.i}] ${l.text}`).join('\n')}`);
  const raw = (() => { try { return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { plan?: unknown[] }; } catch { return { plan: [] }; } })();
  // The story's proper names (people, companies, products): a search may never name one (no likeness, no logo).
  const names = [...new Set(lines.flatMap((l) => l.text.split(/\s+/).slice(1)).map((w) => w.replace(/['’]s$/, '').replace(/[^\p{L}\p{N}-]/gu, '')).filter((w) => w.length >= 3 && /^\p{Lu}/u.test(w)))];
  return { plan: checkPlan(raw.plan ?? [], lines.map((l) => l.i), names, people), cents };
}

/** Code-checked plan: known lines only, a known source, a short query with no person or brand words we can spot
 *  (capitalised names are refused unless the source is commons and the words name a place). */
export function checkPlan(raw: unknown[], ids: number[], names: string[] = [], people = false): FootagePlan[] {
  const out: FootagePlan[] = [];
  let last = '', persons = 0;
  const named = new Set(names.map((n) => n.toLowerCase()));
  for (const x of raw as { i?: unknown; query?: unknown; source?: unknown; person?: unknown }[]) {
    if (!x || typeof x !== 'object') continue;
    const i = Number(x.i);
    if (!ids.includes(i) || i === ids[0]) continue;
    // A person: only on a desk that shows people, only someone the story itself names (every part of the name),
    // at most 3 a clip, never the same person on two lines in a row.
    if (x.person != null) {
      const person = clip(x.person, 60), parts = person.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
      if (!people || parts.length < 2 || !parts.every((w) => named.has(w)) || persons >= 3 || last === `person:${person}`) continue;
      out.push({ i, query: `person:${person}`, source: 'commons', person }); last = `person:${person}`; persons++;
      continue;
    }
    const query = clip(x.query, 60).toLowerCase(), source = String(x.source) as FootageSource;
    if (!query || !(source in SEARCH)) continue;
    if (query.split(' ').length > 6 || query === last) continue;
    const words = new Set(query.split(/[^\p{L}\p{N}]+/u));
    if (names.some((n) => n && words.has(n.toLowerCase()))) continue;
    out.push({ i, query, source }); last = query;
  }
  return out;
}

const STOP = new Set(['with', 'from', 'into', 'over', 'under', 'close', 'shot', 'view', 'footage', 'video', 'aerial', 'macro']);
/** A candidate is on topic only if its title or tags name a content word of the search (2026-11-19: Commons answered
 *  "stock exchange" with fishing nets and a prime minister's speech). Commons also needs a 1280-wide picture. */
export function onTopic(c: Candidate, query: string): boolean {
  if (c.source === 'commons' && c.width < 1280) return false;
  const hay = `${c.title} ${c.tags.join(' ')}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)).some((w) => hay.includes(w.replace(/s$/, '')));
}

/** Pick and store footage for planned lines, inside a time budget (the clip's render shares the step): three lines at
 *  a time, the source asked for then Pixabay, at most four candidates each, every one on topic, long enough for its
 *  line and not already used in this clip. When the budget runs out, the lines without footage stay cards. */
export async function footageFor(tenant: string, plan: FootagePlan[], need: Map<number, number>, budgetMs = 110_000): Promise<{ got: Map<number, Footage>; cents: number; rejected: string[] }> {
  const got = new Map<number, Footage>(), used = new Set<string>(), spent = { cents: 0 }, rejected: string[] = [];
  const until = Date.now() + budgetMs;
  const one = async (p: NonNullable<FootagePlan>) => {
    for (const src of p.person ? ['commons' as const] : [...new Set<FootageSource>([p.source, 'pixabay'])]) {
      const n = need.get(p.i) ?? 3;
      const cands = (await search(tenant, src, p.query).catch(() => [] as Candidate[]))
        .filter((c) => (p.person ? c.person === p.person : onTopic(c, p.query)) && !used.has(c.page_url) && (c.secs === 0 || c.secs >= Math.min(MAX_SECS, n + 0.3)));
      for (const c of cands.slice(0, 4)) {
        if (Date.now() > until) { rejected.push(`line ${p.i}: out of time`); return; }
        used.add(c.page_url);
        try { got.set(p.i, await acquire(tenant, c, p.query, spent, n)); return; }
        catch (e) { const why = e instanceof Error ? e.message : String(e); rejected.push(`${c.source} ${c.title.slice(0, 40)}: ${why}`); console.warn(`[footage] ${c.source} ${c.source_id} skipped: ${why}`); }
      }
    }
  };
  const todo = plan.filter((p): p is NonNullable<FootagePlan> => p != null);
  for (let k = 0; k < todo.length && Date.now() < until; k += 3) await Promise.all(todo.slice(k, k + 3).map(one));
  return { got, cents: spent.cents, rejected };
}
