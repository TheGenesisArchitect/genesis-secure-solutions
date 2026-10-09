// Hand a tour note to the background build agent (Genovus team only). The tour panel polls the note until the
// draft arrives; the same note is worked on the Enterprise dashboard (/console/helix).
import { getViewer } from '@/lib/session';
import { handOffNote } from '@/lib/helix-notes';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.staff) return Response.json({ error: 'Only the Genovus team can hand notes to an agent.' }, { status: 403 });
  const { noteId } = (await req.json().catch(() => ({}))) as { noteId?: string };
  if (!noteId || !/^[0-9a-f-]{36}$/.test(noteId)) return Response.json({ error: 'Unknown note.' }, { status: 400 });
  const r = await handOffNote(noteId, { userId: viewer.userId, name: viewer.staff.name });
  return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: 404 });
}
