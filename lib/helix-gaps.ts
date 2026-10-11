// When Helix is asked something it doesn't know or isn't set up to answer, it says so warmly and the question
// becomes a Helix note for the team: "Great question. I'll make a note of that and send it to the team for review."
// The note lands in the Helix notes inbox (Enterprise → Helix notes), where a person or the build agent turns it into
// work. Hard-line declines (quotes, coverage advice, lines the agency doesn't sell, money for non-money roles) are not
// gaps and never become notes. The same question twice in a week is one note.
import 'server-only';
import { adminDb } from './supabase/admin';
import type { HelixReply } from './helix-agency';

export const GAP_ANSWER = 'Great question. I’ll make a note of that and send it to the team for review.';

/** If Helix flagged the question as a gap, file it as a Helix note and give the standard answer. */
export async function fileGap(reply: HelixReply, q: { question: string; tenantId: string | null; where: string; askedBy: string | null }): Promise<HelixReply> {
  if (!reply.unknown) return reply;
  const question = q.question.replace(/\s+/g, ' ').trim().slice(0, 400);
  const text = `${q.where} asked Helix: "${question}"${reply.gap ? ` · Helix is missing: ${reply.gap.slice(0, 150)}` : ''}`.slice(0, 600);
  const db = adminDb();
  try {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: same } = await db.from('helix_notes').select('id').eq('chapter', 'ask-helix').ilike('text', `%"${question.replace(/[%_]/g, ' ').slice(0, 200)}%`).gte('created_at', since).neq('status', 'dismissed').limit(1);
    if (!same?.length) {
      const { error } = await db.from('helix_notes').insert({ kind: 'question', text, chapter: 'ask-helix', source: 'helix', tenant_id: q.tenantId, asked_by: q.askedBy });
      if (error) throw new Error(error.message);
    }
    return { ...reply, answer: GAP_ANSWER, noted: true };
  } catch (e) {
    console.error(`[helix-gap] ${e instanceof Error ? e.message : e}`);
    return { ...reply, answer: 'Great question. I don’t have that yet; please ask the Genovus team directly.' };
  }
}
