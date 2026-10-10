// Character voices for the Studio, server only: Gemini text-to-speech with one fixed prebuilt voice per character
// and the bible's delivery direction as the style. Returns 24 kHz mono 16-bit audio, wrapped as WAV and kept in
// private storage. Original synthetic voices only; never an imitation of a real person.
import 'server-only';
import { put } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { businessToday } from '@/lib/billing';

const BASE = () => (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
const KEY = () => (process.env.GEMINI_API_KEY || '').trim();
const MODELS = () => [(process.env.STUDIO_TTS_MODEL || 'gemini-3.8-flash-tts').trim(), 'gemini-2.5-flash-preview-tts'];

export const VOICES = ['Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'];

function wav(pcm: Buffer, rate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function tts(text: string, voice: string, style: string | null): Promise<Buffer> {
  const spoken = style ? `Say this ${style}:\n${text}` : text;
  let lastErr = 'no model';
  for (const model of MODELS()) {
    const res = await fetch(`${BASE()}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'x-goog-api-key': KEY(), 'content-type': 'application/json' }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ contents: [{ parts: [{ text: spoken }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } }),
    });
    const j = (await res.json().catch(() => ({}))) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[]; error?: { message?: string } };
    if (!res.ok) { lastErr = j.error?.message ?? `HTTP ${res.status}`; if (res.status === 404 || res.status === 400) continue; throw new Error(lastErr); }
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part?.inlineData?.data) throw new Error('No audio returned.');
    const raw = Buffer.from(part.inlineData.data, 'base64');
    const mime = part.inlineData.mimeType ?? '';
    if (/wav/i.test(mime)) return raw;
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1] ?? 24000);
    return wav(raw, rate);
  }
  throw new Error(lastErr);
}

/** Voice one reserved clip and store it. */
export async function voiceClip(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = adminDb();
  const { data: c } = await db.from('studio_voice_clips').select('*').eq('id', id).single();
  if (!c) return { ok: false, error: 'not found' };
  try {
    const audio = await tts(c.text, c.voice_name, c.style);
    const path = `studio/voice/${id}.wav`;
    await put(path, audio, { access: 'private', contentType: 'audio/wav', addRandomSuffix: false, allowOverwrite: true });
    await db.from('studio_voice_clips').update({ status: 'ready', blob_path: path }).eq('id', id);
    if (c.cost_cents > 0) await db.from('expenses').insert({ spent_on: businessToday(), category: 'ai', vendor: 'Google Gemini', amount_cents: c.cost_cents, note: `Studio: voice ${c.voice_name} (${c.kind})`, created_by: c.created_by });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
    await db.from('studio_voice_clips').update({ status: 'failed', error: msg, cost_cents: 0 }).eq('id', id);
    return { ok: false, error: msg };
  }
}
