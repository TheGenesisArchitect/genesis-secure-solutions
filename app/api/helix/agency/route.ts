// Ask Helix for an agency: POST { slug, threadId?, question, context?, page? } from a member (or staff) of that
// agency with the Helix module (program or trial). The brief is built from that one agency's data only. Helix reads
// the person's saved thread (not history sent by the browser) and both turns are saved to it, so the conversation
// carries on across pages, reloads and devices. Returns the answer and the thread.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { agencyBrief, askHelix } from '@/lib/helix-agency';
import { PROGRAM_NAME, type ProgramId } from '@/lib/programs';
import { fileGap } from '@/lib/helix-gaps';
import { HISTORY_TURNS, helixScope, historyOf, openThread, saveTurns, threadTurns } from '@/lib/helix-thread';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { slug?: string; threadId?: string; question?: string; context?: string; page?: string };
  const question = String(b.question ?? '').trim();
  if (!question) return Response.json({ error: 'Ask Helix something.' }, { status: 400 });
  const supabase = await db();
  const scope = await helixScope(supabase, viewer, 'agency', b.slug);
  if ('error' in scope) return Response.json({ error: scope.error }, { status: scope.status });
  const context = typeof b.context === 'string' ? b.context.slice(0, 600) : undefined;
  const page = typeof b.page === 'string' ? b.page.slice(0, 120) : undefined;
  try {
    const thread = await openThread(supabase, viewer, scope, 'agency', b.threadId);
    const history = thread ? historyOf(await threadTurns(supabase, thread.id, HISTORY_TURNS)) : [];
    const brief = await agencyBrief(supabase, scope.tenantId, scope.name, PROGRAM_NAME[scope.program as ProgramId]);
    // Something Helix doesn't know yet becomes a Helix note for the Genovus team.
    const reply = await fileGap(await askHelix(brief, history, question, context), { question, tenantId: scope.tenantId, where: scope.name, askedBy: viewer.userId });
    const threadId = await saveTurns(supabase, scope, 'agency', thread?.id, page, [
      { role: 'user', text: question, context },
      { role: 'helix', text: reply.answer, meta: { followUps: reply.followUps, drafts: reply.drafts, noted: reply.noted || undefined } },
    ]);
    return Response.json({ ...reply, threadId });
  } catch (e) {
    console.error(`[helix-agency] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: 'Helix couldn’t answer just now. Try again in a moment.' }, { status: 502 });
  }
}
