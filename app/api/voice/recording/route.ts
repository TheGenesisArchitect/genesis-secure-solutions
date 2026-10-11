// A recording is ready (Twilio recordingStatusCallback): attach it to the call, then Helix writes the call note.
import { after } from 'next/server';
import { adminDb } from '@/lib/supabase/admin';
import { twilioForm } from '@/lib/twilio';
import { summarizeCall } from '@/lib/call-summary';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  const p = await twilioForm(req);
  if (!p) return new Response('Forbidden', { status: 403 });
  if (p.RecordingStatus && p.RecordingStatus !== 'completed') return new Response(null, { status: 204 });
  const { data: tenantId, error } = await adminDb().rpc('attach_call_recording', { p_call_sid: p.CallSid, p_recording_sid: p.RecordingSid, p_seconds: Number(p.RecordingDuration ?? 0) || 0 });
  if (error) console.error(`[voice] recording ${error.message}`);
  if (tenantId) after(() => summarizeCall(p.CallSid, p.RecordingSid, String(tenantId)).catch((e) => console.error(`[voice] summary ${e}`)));
  return new Response(null, { status: 204 });
}
