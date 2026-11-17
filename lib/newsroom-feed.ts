// The free wire: the newsroom's morning feed from public sources, no paid search. Publisher RSS feeds, Google News
// topic searches, the Hacker News API, the Federal Reserve and the SEC are read for each beat; items from the last 48
// hours are clustered (the same story across outlets is one story, and wider coverage means hotter), scored by
// coverage, freshness and how well they match the beat, and the best go on the desk as stories. Facts are verified
// only when the operator picks a story (Research deeper, the paid step). We identify honestly and skip any source that
// refuses automated readers.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { linkPreview, settings, type Beat } from '@/lib/newsroom';

const UA = 'GenovusNewsroom/1.0 (+https://genovus.io)';
const gnews = (q: string, days = 2) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${days}d`)}&hl=en-US&gl=US&ceid=US:en`;
/** Bing News search as RSS: the real article link (in its url= parameter) and usually the story's picture, newest
 *  first from the past week. Google News links are redirects we can't open, so its items add coverage, not pictures. */
const bnews = (q: string) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=en-US&cc=US&qft=interval%3d%228%22%2bsortbydate%3d%221%22`;
/** How far back a beat looks: news beats two days; niche beats, where news is weekly, seven. */
const WINDOW_DAYS: Record<string, number> = { ai: 2, fintech: 2, markets: 2, saas: 4, faas: 7, blacktech: 7 };

/** Each beat's free sources: publisher feeds plus topic searches (Google News aggregates thousands of outlets). */
export const FEEDS: Record<string, { name: string; url: string }[]> = {
  ai: [
    { name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
    { name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
    { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/feed/' },
    { name: 'Hacker News', url: 'hn:front' },
    { name: 'Google News', url: gnews('AI model OR "AI agent" OR "coding agent" launch') },
    { name: 'Bing News', url: bnews('AI model OR "AI agent" OR "coding agent" launch') },
  ],
  saas: [
    { name: 'TechCrunch Startups', url: 'https://techcrunch.com/category/startups/feed/' },
    { name: 'SaaStr', url: 'https://www.saastr.com/feed/' },
    { name: 'Google News', url: gnews('SaaS pricing OR acquisition OR launch OR outage', 4) },
    { name: 'Bing News', url: bnews('SaaS pricing OR acquisition OR launch OR outage') },
  ],
  fintech: [
    { name: 'TechCrunch Fintech', url: 'https://techcrunch.com/category/fintech/feed/' },
    { name: 'PYMNTS', url: 'https://www.pymnts.com/feed/' },
    { name: 'Google News', url: gnews('"embedded finance" OR "banking-as-a-service" OR fintech regulation') },
    { name: 'Bing News', url: bnews('"embedded finance" OR "banking-as-a-service" OR fintech regulation') },
  ],
  faas: [
    { name: 'AWS Compute Blog', url: 'https://aws.amazon.com/blogs/compute/feed/' },
    { name: 'Google News', url: gnews('serverless OR "edge functions" OR "AWS Lambda" OR "Cloud Run" OR "Cloudflare Workers"', 7) },
    { name: 'Bing News', url: bnews('serverless OR "edge functions" OR "AWS Lambda" OR "Cloud Run" OR "Cloudflare Workers"') },
  ],
  blacktech: [
    { name: 'Black Enterprise', url: 'https://www.blackenterprise.com/feed/' },
    // Simple queries return far more than quoted OR-chains (tested 2026-11-16: 32/32/21/11 items in a week).
    { name: 'Google News', url: gnews('Black tech founders funding', 7) },
    { name: 'Bing News', url: bnews('Black tech founders funding') },
    { name: 'Google News', url: gnews('Black women founders', 7) },
    { name: 'Bing News', url: bnews('Black women founders') },
    { name: 'Google News', url: gnews('HBCU tech', 7) },
    { name: 'Bing News', url: bnews('HBCU tech') },
    { name: 'Google News', url: gnews('Black entrepreneurs venture capital', 7) },
    { name: 'Bing News', url: bnews('Black entrepreneurs venture capital') },
  ],
  markets: [
    { name: 'Federal Reserve', url: 'https://www.federalreserve.gov/feeds/press_all.xml' },
    { name: 'SEC', url: 'https://www.sec.gov/news/pressreleases.rss' },
    { name: 'Google News', url: gnews('stock market today OR Nasdaq OR "S&P 500" OR earnings') },
    { name: 'Bing News', url: bnews('stock market today OR Nasdaq OR "S&P 500" OR earnings') },
  ],
};

const isGoogle = (u: string) => /news\.google\.com/i.test(u);
type Item = { title: string; link: string; source: string; at: number; summary: string; image?: string };

/** What a story must be about to belong on its beat (title or summary). */
const MUST: Record<string, RegExp> = {
  ai: /\b(ai|a\.i\.|model|models|agent|agents|llm|gpt|claude|gemini|openai|anthropic|deepseek|qwen|llama|mistral|nvidia|machine learning|neural|copilot|inference)\b/i,
  saas: /\b(saas|software|subscription|pricing|platform|cloud|acquires|acquisition|startup|enterprise|crm|workspace)\b/i,
  fintech: /\b(fintech|bank|banking|payments?|lending|lender|embedded finance|card|wallet|stablecoin|plaid|stripe|neobank|regulator|cfpb|occ)\b/i,
  faas: /\b(serverless|lambda|cloud run|edge functions?|workers|functions|fargate|vercel|netlify|cloudflare)\b/i,
  blacktech: /\b(tech|technology|startup|startups|founder|founders|funding|raises|raised|seed|series [a-d]|venture|vc|fund|accelerator|cohort|ai|software|app|fintech|investors?|capital)\b/i,
  markets: /\b(stocks?|market|nasdaq|s&p|dow|fed|federal reserve|rates?|earnings|ipo|treasur(y|ies)|inflation|sec|futures|bond|yields?)\b/i,
};
/** Black Tech stories must be about Black founders, companies or communities, not founders in general. */
const BLACK = /\bblack[- ](founders?|entrepreneurs?|women|men|owned|led|tech|technologists?|investors?|vcs?|venture|business(es)?|community|communities|professionals|engineers|developers|creators|innovators?|startups?|ceos?)\b|\bhbcus?\b|\bafrican[- ]american (founders?|entrepreneurs?|business|tech)|\bafrotech\b/i;
/** Press-release wires, content farms and listicles never make the wire. */
const JUNK_SOURCE = /britannica|wikipedia|openpr|ein ?presswire|prweb|prnewswire|newswire|online tech tips|inventiva|shattered\.io|journalarta|accesswire/i;
const JUNK_TITLE = /^(top|best)\s+\d+|\btop\s+\d+\s+(best|ways|tools|platforms|agencies)|\bbest\b.*\b(20\d\d|compared)|compared with pricing|\bvs\.?\b.*\bcosts?\b|^how to\b|\bsponsored\b/i;
const strip = (s: string): string => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8217;/g, '’').replace(/&#82(16|20|21);/g, '"')
  // Google News sends its summary as escaped HTML: the tags only appear once decoded, so they're taken out again.
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
/** The picture a feed item carries: Bing's News:Image, media:content / media:thumbnail, an image enclosure, or the
 *  first <img> in its description. https only (the newsroom page is https). */
function itemImage(b: string): string | undefined {
  const dec = (u?: string) => u?.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim();
  const bing = dec(b.match(/<News:Image>([^<]+)<\/News:Image>/i)?.[1]);
  const cands = [
    bing ? `${bing}&w=640&h=360&c=14` : undefined,
    dec(b.match(/<media:content[^>]+url=["']([^"']+)["'][^>]*>/i)?.[1]),
    dec(b.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)?.[1]),
    dec(b.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*type=["']image/i)?.[1]),
    dec(b.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1]) ?? dec(b.match(/&lt;img[^&]+src=(?:&quot;|["'])([^"&]+)/i)?.[1]),
  ];
  for (const c of cands) {
    if (!c || /\.svg(\?|$)|pixel|1x1|logo|icon|avatar/i.test(c)) continue;
    const u = c.replace(/^http:\/\//, 'https://');
    if (/^https:\/\//.test(u)) return u.slice(0, 1000);
  }
  return undefined;
}
const tag = (x: string, t: string) => x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, 'i'))?.[1] ?? '';

/** One feed's items (RSS or Atom; Hacker News through its free API). */
async function read(feed: { name: string; url: string }): Promise<Item[]> {
  try {
    if (feed.url === 'hn:front') {
      const r = await fetch('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
      const j = (await r.json()) as { hits?: { title?: string; url?: string; created_at_i?: number; points?: number }[] };
      return (j.hits ?? []).filter((h) => h.url && h.title && (h.points ?? 0) >= 100).map((h) => ({ title: h.title!, link: h.url!, source: (() => { try { return new URL(h.url!).hostname.replace(/^www\./, ''); } catch { return 'Hacker News'; } })(), at: (h.created_at_i ?? 0) * 1000, summary: '' }));
    }
    const r = await fetch(feed.url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
    if (!r.ok) return [];
    const x = await r.text();
    const blocks = x.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? x.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
    return blocks.map((b) => {
      let link = strip(tag(b, 'link')) || b.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '';
      // Bing wraps the article in a click link: the article is its url= parameter.
      if (/bing\.com\/news\/apiclick/i.test(link)) { try { link = new URL(link).searchParams.get('url') ?? link; } catch { /* keep */ } }
      const when = strip(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
      // Google News puts the outlet in <source> and appends " - Outlet" to the title.
      const src = strip(tag(b, 'source')) || feed.name;
      const title = strip(tag(b, 'title')).replace(new RegExp(`\\s+-\\s+${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
      return { title, link, source: strip(tag(b, 'News:Source')) || src, at: Date.parse(when) || 0, summary: strip(tag(b, 'description') || tag(b, 'summary')).slice(0, 400), image: itemImage(b) };
    }).filter((i) => i.title && /^https?:\/\//.test(i.link));
  } catch { return []; }
}

const STOP = new Set('a an the and or of to in on for with by at from is are was be as its it this that new how why what after over into says will can has have more than us your you'.split(' '));
const words = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9$% ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const similar = (a: Set<string>, b: Set<string>) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.max(1, Math.min(a.size, b.size)); };

/** A beat's clusters from today's feeds, hottest first. */
export async function beatClusters(beat: Beat): Promise<{ title: string; link: string; source: string; at: number; summary: string; outlets: string[]; heat: number; image?: string }[]> {
  const feeds = FEEDS[beat.id] ?? [{ name: 'Google News', url: gnews(beat.label) }];
  const all = (await Promise.all(feeds.map(read))).flat();
  const since = Date.now() - (WINDOW_DAYS[beat.id] ?? 2) * 86_400_000;
  const must = MUST[beat.id];
  const fresh = all.filter((i) => (!i.at || i.at >= since) && !JUNK_SOURCE.test(i.source) && !JUNK_SOURCE.test(i.link) && !JUNK_TITLE.test(i.title) && (!must || must.test(beat.id === 'blacktech' ? i.title : `${i.title} ${i.summary}`)) && (beat.id !== 'blacktech' || BLACK.test(`${i.title} ${i.summary}`)));
  const topic = words(`${beat.label} ${beat.brief} ${(beat.subs ?? []).join(' ')}`);
  const clusters: { items: Item[]; w: Set<string> }[] = [];
  for (const it of fresh) {
    const w = words(it.title);
    const c = clusters.find((k) => similar(k.w, w) >= 0.5);
    if (c) { c.items.push(it); for (const x of w) c.w.add(x); } else clusters.push({ items: [it], w });
  }
  return clusters.map((c) => {
    const outlets = [...new Set(c.items.map((i) => i.source))];
    const newest = Math.max(...c.items.map((i) => i.at || 0));
    const hours = newest ? (Date.now() - newest) / 3600_000 : 24;
    // The lead: a real article link with a picture, else any real link, else the first item.
    const lead = c.items.find((i) => !isGoogle(i.link) && i.image) ?? c.items.find((i) => !isGoogle(i.link)) ?? c.items[0];
    const match = [...c.w].filter((x) => topic.has(x)).length;
    // A story reachable only through a Google News redirect can't show its picture or be verified from its page: it
    // needs more coverage to make the desk.
    const real = c.items.some((i) => !isGoogle(i.link));
    const heat = Math.min(100, Math.round(outlets.length * 18 + Math.max(0, 30 - hours) + match * 6 - (real ? 0 : 12)));
    const image = lead.image ?? c.items.find((i) => i.image)?.image;
    return { title: lead.title, link: lead.link, source: lead.source, at: newest, summary: lead.summary, outlets, heat, image };
  }).sort((a, b) => b.heat - a.heat);
}

/** A story below this heat (one outlet, old, off-topic) never makes the wire. */
const MIN_HEAT = 25;

/** The free morning sweep for every beat: the hottest new clusters go on the desk (up to `per` a beat). */
export async function sweepFree(tenant: string, per = 5): Promise<{ beats: number; added: number; byBeat: Record<string, number> }> {
  const s = await settings(tenant);
  const db = adminDb();
  const { data: have } = await db.from('newsroom_stories').select('url, headline').eq('tenant_id', tenant).order('created_at', { ascending: false }).limit(300);
  const known = (have ?? []).map((h) => ({ url: String(h.url), w: words(String(h.headline)) }));
  const byBeat: Record<string, number> = {};
  let added = 0;
  // At most `per` stories a beat a day on the desk (set-aside ones free their place), however often the wire is
  // refreshed, and only stories with some heat.
  const dayStart = new Date(Date.now() - 20 * 3600_000).toISOString();
  const { data: today } = await db.from('newsroom_stories').select('beat').eq('tenant_id', tenant).neq('status', 'dismissed').gte('created_at', dayStart);
  for (const beat of s.beats) {
    const clusters = await beatClusters(beat);
    const room = per - (today ?? []).filter((t) => t.beat === beat.id).length;
    let n = 0;
    for (const c of clusters) {
      if (n >= room || c.heat < MIN_HEAT) break;
      const w = words(c.title);
      if (known.some((k) => k.url === c.link || similar(k.w, w) >= 0.6)) continue;
      const why = `${c.outlets.length > 1 ? `Covered by ${c.outlets.length} outlets (${c.outlets.slice(0, 4).join(', ')})` : `From ${c.source}`}${c.summary ? `: ${c.summary.slice(0, 220)}` : ''}`;
      const ins = await db.from('newsroom_stories').insert({
        tenant_id: tenant, beat: beat.id, sub: null, headline: c.title.slice(0, 140), source: c.source.slice(0, 80), url: c.link.slice(0, 1000),
        published_on: c.at ? new Date(c.at).toISOString().slice(0, 10) : null, thumb_url: c.image ?? null, why: why.slice(0, 500), fit: c.heat, angles: [], build: [], status: 'new',
      }).select('id').single();
      if (ins.error) continue;
      known.push({ url: c.link, w });
      n++; added++;
    }
    byBeat[beat.id] = n;
  }
  await fillThumbs(tenant).catch((e) => console.error('[newsroom] thumbnails:', e instanceof Error ? e.message : e));
  return { beats: s.beats.length, added, byBeat };
}

/** The same story found on Bing News by its headline: the real article link and its picture. */
async function findOnBing(headline: string): Promise<Item | null> {
  const items = await read({ name: 'Bing News', url: `https://www.bing.com/news/search?q=${encodeURIComponent(headline.slice(0, 120))}&format=rss&setlang=en-US&cc=US` });
  const w = words(headline);
  return items.find((i) => !isGoogle(i.link) && similar(words(i.title), w) >= 0.6) ?? null;
}

/** Pictures for the desk's stories that have none: the publisher's own link preview, or for a Google News redirect,
 *  the same story found on Bing (its real link replaces the redirect). A story still without one keeps the
 *  designed tile and is tried again on the next sweep (4 days). */
export async function fillThumbs(tenant: string, limit = 60): Promise<{ tried: number; found: number }> {
  const db = adminDb();
  const since = new Date(Date.now() - 4 * 86_400_000).toISOString();
  const { data } = await db.from('newsroom_stories').select('id, url, headline').eq('tenant_id', tenant).is('thumb_url', null).neq('status', 'dismissed').gte('created_at', since).order('created_at', { ascending: false }).limit(limit);
  const rows = data ?? [];
  let found = 0;
  for (let i = 0; i < rows.length; i += 8) {
    await Promise.all(rows.slice(i, i + 8).map(async (r) => {
      let url = String(r.url), thumb: string | null = null;
      if (isGoogle(url)) {
        const hit = await findOnBing(String(r.headline)).catch(() => null);
        if (hit) { url = hit.link; thumb = hit.image ?? null; }
      }
      if (!thumb && !isGoogle(url)) thumb = await linkPreview(url).catch(() => null);
      if (thumb) found++;
      if (thumb || url !== r.url) await db.from('newsroom_stories').update({ ...(thumb ? { thumb_url: thumb } : {}), ...(url !== r.url ? { url: url.slice(0, 1000) } : {}) }).eq('id', r.id);
    }));
  }
  return { tried: rows.length, found };
}
