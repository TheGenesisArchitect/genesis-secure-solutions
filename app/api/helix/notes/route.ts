// Notes Helix takes during a tour. POST saves one (only for a live session, capped per session); GET lists a
// session's notes with any agent drafts, so the tour panel can show work arriving in the background.
import { adminDb } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
const KINDS = ['idea', 'action_item', 'question', 'risk'];
const CHAPTERS = ['map', 'market', 'mission', 'content', 'studio', 'calendar', 'calls', 'funnel', 'flywheel', 'helix'];
const uuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);

async function liveSession(id: string) {
  const { data } = await adminDb().from('helix_tour_sessions').select('id, started_at, ended_at').eq('id', id).maybeSingle();
  if (!data) return null;
  const age = Date.now() - new Date(data.started_at).getTime();
  return age < 20 * 60_000 ? data : null; // notes accepted for a short while after a tour ends
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { sessionId?: string; kind?: string; text?: string; chapter?: string; source?: string };
  if (!uuid(b.sessionId) || !(await liveSession(b.sessionId!))) return Response.json({ error: 'This tour has ended.' }, { status: 400 });
  const text = String(b.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (text.length < 2) return Response.json({ error: 'Empty note.' }, { status: 400 });
  const db = adminDb();
  const { count } = await db.from('helix_notes').select('id', { count: 'exact', head: true }).eq('session_id', b.sessionId!);
  if ((count ?? 0) >= 30) return Response.json({ error: 'This tour has reached its note limit.' }, { status: 429 });
  const { data, error } = await db.from('helix_notes').insert({
    session_id: b.sessionId, kind: KINDS.includes(String(b.kind)) ? b.kind : 'idea', text,
    chapter: CHAPTERS.includes(String(b.chapter)) ? b.chapter : null, source: b.source === 'person' ? 'person' : 'helix',
  }).select('id, kind, text, chapter, status, created_at').single();
  if (error) return Response.json({ error: 'The note could not be saved.' }, { status: 500 });
  return Response.json({ note: data });
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('session');
  if (!uuid(id)) return Response.json({ notes: [] });
  const { data } = await adminDb().from('helix_notes').select('id, kind, text, chapter, status, work, created_at').eq('session_id', id!).order('created_at');
  return Response.json({ notes: data ?? [] });
}
