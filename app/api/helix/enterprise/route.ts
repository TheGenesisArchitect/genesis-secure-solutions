// Enterprise Helix: POST { history, question, context } from Genovus staff. The brief is built with the viewer's own
// session, so row-level security applies, and Finance is included only for an admin or account lead.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { askHelix, type HelixTurn } from '@/lib/helix-agency';
import { ENTERPRISE_SYSTEM, canSeeMoney, enterpriseBrief } from '@/lib/helix-enterprise';
import { fileGap } from '@/lib/helix-gaps';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.staff) return Response.json({ error: 'Enterprise Helix is for the Genovus team.' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { history?: HelixTurn[]; question?: string; context?: string };
  const question = String(b.question ?? '').trim();
  if (!question) return Response.json({ error: 'Ask Helix something.' }, { status: 400 });
  const history = (Array.isArray(b.history) ? b.history : []).filter((h) => h && (h.role === 'user' || h.role === 'helix') && typeof h.text === 'string').map((h) => ({ role: h.role, text: h.text.slice(0, 1500) }));
  try {
    const brief = await enterpriseBrief(await db(), { money: canSeeMoney(viewer.staff.role) });
    const reply = await askHelix(brief.text, history, question, typeof b.context === 'string' ? b.context : undefined, ENTERPRISE_SYSTEM);
    if (brief.memoryIds.length) await adminDb().rpc('touch_memories', { p_ids: brief.memoryIds });
    // Something Helix doesn't know yet becomes a Helix note for the team.
    return Response.json(await fileGap(reply, { question, tenantId: brief.houseId, where: `${viewer.staff.name} (Enterprise)`, askedBy: viewer.userId }));
  } catch (e) {
    console.error(`[helix-enterprise] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: 'Helix couldn’t answer just now. Try again in a moment.' }, { status: 502 });
  }
}
