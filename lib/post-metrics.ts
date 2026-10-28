// Each live post's engagement, server only: likes, comments, shares, saves, reach and views from the agency's own
// Metricool brand, read every few hours for its first 30 days. Metricool names its post analytics differently per
// network and API version, so each read tries a short list of endpoints and keeps the first that answers; what
// answered is recorded (visibility_pulls, source metricool-posts). A post not found yet keeps metrics null, shown as
// "not yet", never as zero. Facebook stories report nothing worth showing; they are left out.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';
import { mc, metricoolConfigured } from '@/lib/metricool';

export type PostMetrics = { likes?: number; comments?: number; shares?: number; saves?: number; reach?: number; views?: number; clicks?: number; interactions?: number };
type Item = { id: string; tenant_id: string; channel: string; format: string; post_url: string | null; network_post_id: string | null; published_at: string };

const EVERY_MS = 3 * 3_600_000, WINDOW_MS = 30 * 86_400_000, SETTLE_MS = 30 * 60_000, DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
const iso = (d: Date) => d.toISOString().slice(0, 19);

type Ep = { path: string; query: (from: Date, to: Date) => Record<string, string> };
const v2 = (path: string): Ep => ({ path, query: (f, t) => ({ from: iso(f), to: iso(t), timezone: 'America/New_York' }) });
const v1 = (path: string): Ep => ({ path, query: (f, t) => ({ start: ymd(f), end: ymd(t) }) });
export const ENDPOINTS: Record<string, Ep[]> = {
  'instagram.post': [v2('/v2/analytics/posts/instagram'), v1('/stats/instagram/posts')],
  'facebook.post': [v2('/v2/analytics/posts/facebook'), v1('/stats/facebook/posts')],
  'instagram.story': [v2('/v2/analytics/stories/instagram'), v1('/stats/instagram/stories')],
};

// The numbers, under the names Metricool uses for each network (first one present wins).
const NAMES: Record<keyof PostMetrics, string[]> = {
  likes: ['likes', 'reactions', 'likeReactions'], comments: ['comments'], shares: ['shares'], saves: ['saved', 'saves'],
  reach: ['reach', 'impressionsUnique'], views: ['views', 'impressions'], clicks: ['clicks', 'linkclicks'], interactions: ['interactions', 'interactionsTotal'],
};
export function metricsOf(row: Record<string, unknown>): PostMetrics {
  const out: PostMetrics = {};
  for (const [k, names] of Object.entries(NAMES) as [keyof PostMetrics, string[]][]) {
    for (const n of names) { const v = Number(row[n]); if (row[n] != null && row[n] !== '' && Number.isFinite(v)) { out[k] = v; break; } }
  }
  if (out.interactions == null && [out.likes, out.comments, out.shares, out.saves].some((v) => v != null)) out.interactions = (out.likes ?? 0) + (out.comments ?? 0) + (out.shares ?? 0) + (out.saves ?? 0);
  return out;
}

/** What identifies a post on its network: its own id, the Instagram shortcode, the trailing Facebook post id. */
export function tokensOf(i: Pick<Item, 'post_url' | 'network_post_id'>): string[] {
  const t = new Set<string>();
  if (i.network_post_id) t.add(i.network_post_id);
  const u = i.post_url ?? '';
  const code = u.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1];
  if (code) t.add(code);
  const fb = u.match(/facebook\.com\/(?:[^/]+\/)?(?:posts|videos|photos)\/(?:[^/]+\/)?(\d{6,})/)?.[1] ?? u.match(/[?&]story_fbid=(\d+)/)?.[1];
  if (fb) t.add(fb);
  return [...t].filter((x) => x.length >= 5);
}
const ID_FIELDS = ['postId', 'id', 'url', 'link', 'permalink', 'storyId', 'reelId', 'businessId', 'mediaId'];
export const matches = (row: Record<string, unknown>, tokens: string[]) => {
  const hay = ID_FIELDS.map((k) => (row[k] == null ? '' : String(row[k]))).join(' ');
  return tokens.some((t) => hay.includes(t));
};

/** Read engagement for live posts that are due (published 30+ minutes ago, within 30 days, not read in 3 hours). */
export async function pullPostMetrics(now = Date.now()): Promise<{ checked: number; updated: number; tried: Record<string, string> }> {
  const out = { checked: 0, updated: 0, tried: {} as Record<string, string> };
  if (!metricoolConfigured()) return out;
  const db = adminDb();
  const { data } = await db.from('content_items').select('id, tenant_id, channel, format, post_url, network_post_id, published_at, metrics_at')
    .eq('status', 'published').eq('is_sample', false).gte('published_at', new Date(now - WINDOW_MS).toISOString()).lte('published_at', new Date(now - SETTLE_MS).toISOString())
    .or(`metrics_at.is.null,metrics_at.lt.${new Date(now - EVERY_MS).toISOString()}`).limit(60);
  const items = ((data ?? []) as Item[]).filter((i) => ENDPOINTS[`${i.channel}.${i.format}`]);
  if (!items.length) return out;
  const { data: ts } = await db.from('tenants').select('id, metricool_blog_id').in('id', [...new Set(items.map((i) => i.tenant_id))]);
  const brand = new Map((ts ?? []).map((t) => [t.id as string, t.metricool_blog_id as string | null]));
  const groups = new Map<string, Item[]>();
  for (const i of items) { const k = `${i.tenant_id}|${i.channel}.${i.format}`; groups.set(k, [...(groups.get(k) ?? []), i]); }
  const log = new Map<string, { kept: Record<string, string>; errors: string[]; rows: number }>();
  for (const [k, list] of groups) {
    const [tenantId, kind] = k.split('|');
    const blogId = brand.get(tenantId);
    if (!blogId) continue;
    const from = new Date(Math.min(...list.map((i) => Date.parse(i.published_at))) - DAY), to = new Date(now + DAY);
    const l = log.get(tenantId) ?? { kept: {}, errors: [], rows: 0 };
    // Each endpoint in turn until every post is found: one that answers with nothing for these posts doesn't stop
    // the next from being asked.
    const rows: Record<string, unknown>[] = [];
    const found = (i: Item) => { const tk = tokensOf(i); return tk.length > 0 && rows.some((row) => matches(row, tk)); };
    for (const ep of ENDPOINTS[kind]) {
      if (list.every(found)) break;
      const r = await mc<unknown>(ep.path, { blogId, query: ep.query(from, to) });
      if (!r.ok) { if (r.status !== 404) l.errors.push(`${kind} ${ep.path}: ${r.error}`.slice(0, 200)); continue; }
      const got = (Array.isArray(r.data) ? r.data : ((r.data as { data?: unknown })?.data ?? [])) as unknown;
      if (!Array.isArray(got)) continue;
      rows.push(...(got as Record<string, unknown>[]));
      l.rows += got.length;
      if (got.length || !l.kept[kind]) { l.kept[kind] = ep.path; out.tried[kind] = ep.path; }
    }
    log.set(tenantId, l);
    for (const i of list) {
      out.checked++;
      const tokens = tokensOf(i);
      const hit = tokens.length ? rows.find((row) => matches(row, tokens)) : undefined;
      const m = hit ? metricsOf(hit) : null;
      const found = m && Object.keys(m).length ? m : null;
      await db.from('content_items').update({ metrics_at: new Date(now).toISOString(), ...(found ? { metrics: found } : {}) }).eq('id', i.id);
      if (found) out.updated++;
    }
  }
  for (const [tenantId, l] of log) {
    await db.from('visibility_pulls').upsert({ tenant_id: tenantId, source: 'metricool-posts', pulled_at: new Date(now).toISOString(), ok: l.rows > 0, detail: { kept: l.kept, errors: l.errors.slice(0, 6), rows: l.rows } }, { onConflict: 'tenant_id,source' });
  }
  return out;
}

/** The total engagement on a set of posts (only the ones with numbers). */
export function sumMetrics(list: { metrics: PostMetrics | null }[]) {
  const withNumbers = list.filter((p) => p.metrics);
  const t = (k: keyof PostMetrics) => withNumbers.reduce((s, p) => s + (p.metrics?.[k] ?? 0), 0);
  return { posts: withNumbers.length, reach: t('reach'), interactions: t('interactions'), likes: t('likes'), comments: t('comments'), shares: t('shares'), saves: t('saves') };
}
