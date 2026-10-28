// Metricool: where approved posts go out to the social networks (Facebook, Instagram, TikTok, YouTube, LinkedIn,
// Google Business Profile). Each agency is a Metricool brand (blogId) with its own pages connected; Genovus is a
// brand too. Server only: the account token never reaches a browser. The user and brand ids aren't secret.
// API: https://app.metricool.com/api, header X-Mc-Auth, userId + blogId on every call (Advanced plan).
import 'server-only';

// METRICOOL_API_BASE points the tests at a stand-in Metricool.
const BASE = () => (process.env.METRICOOL_API_BASE || 'https://app.metricool.com/api').replace(/\/$/, '');
const TOKEN = () => (process.env.METRICOOL_GENOVUS_API_KEY || process.env.METRICOOL_USER_TOKEN || '').trim();
export const METRICOOL_USER_ID = () => (process.env.METRICOOL_USER_ID || '5772039').trim();
/** The Genovus brand (our own channels). Agencies' brands are linked per agency. */
export const GENOVUS_BLOG_ID = () => (process.env.METRICOOL_BLOG_ID || '7426930').trim();
export const metricoolConfigured = () => Boolean(TOKEN());

export type McResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string };

/** One Metricool call with the account token; returns the parsed body or Metricool's own error text. */
export async function mc<T = unknown>(path: string, opts: { blogId?: string; method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<McResult<T>> {
  if (!metricoolConfigured()) return { ok: false, status: 0, error: 'METRICOOL_GENOVUS_API_KEY is not set on this deployment.' };
  const q = new URLSearchParams({ userId: METRICOOL_USER_ID(), blogId: opts.blogId ?? GENOVUS_BLOG_ID(), ...(opts.query ?? {}) });
  try {
    const r = await fetch(`${BASE()}${path}?${q}`, {
      method: opts.method ?? 'GET',
      headers: { 'X-Mc-Auth': TOKEN(), ...(opts.body ? { 'content-type': 'application/json' } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await r.text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch {}
    if (!r.ok) {
      const d = data as { detail?: string; message?: string; title?: string } | string;
      const why = typeof d === 'string' ? d : (d?.detail || d?.message || d?.title);
      return { ok: false, status: r.status, error: (typeof why === 'string' && why ? why : JSON.stringify(why ?? `HTTP ${r.status}`)).slice(0, 300) };
    }
    return { ok: true, status: r.status, data: data as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : 'Metricool did not answer' };
  }
}

const NETWORKS = ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'gmb', 'twitter', 'pinterest', 'threads', 'bluesky'];
export type McBrand = { id: string; label: string; networks: string[] };

/** The brands this account manages, with which networks each has connected. */
export async function metricoolBrands(): Promise<McResult<McBrand[]>> {
  const r = await mc<unknown>('/admin/simpleProfiles');
  if (!r.ok) return r;
  const list = (Array.isArray(r.data) ? r.data : ((r.data as { data?: unknown[] })?.data ?? [])) as Record<string, unknown>[];
  return { ok: true, status: r.status, data: list.map((b) => ({
    id: String(b.id ?? b.blogId ?? ''),
    label: String(b.label ?? b.title ?? b.name ?? ''),
    networks: NETWORKS.filter((n) => Object.keys(b).some((k) => k.toLowerCase().startsWith(n) && b[k] != null && b[k] !== '' && b[k] !== false)),
  })) };
}

/** Draft until the team has checked a first post in Metricool, then METRICOOL_MODE=publish posts at the set time. */
export const metricoolLive = () => (process.env.METRICOOL_MODE ?? '').trim() === 'publish';

/** format: 'post' (feed image), 'story' (no caption on the network) or 'reel' (video). Left out, it stays what the
 *  Studio sends: an Instagram Reel, and a Facebook Reel when vertical, else a post. */
export type McFormat = 'post' | 'story' | 'reel';
export type McPostIn = { blogId: string; network: 'instagram' | 'facebook'; text: string; mediaUrl: string; when: Date; vertical: boolean; aiGenerated: boolean; format?: McFormat };
const TYPE: Record<McFormat, string> = { post: 'POST', story: 'STORY', reel: 'REEL' };
const NY = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d).replace(' ', 'T');

/** Schedule one post on one network (the format read back from Metricool itself: instagramData.isAiGenerated etc.). */
export async function schedulePost(p: McPostIn): Promise<McResult<{ id: number; status: string }>> {
  const live = metricoolLive();
  const format: McFormat = p.format ?? (p.network === 'instagram' || p.vertical ? 'reel' : 'post');
  const body = {
    // A story has no caption of its own; sending one alone is refused.
    ...(format === 'story' ? {} : { text: p.text }),
    publicationDate: { dateTime: NY(p.when), timezone: 'America/New_York' },
    providers: [{ network: p.network }],
    autoPublish: live, draft: !live,
    media: [p.mediaUrl], saveExternalMediaFiles: true, shortener: false,
    ...(p.network === 'instagram' ? { instagramData: { type: TYPE[format], autoPublish: live, ...(format === 'reel' ? { showReelOnFeed: true } : {}), isAiGenerated: p.aiGenerated } } : {}),
    ...(p.network === 'facebook' ? { facebookData: { type: TYPE[format] } } : {}),
  };
  const r = await mc<Record<string, unknown>>('/v2/scheduler/posts', { blogId: p.blogId, method: 'POST', body });
  if (!r.ok) return r;
  const post = ((r.data as { data?: Record<string, unknown> })?.data ?? r.data) as Record<string, unknown>;
  const id = Number(post.id);
  if (!Number.isFinite(id)) return { ok: false, status: r.status, error: 'Metricool did not return a post id.' };
  return { ok: true, status: r.status, data: { id, status: live ? 'SCHEDULED' : 'DRAFT' } };
}

/** Where a post stands on its network: PENDING, PUBLISHED (with the live link when Metricool reports one) or ERROR. */
export async function postStatus(blogId: string, id: number): Promise<McResult<{ status: string; url: string | null; detail: string | null }>> {
  const r = await mc<Record<string, unknown>>(`/v2/scheduler/posts/${id}`, { blogId });
  if (!r.ok) return r;
  const post = ((r.data as { data?: Record<string, unknown> })?.data ?? r.data) as Record<string, unknown>;
  const pr = ((post.providers as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
  const url = Object.entries(pr).find(([k, v]) => /url|link/i.test(k) && typeof v === 'string' && /^https:\/\//.test(v))?.[1] as string | undefined;
  return { ok: true, status: r.status, data: { status: String(pr.status ?? 'PENDING'), url: url ?? null, detail: (pr.detailedStatus as string | undefined) ?? null } };
}
