// Unedit's taps, Genovus team only: register an uploaded recording (it starts right away), and every button on the
// Approve card (approve, redo with a note, leave out, edit copy, pick a thumbnail, retry, approve the campaign).
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { genovusTenant, kick, registerVlog, tap } from '@/lib/unedit';
import { calendarText, cancelPosts, movePosts } from '@/lib/unedit-helix';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await db();
  const [{ data: staff }, { data: auth }] = await Promise.all([supabase.rpc('is_staff'), supabase.auth.getUser()]);
  if (!staff || !auth.user) return Response.json({ ok: false, error: 'Only the Genovus team can use Unedit.' }, { status: 403 });
  const origin = new URL(req.url).origin;
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 }); }
  try {
    // Before uploading: has this exact recording (by fingerprint) been uploaded already?
    if (body.tool === 'lookup') {
      const { data } = await adminDb().from('unedit_vlogs').select('id').eq('tenant_id', await genovusTenant()).eq('fingerprint', String(body.fingerprint ?? '')).maybeSingle();
      return Response.json({ ok: true, id: data?.id ?? null });
    }
    if (body.tool === 'register') {
      const r = await registerVlog({ blobPath: String(body.blobPath ?? ''), blobUrl: String(body.blobUrl ?? ''), bytes: Number(body.bytes), fingerprint: String(body.fingerprint ?? ''), fileName: String(body.fileName ?? 'recording'), by: auth.user.id });
      if (!r.existing) await kick(origin, r.id);
      return Response.json({ ok: true, id: r.id, existing: r.existing, say: r.existing ? 'You already uploaded this recording; here it is.' : 'Uploaded. Unedit is on it.' });
    }
    // Helix voice on the posting calendar (lib/unedit-helix.ts): results go back to the conversation.
    if (typeof body.tool === 'string' && body.tool.startsWith('voice_')) {
      const a = (body.args && typeof body.args === 'object' ? body.args : {}) as Record<string, string>;
      const current = typeof body.current === 'string' && /^[0-9a-f-]{36}$/.test(body.current) ? body.current : undefined;
      const sel = { recording: a.recording, clip: a.clip, platform: a.platform, day: a.day, current };
      if (body.tool === 'voice_posting_calendar') return Response.json(await calendarText());
      if (body.tool === 'voice_move_posts') return Response.json(await movePosts({ ...sel, date: a.date, time: a.time }, auth.user.id));
      if (body.tool === 'voice_cancel_posts') return Response.json(await cancelPosts(sel, auth.user.id));
      return Response.json({ ok: false, error: 'Unknown voice command.' }, { status: 400 });
    }
    const id = String(body.id ?? '');
    if (!/^[0-9a-f-]{36}$/.test(id)) return Response.json({ ok: false, error: 'Which recording?' }, { status: 400 });
    const say = await tap(id, body as never, auth.user.id, origin);
    return Response.json({ ok: true, say });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'That didn’t work.' }, { status: 400 });
  }
}
