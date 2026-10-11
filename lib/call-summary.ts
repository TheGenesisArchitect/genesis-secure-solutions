// Helix's call summary: after a recorded call (the caller heard the recording notice), Helix listens and writes a
// short note for the lead card: who called, which line, what they want, the next step. No card numbers, birth
// dates or license numbers are ever written down. Gemini reads the audio; the audio itself stays in Twilio.
import 'server-only';
import { adminDb } from './supabase/admin';
import { recordingAudio } from './twilio';
import { lineLabels } from './lines';

export async function summarizeCall(callSid: string, recordingSid: string, tenantId: string) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return;
  const db = adminDb();
  const { data: prof } = await db.from('agency_profiles').select('lines').eq('tenant_id', tenantId).maybeSingle();
  const audio = await recordingAudio(recordingSid);
  if (!audio.ok) return;
  const b64 = Buffer.from(await audio.arrayBuffer()).toString('base64');
  const lines = lineLabels(prof?.lines).join(', ') || 'personal insurance';
  const prompt = `This is a recorded phone call to an insurance agency that sells ${lines}. Write a note for the agent in under 60 words: who called (first name if said), which line they asked about, what they want, and the next step with any time they mentioned. Never write card numbers, bank details, Social Security, driver license numbers or birth dates. If it is a voicemail, say so. If nothing useful was said, reply "No details captured." Plain text only.`;
  const model = (process.env.HELIX_AUDIO_MODEL || 'gemini-2.5-flash').trim();
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' }, signal: AbortSignal.timeout(50_000),
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'audio/mpeg', data: b64 } }, { text: prompt }] }], generationConfig: { temperature: 0.2 } }),
  });
  const j = (await r.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  if (r.ok && text) await db.rpc('set_call_summary', { p_call_sid: callSid, p_summary: text });
}
