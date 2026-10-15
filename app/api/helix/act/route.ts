// Helix's confirm lane: POST { slug, step: 'propose' | 'confirm' | 'undo', action?, args?, token?, threadId?, page? }.
// propose returns what would happen and a signed token; confirm runs it with the person's own session (only the
// signed change, only for them, within five minutes) and notes it in their Helix thread; undo reverses it.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { helixScope, saveTurns } from '@/lib/helix-thread';
import { confirm, propose, undo } from '@/lib/helix-act';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ ok: false, error: 'Sign in first.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { slug?: string; step?: string; action?: string; args?: Record<string, unknown>; token?: string; threadId?: string; page?: string };
  const supabase = await db();
  const scope = await helixScope(supabase, viewer, 'agency', b.slug);
  if ('error' in scope) return Response.json({ ok: false, error: scope.error }, { status: scope.status });
  if (b.step === 'propose') return Response.json(await propose(supabase, viewer.userId, scope.tenantId, String(b.action ?? ''), b.args ?? {}));
  const r = b.step === 'confirm' ? await confirm(supabase, viewer.userId, scope.tenantId, String(b.token ?? ''))
    : b.step === 'undo' ? await undo(supabase, viewer.userId, scope.tenantId, String(b.token ?? ''))
    : { ok: false as const, error: 'Unknown step.' };
  // What Helix did (or undid) goes into the person's thread, so the conversation shows it after a reload too.
  if (r.ok) await saveTurns(supabase, scope, 'agency', b.threadId, typeof b.page === 'string' ? b.page.slice(0, 120) : undefined, [{ role: 'helix', text: b.step === 'undo' ? r.done : `Done: ${r.done}`, meta: { act: b.step } }]);
  return Response.json(r);
}
