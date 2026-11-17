// A clip (or the full video) from an UnEdit campaign waiting in an agency owner's Approvals, so he watches exactly what
// will post before he decides. Who may watch is decided by row-level security on approvals (the agency's own members,
// or staff): the approval is read with the viewer's own session, then the clip is handed over as a short-lived link.
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { presigned } from '@/lib/unedit-media';

export const dynamic = 'force-dynamic';
const NO = (status: number) => new Response(status === 404 ? 'Not found' : 'Sign in required', { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NO(404);
  const supabase = await db();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NO(401);
  const { data: a } = await supabase.from('approvals').select('tenant_id, unedit_vlog_id').eq('id', id).maybeSingle();
  if (!a?.unedit_vlog_id) return NO(404);
  const n = new URL(req.url).searchParams.get('n');
  let path: string | null = null;
  if (n && /^\d{1,2}$/.test(n)) {
    const { data: c } = await adminDb().from('unedit_clips').select('blob_path').eq('vlog_id', a.unedit_vlog_id).eq('tenant_id', a.tenant_id).eq('n', Number(n)).maybeSingle();
    path = (c?.blob_path as string | null) ?? null;
  } else {
    const { data: v } = await adminDb().from('unedit_vlogs').select('episode_path, blob_path').eq('id', a.unedit_vlog_id).eq('tenant_id', a.tenant_id).maybeSingle();
    path = (v?.episode_path as string | null) ?? (v?.blob_path as string | null) ?? null;
  }
  if (!path) return NO(404);
  return Response.redirect(await presigned(path, 60), 302);
}
