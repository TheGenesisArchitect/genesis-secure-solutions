// The shot page polls a running take; when Google finishes, the video is copied into private storage.
import { db } from '@/lib/supabase/server';
import { pollTake } from '@/lib/studio-gen';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ status: 'missing' }, { status: 400 });
  const supabase = await db();
  const { data: t } = await supabase.from('studio_takes').select('id, status, error').eq('id', id).maybeSingle(); // RLS: staff only
  if (!t) return Response.json({ status: 'missing' }, { status: 404 });
  if (t.status !== 'running' && t.status !== 'queued') return Response.json({ status: t.status, error: t.error });
  return Response.json(await pollTake(id));
}
