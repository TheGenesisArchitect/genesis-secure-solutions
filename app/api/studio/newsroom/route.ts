// The Genovus Newsroom's actions, Genovus team only: research a beat live, research one story deeper, shape a
// story (parts, angle, voice), approve or drop a claim, produce the content package, and hand it to the next upload.
// Research and production can take a few minutes (live web search), and a faceless version is voiced and rendered
// in the background after the answer, hence the long limit. The actions live in lib/newsroom-actions.ts, shared with
// Helix (voice and typed), so a spoken request runs exactly what the button runs.
import { db } from '@/lib/supabase/server';
import { newsroomAction } from '@/lib/newsroom-actions';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: Request) {
  const supabase = await db();
  const [{ data: staff }, { data: auth }] = await Promise.all([supabase.rpc('is_staff'), supabase.auth.getUser()]);
  if (!staff || !auth.user) return Response.json({ ok: false, error: 'Only the Genovus team can use the newsroom.' }, { status: 403 });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 }); }
  try {
    const r = await newsroomAction(b, auth.user.id, new URL(req.url).origin);
    return Response.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'That didn’t work.';
    return Response.json({ ok: false, error: msg }, { status: 400 });
  }
}
