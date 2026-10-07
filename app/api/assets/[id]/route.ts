// Streams a private asset from Blob after the database confirms the signed-in viewer may see it
// (row-level security on `assets` decides: staff, or a member of the owning agency for non-internal assets).
import { get } from '@vercel/blob';
import { db } from '@/lib/supabase/server';
import { supabaseConfigured } from '@/lib/supabase/env';

const NO = (status: number) => new Response(status === 404 ? 'Not found' : 'Sign in required', { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!supabaseConfigured() || !/^[0-9a-f-]{36}$/.test(id)) return NO(404);
  const supabase = await db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NO(401);
  const { data: a } = await supabase.from('assets').select('location_kind, location, title').eq('id', id).maybeSingle();
  if (!a || a.location_kind !== 'blob') return NO(404);
  const res = await get(a.location, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return NO(404);
  const ext = a.location.split('.').pop()?.toLowerCase();
  const type = ext === 'pdf' ? 'application/pdf' : ext === 'mp4' ? 'video/mp4' : ext === 'png' ? 'image/png' : ext === 'jpg' ? 'image/jpeg' : 'application/octet-stream';
  return new Response(res.stream, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `inline; filename="${a.title.replace(/[^\w .-]+/g, '')}.${ext}"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
