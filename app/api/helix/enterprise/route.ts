// Enterprise Helix: POST { threadId?, question, context?, page? } from Genovus staff. The brief is built with the
// viewer's own session, so row-level security applies, and Finance is included only for an admin or account lead.
// Helix reads the person's saved thread and both turns are saved to it (it travels across pages and devices).
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { askHelix } from '@/lib/helix-agency';
import { ENTERPRISE_SYSTEM, canSeeMoney, enterpriseBrief } from '@/lib/helix-enterprise';
import { fileGap } from '@/lib/helix-gaps';
import { HISTORY_TURNS, helixScope, historyOf, openThread, saveTurns, threadTurns } from '@/lib/helix-thread';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.staff) return Response.json({ error: 'Enterprise Helix is for the Genovus team.' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { threadId?: string; question?: string; context?: string; page?: string };
  const question = String(b.question ?? '').trim();
  if (!question) return Response.json({ error: 'Ask Helix something.' }, { status: 400 });
  const supabase = await db();
  const scope = await helixScope(supabase, viewer, 'enterprise');
  if ('error' in scope) return Response.json({ error: scope.error }, { status: scope.status });
  const context = typeof b.context === 'string' ? b.context.slice(0, 600) : undefined;
  const page = typeof b.page === 'string' ? b.page.slice(0, 120) : undefined;
  try {
    const thread = await openThread(supabase, viewer, scope, 'enterprise', b.threadId);
    const history = thread ? historyOf(await threadTurns(supabase, thread.id, HISTORY_TURNS)) : [];
    const brief = await enterpriseBrief(supabase, { money: canSeeMoney(viewer.staff.role) });
    const asked = await askHelix(brief.text, history, question, context, ENTERPRISE_SYSTEM);
    if (brief.memoryIds.length) await adminDb().rpc('touch_memories', { p_ids: brief.memoryIds });
    // Something Helix doesn't know yet becomes a Helix note for the team.
    const reply = await fileGap(asked, { question, tenantId: brief.houseId, where: `${viewer.staff.name} (Enterprise)`, askedBy: viewer.userId });
    const threadId = await saveTurns(supabase, scope, 'enterprise', thread?.id, page, [
      { role: 'user', text: question, context },
      { role: 'helix', text: reply.answer, meta: { drafts: reply.drafts, remember: reply.remember, noted: reply.noted || undefined } },
    ]);
    return Response.json({ ...reply, threadId });
  } catch (e) {
    console.error(`[helix-enterprise] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: 'Helix couldn’t answer just now. Try again in a moment.' }, { status: 502 });
  }
}
