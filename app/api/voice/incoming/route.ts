// A call to an agency's tracking number (Twilio voice webhook). The call is recorded as a lead the moment it rings;
// the caller hears a short recording notice and is forwarded to the office. No answer: voicemail (see /dialed).
import { adminDb } from '@/lib/supabase/admin';
import { publicUrl, twilioForm, twiml, xml } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const p = await twilioForm(req);
  if (!p) return new Response('Forbidden', { status: 403 });
  const db = adminDb();
  const { data: n } = await db.from('tracking_numbers').select('forward_to, record').eq('e164', p.To).is('released_at', null).maybeSingle();
  if (!n) return twiml('<Say>Sorry, this number is not in service.</Say><Hangup/>');
  const { error } = await db.rpc('ingest_call', { p_to: p.To, p_sid: p.CallSid, p_from: p.From ?? null, p_status: null, p_duration: null, p_recording_sid: null, p_recording_s: null });
  if (error) console.error(`[voice] ingest ${error.message}`);
  const origin = new URL(publicUrl(req)).origin;
  const rec = n.record ? ` record="record-from-answer-dual" recordingStatusCallback="${xml(`${origin}/api/voice/recording`)}"` : '';
  return twiml(`${n.record ? '<Say>This call may be recorded for quality.</Say>' : ''}<Dial timeout="20" callerId="${xml(p.From ?? '')}" action="${xml(`${origin}/api/voice/dialed`)}"${rec}><Number>${xml(n.forward_to)}</Number></Dial>`);
}
