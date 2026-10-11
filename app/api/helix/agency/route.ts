// Ask Helix for an agency: POST { slug, history, question } from a member (or staff) of that agency with the
// Helix module (program or trial). The brief is built from that one agency's data only.
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';
import { agencyBrief, askHelix, type HelixTurn } from '@/lib/helix-agency';
import { PROGRAM_NAME } from '@/lib/programs';
import { fileGap } from '@/lib/helix-gaps';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { slug?: string; history?: HelixTurn[]; question?: string; context?: string };
  const question = String(b.question ?? '').trim();
  if (!question) return Response.json({ error: 'Ask Helix something.' }, { status: 400 });
  const supabase = await db();
  const m = viewer.memberships.find((x) => x.slug === b.slug);
  const t = m ? { id: m.tenantId, name: m.name, plan: m.plan } : viewer.staff ? await supabase.from('tenants').select('id, name, plan').eq('slug', String(b.slug ?? '')).maybeSingle().then((r) => r.data) : null;
  if (!t) return Response.json({ error: 'Not your agency.' }, { status: 403 });
  const access = await accessFor(t.id, t.plan);
  if (!access.has('helix')) return Response.json({ error: 'Ask Helix is part of Growth. Ask the Genovus team for a trial.' }, { status: 403 });
  const history = (Array.isArray(b.history) ? b.history : []).filter((h) => h && (h.role === 'user' || h.role === 'helix') && typeof h.text === 'string').map((h) => ({ role: h.role, text: h.text.slice(0, 1500) }));
  try {
    const brief = await agencyBrief(supabase, t.id, t.name, PROGRAM_NAME[access.program]);
    const reply = await askHelix(brief, history, question, typeof b.context === 'string' ? b.context : undefined);
    // Something Helix doesn't know yet becomes a Helix note for the Genovus team.
    return Response.json(await fileGap(reply, { question, tenantId: t.id, where: t.name, askedBy: viewer.userId }));
  } catch (e) {
    console.error(`[helix-agency] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: 'Helix couldn’t answer just now. Try again in a moment.' }, { status: 502 });
  }
}
