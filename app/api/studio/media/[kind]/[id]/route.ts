// Streams Studio media (character sheets, takes, final cuts) from private Blob storage after the database
// confirms the viewer may see it (row-level security: staff only). Supports Range requests so video can seek.
import { get } from '@vercel/blob';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const NO = (status: number) => new Response(status === 404 ? 'Not found' : 'Sign in required', { status, headers: { 'Cache-Control': 'no-store' } });
const TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

export async function GET(req: Request, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NO(404);
  const supabase = await db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NO(401);
  let path: string | null = null;
  if (kind === 'ref') path = (await supabase.from('studio_refs').select('blob_path').eq('id', id).maybeSingle()).data?.blob_path ?? null;
  else if (kind === 'take') path = (await supabase.from('studio_takes').select('blob_path').eq('id', id).maybeSingle()).data?.blob_path ?? null;
  else if (kind === 'final') path = (await supabase.from('studio_episodes').select('final_blob').eq('id', id).maybeSingle()).data?.final_blob ?? null;
  if (!path) return NO(404);
  const range = req.headers.get('range');
  const res = await get(path, { access: 'private', useCache: false, ...(range ? { headers: { range } } : {}) });
  if (!res || res.statusCode !== 200 || !res.stream) return NO(404);
  const partial = Boolean(range && res.headers.get('content-range')); // the SDK reports a 206 as 200
  const out = new Headers({
    'Content-Type': TYPE[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  for (const h of ['content-length', 'content-range']) { const v = res.headers.get(h); if (v) out.set(h, v); }
  if (new URL(req.url).searchParams.get('download') === '1') out.set('Content-Disposition', `attachment; filename="${kind}-${id.slice(0, 8)}.${path.split('.').pop()}"`);
  return new Response(res.stream, { status: partial ? 206 : 200, headers: out });
}
