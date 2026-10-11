// Play a call recording: only a signed-in member of that agency (or Genovus staff). The audio streams from Twilio
// through this route; Twilio's link is never shown.
import { db } from '@/lib/supabase/server';
import { recordingAudio } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response('Not found', { status: 404 });
  // Row-level security: the read returns the call only to a member of its agency or staff.
  const { data: c } = await (await db()).from('calls').select('recording_sid').eq('id', id).maybeSingle();
  if (!c?.recording_sid) return new Response('Not found', { status: 404 });
  const a = await recordingAudio(c.recording_sid);
  if (!a.ok || !a.body) return new Response('Recording unavailable', { status: 502 });
  return new Response(a.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, no-store' } });
}
