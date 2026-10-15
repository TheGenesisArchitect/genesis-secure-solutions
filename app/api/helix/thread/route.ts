// The person's current Ask Helix thread: GET ?surface=agency&slug=… (or surface=enterprise) returns the thread and
// its newest turns, so the drawer picks up where they left off after a reload or on another device.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { RESTORE_TURNS, helixScope, openThread, threadTurns, type HelixSurface } from '@/lib/helix-thread';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const u = new URL(req.url);
  const surface = u.searchParams.get('surface') as HelixSurface;
  if (!['agency', 'enterprise', 'studio'].includes(surface)) return Response.json({ error: 'Unknown surface.' }, { status: 400 });
  const supabase = await db();
  const scope = await helixScope(supabase, viewer, surface, u.searchParams.get('slug') ?? undefined);
  if ('error' in scope) return Response.json({ error: scope.error }, { status: scope.status });
  const thread = await openThread(supabase, viewer, scope, surface, u.searchParams.get('thread'));
  if (!thread) return Response.json({ threadId: null, turns: [] }, { headers: { 'cache-control': 'no-store' } });
  return Response.json({ threadId: thread.id, title: thread.title, lastPage: thread.last_page, lastAt: thread.last_at, turns: await threadTurns(supabase, thread.id, RESTORE_TURNS) }, { headers: { 'cache-control': 'no-store' } });
}
