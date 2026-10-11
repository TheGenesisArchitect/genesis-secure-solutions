// The office answered or not (Twilio <Dial> action). Answered: the call is logged with its length. Not answered:
// logged as missed (a "Call back" follow-up lands in Today) and the caller can leave a voicemail.
import { adminDb } from '@/lib/supabase/admin';
import { publicUrl, twilioForm, twiml, xml } from '@/lib/twilio';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const p = await twilioForm(req);
  if (!p) return new Response('Forbidden', { status: 403 });
  const answered = p.DialCallStatus === 'completed';
  const { error } = await adminDb().rpc('ingest_call', { p_to: p.To, p_sid: p.CallSid, p_from: p.From ?? null, p_status: answered ? 'answered' : 'missed', p_duration: Number(p.DialCallDuration ?? 0) || 0, p_recording_sid: null, p_recording_s: null });
  if (error) console.error(`[voice] dialed ${error.message}`);
  if (answered) return twiml('<Hangup/>');
  const origin = new URL(publicUrl(req)).origin;
  return twiml(`<Say>Sorry we missed you. Please leave your name, number and what you need after the tone, and we will call you right back.</Say><Record maxLength="120" playBeep="true" recordingStatusCallback="${xml(`${origin}/api/voice/recording`)}"/><Say>Thank you. Goodbye.</Say>`);
}
