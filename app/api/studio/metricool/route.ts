// Metricool connection check (staff only): is the account token set and accepted, and which brands and networks
// can Genovus post to. Never returns the token. Open genovus.io/api/studio/metricool while signed in.
// ?schema=1 (read-only) lists the Genovus brand's recent and upcoming posts as their field structure: names, true/
// false settings and post types, never captions or media, so the posting payload matches Metricool exactly.
import { db } from '@/lib/supabase/server';
import { mc, metricoolBrands, metricoolConfigured, METRICOOL_USER_ID, GENOVUS_BLOG_ID } from '@/lib/metricool';

export const dynamic = 'force-dynamic';

/** A post's shape without its content: strings become their length (enums and short codes are kept). */
function shape(v: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (Array.isArray(v)) return v.length ? [shape(v[0], depth + 1), `(${v.length})`] : [];
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shape(x, depth + 1)]));
  if (typeof v === 'string') return /^[A-Z_]{2,24}$|^[a-z_]{2,16}$|^\d{4}-\d{2}-\d{2}T/.test(v) ? v : `string(${v.length})`;
  return v;
}

export async function GET(req: Request) {
  const { data: staff } = await (await db()).rpc('is_staff');
  if (!staff) return Response.json({ ok: false, error: 'Sign in as the Genovus team first.' }, { status: 403 });
  if (!metricoolConfigured()) return Response.json({ ok: false, configured: false, error: 'METRICOOL_GENOVUS_API_KEY is empty on this deployment.' });
  if (new URL(req.url).searchParams.get('schema') === '1') {
    const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 19);
    const r = await mc<unknown>('/v2/scheduler/posts', { query: { start: day(-120), end: day(120), timezone: 'America/New_York' } });
    if (!r.ok) return Response.json({ ok: false, status: r.status, error: r.error });
    const list = (Array.isArray(r.data) ? r.data : ((r.data as { data?: unknown[] })?.data ?? [])) as unknown[];
    return Response.json({ ok: true, posts: list.length, shapes: list.slice(0, 4).map((p) => shape(p)) });
  }
  if (new URL(req.url).searchParams.get('probe') === 'draft') {
    // One-time format check: a DRAFT (never published) on the Genovus brand, read back for its full field
    // structure, then deleted. Shows exactly how Metricool names Reels, YouTube and the AI label.
    const at = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10) + 'T10:00:00';
    const body = { text: 'Genovus API format check (draft). Safe to delete.', publicationDate: { dateTime: at, timezone: 'America/New_York' }, providers: [{ network: 'instagram' }, { network: 'facebook' }, { network: 'youtube' }], draft: true, autoPublish: false, media: [], instagramData: { type: 'REEL' } };
    const made = await mc<Record<string, unknown>>('/v2/scheduler/posts', { method: 'POST', body });
    if (!made.ok) return Response.json({ ok: false, step: 'create draft', status: made.status, error: made.error });
    const post = ((made.data as { data?: Record<string, unknown> })?.data ?? made.data) as Record<string, unknown>;
    const id = String(post.id ?? post.postId ?? '');
    const del = id ? await mc(`/v2/scheduler/posts/${id}`, { method: 'DELETE' }) : null;
    return Response.json({ ok: true, created: shape(post), deleted: del ? (del.ok ? true : `${del.status}: ${del.error}`) : 'no id returned' });
  }
  const r = await metricoolBrands();
  return Response.json(r.ok
    ? { ok: true, configured: true, userId: METRICOOL_USER_ID(), genovusBrand: GENOVUS_BLOG_ID(), brands: r.data }
    : { ok: false, configured: true, userId: METRICOOL_USER_ID(), status: r.status, error: r.error,
        hint: r.status === 401 ? 'Metricool refused the token: copy the "REST API Access token" from Account Settings > API again (API access needs the Advanced plan).' : undefined });
}
