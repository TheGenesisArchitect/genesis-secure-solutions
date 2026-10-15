// The person's current Ask Helix thread: GET ?surface=agency&slug=… (or surface=enterprise) returns the thread and
// its newest turns, so the drawer picks up where they left off after a reload or on another device.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { RESTORE_TURNS, helixScope, openThread, saveTurns, threadTurns, type HelixSurface } from '@/lib/helix-thread';

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

// A spoken exchange from voice Ask Helix: POST { surface, slug?, threadId?, page?, turns: [{ role, text }] } adds
// it to the person's thread (channel voice), so voice and typing are one conversation. Only exchanges where the
// person actually spoke are sent (the browser skips Helix's greeting). Returns the thread.
export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { surface?: string; slug?: string; threadId?: string; page?: string; turns?: { role?: string; text?: string }[] };
  const surface = b.surface === 'enterprise' ? 'enterprise' : b.surface === 'agency' ? 'agency' : null;
  if (!surface) return Response.json({ error: 'Unknown surface.' }, { status: 400 });
  const turns = (Array.isArray(b.turns) ? b.turns : []).slice(0, 6).filter((t) => (t?.role === 'user' || t?.role === 'helix') && typeof t.text === 'string' && t.text.trim())
    .map((t) => ({ role: t.role as 'user' | 'helix', text: String(t.text).trim().slice(0, 4000), channel: 'voice' as const }));
  if (!turns.some((t) => t.role === 'user')) return Response.json({ error: 'Nothing the person said.' }, { status: 400 });
  const supabase = await db();
  const scope = await helixScope(supabase, viewer, surface, b.slug);
  if ('error' in scope) return Response.json({ error: scope.error }, { status: scope.status });
  const threadId = await saveTurns(supabase, scope, surface, b.threadId, typeof b.page === 'string' ? b.page.slice(0, 120) : undefined, turns);
  return threadId ? Response.json({ threadId }) : Response.json({ error: 'Couldn’t save.' }, { status: 500 });
}
