// A signed media link (lib/media-link.ts): streams one final cut or render, or one Library image (an approved ad),
// from private storage when the signature and expiry check out, so Metricool can fetch what it is publishing. No sign-in; nothing without a valid sig.
import { get } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { verifyMediaSig } from '@/lib/media-link';

export const dynamic = 'force-dynamic';

const NO = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request, ctx: { params: Promise<{ kind: string; file: string }> }) {
  const { kind, file } = await ctx.params;
  const id = file.replace(/\.(mp4|jpg)$/, '');
  if (!['final', 'render', 'asset'].includes(kind) || !/^[0-9a-f-]{36}$/.test(id)) return NO();
  const q = new URL(req.url).searchParams;
  if (!verifyMediaSig(kind, id, q.get('exp'), q.get('sig'))) return NO();
  if (kind === 'asset') return image(id);
  const db = adminDb();
  const path = kind === 'final'
    ? (await db.from('studio_episodes').select('final_blob').eq('id', id).maybeSingle()).data?.final_blob
    : (await db.from('studio_renders').select('blob_path').eq('id', id).maybeSingle()).data?.blob_path;
  if (!path) return NO();
  const range = req.headers.get('range');
  const res = await get(path, { access: 'private', useCache: false, ...(range ? { headers: { range } } : {}) });
  if (!res || res.statusCode !== 200 || !res.stream) return NO();
  const out = new Headers({ 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  for (const h of ['content-length', 'content-range']) { const v = res.headers.get(h); if (v) out.set(h, v); }
  return new Response(res.stream, { status: range && res.headers.get('content-range') ? 206 : 200, headers: out });
}

/** A Library image: only an image stored privately in an agency's Library and shown to the agency (never internal). */
async function image(id: string) {
  const { data: a } = await adminDb().from('assets').select('location, location_kind, kind, audience').eq('id', id).maybeSingle();
  if (!a || a.location_kind !== 'blob' || a.kind !== 'image' || a.audience === 'internal') return NO();
  const res = await get(a.location, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200 || !res.stream) return NO();
  const type = res.headers.get('content-type') ?? 'image/jpeg';
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return NO();
  const out = new Headers({ 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' });
  const len = res.headers.get('content-length');
  if (len) out.set('content-length', len);
  return new Response(res.stream, { status: 200, headers: out });
}
