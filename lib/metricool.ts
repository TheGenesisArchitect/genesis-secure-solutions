// Metricool: where approved posts go out to the social networks (Facebook, Instagram, TikTok, YouTube, LinkedIn,
// Google Business Profile). Each agency is a Metricool brand (blogId) with its own pages connected; Genovus is a
// brand too. Server only: the account token never reaches a browser. The user and brand ids aren't secret.
// API: https://app.metricool.com/api, header X-Mc-Auth, userId + blogId on every call (Advanced plan).
import 'server-only';

const BASE = 'https://app.metricool.com/api';
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
    const r = await fetch(`${BASE}${path}?${q}`, {
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
      return { ok: false, status: r.status, error: typeof d === 'string' ? d.slice(0, 300) : (d.detail ?? d.message ?? d.title ?? `HTTP ${r.status}`) };
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
