// Hand a tour note to the background build agent (Genovus team only). Responds at once; the agent drafts the
// plan after the response (next/server after()), and the tour panel polls the note until the draft arrives.
// Draft only: nothing the agent writes is acted on until a person accepts it.
import { after } from 'next/server';
import { adminDb } from '@/lib/supabase/admin';
import { getViewer } from '@/lib/session';
import { draftWork } from '@/lib/agent-draft';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const viewer = await getViewer().catch(() => null);
  if (!viewer?.staff) return Response.json({ error: 'Only the Genovus team can hand notes to an agent.' }, { status: 403 });
  const { noteId } = (await req.json().catch(() => ({}))) as { noteId?: string };
  if (!noteId || !/^[0-9a-f-]{36}$/.test(noteId)) return Response.json({ error: 'Unknown note.' }, { status: 400 });
  const db = adminDb();
  const { data: note } = await db.from('helix_notes').select('id, kind, text, chapter, status').eq('id', noteId).maybeSingle();
  if (!note) return Response.json({ error: 'Unknown note.' }, { status: 404 });
  if (['drafting', 'drafted', 'accepted'].includes(note.status)) return Response.json({ ok: true, status: note.status });
  await db.from('helix_notes').update({ status: 'drafting', handed_off_by: viewer.userId, updated_at: new Date().toISOString() }).eq('id', noteId);
  const { data: house } = await db.from('tenants').select('id').eq('slug', 'genovus').single();
  const { error: auditErr } = await db.from('audit_events').insert({ tenant_id: house?.id ?? null, actor: viewer.userId, actor_label: viewer.staff.name, action: 'helix.note.handoff', subject: note.text.slice(0, 80), before: { status: note.status }, after: { status: 'drafting' }, prev_hash: '', hash: '' });
  if (auditErr) console.error(`[agent] audit insert failed: ${auditErr.message}`);
  after(async () => {
    try {
      const work = await draftWork(note);
      await db.from('helix_notes').update({ status: 'drafted', work, updated_at: new Date().toISOString() }).eq('id', noteId);
    } catch (e) {
      console.error(`[agent] draft failed: ${e instanceof Error ? e.message : e}`);
      await db.from('helix_notes').update({ status: 'failed', work: { error: e instanceof Error ? e.message.slice(0, 200) : 'failed' }, updated_at: new Date().toISOString() }).eq('id', noteId);
    }
  });
  return Response.json({ ok: true, status: 'drafting' });
}
