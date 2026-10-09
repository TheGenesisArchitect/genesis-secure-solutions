// Handing a Helix note to the background build agent. Shared by the tour panel (API route), the Enterprise
// dashboard (server action) and team tours (automatic). Responds at once; the agent drafts after the response
// via next/server after(). Draft only: nothing it writes is acted on until a person works the note.
import 'server-only';
import { after } from 'next/server';
import { adminDb } from '@/lib/supabase/admin';
import { draftWork } from '@/lib/agent-draft';

export async function handOffNote(noteId: string, by: { userId: string | null; name: string }): Promise<{ ok: boolean; status?: string; error?: string }> {
  const db = adminDb();
  const { data: note } = await db.from('helix_notes').select('id, kind, text, chapter, status').eq('id', noteId).maybeSingle();
  if (!note) return { ok: false, error: 'Unknown note.' };
  if (['drafting', 'drafted', 'in_progress', 'done', 'accepted'].includes(note.status)) return { ok: true, status: note.status };
  await db.from('helix_notes').update({ status: 'drafting', handed_off_by: by.userId, updated_at: new Date().toISOString() }).eq('id', noteId);
  const { data: house } = await db.from('tenants').select('id').eq('slug', 'genovus').single();
  const { error: auditErr } = await db.from('audit_events').insert({ tenant_id: house?.id ?? null, actor: by.userId, actor_label: by.name, action: 'helix.note.handoff', subject: note.text.slice(0, 80), before: { status: note.status }, after: { status: 'drafting' }, prev_hash: '', hash: '' });
  if (auditErr) console.error(`[agent] audit insert failed: ${auditErr.message}`);
  after(async () => {
    try {
      const work = await draftWork(note);
      await db.from('helix_notes').update({ status: 'drafted', work, updated_at: new Date().toISOString() }).eq('id', noteId).eq('status', 'drafting');
    } catch (e) {
      console.error(`[agent] draft failed: ${e instanceof Error ? e.message : e}`);
      await db.from('helix_notes').update({ status: 'failed', work: { error: e instanceof Error ? e.message.slice(0, 200) : 'failed' }, updated_at: new Date().toISOString() }).eq('id', noteId);
    }
  });
  return { ok: true, status: 'drafting' };
}
