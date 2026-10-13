// Streams a Screen Library clip (default) or still (?still=1) from private storage, staff only (row-level security on
// studio_screens). Supports Range requests so clips can seek.
import { get } from '@vercel/blob';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
const NO = (status: number) => new Response(status === 404 ? 'Not found' : 'Sign in required', { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request, ctx: { params: Promise<{ code: string; device: string }> }) {
  const { code, device } = await ctx.params;
  if (!/^[a-z0-9-]{2,60}$/.test(code) || !['desktop', 'phone'].includes(device)) return NO(404);
  const supabase = await db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NO(401);
  const still = new URL(req.url).searchParams.get('still') === '1';
  const { data: row } = await supabase.from('studio_screens').select('clip_path, still_path').eq('code', code).eq('device', device).maybeSingle();
  const path = still ? row?.still_path : row?.clip_path;
  if (!path) return NO(404);
  const range = req.headers.get('range');
  const res = await get(path, { access: 'private', useCache: false, ...(range && !still ? { headers: { range } } : {}) });
  if (!res || res.statusCode !== 200 || !res.stream) return NO(404);
  const partial = Boolean(range && res.headers.get('content-range'));
  const out = new Headers({ 'Content-Type': still ? 'image/jpeg' : 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex, nofollow' });
  for (const h of ['content-length', 'content-range']) { const v = res.headers.get(h); if (v) out.set(h, v); }
  return new Response(res.stream, { status: partial ? 206 : 200, headers: out });
}
