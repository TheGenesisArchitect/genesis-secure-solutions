// Unedit transcription, server only: the talk's small MP3 (lib/unedit-media.ts extractAudio) goes to Deepgram
// (Nova-3) or AssemblyAI, and comes back as words with start/end times, punctuated, which is what clean cuts and
// word-by-word captions need. UNEDIT_STT picks the service (deepgram by default); the first proof runs both on
// the same recordings to choose on accuracy. The *_API_BASE variables point the tests at stand-ins.
import 'server-only';
import type { Word } from '@/lib/unedit-media';

export type Provider = 'deepgram' | 'assemblyai';
export type Transcript = { provider: Provider; words: Word[]; seconds: number; cents: number };

// List prices per minute of audio (Nov 2026; check the vendors' pricing pages): what the Studio budget is charged.
const CENTS_PER_MIN: Record<Provider, number> = { deepgram: 0.43, assemblyai: 0.45 };
const DG = () => (process.env.DEEPGRAM_API_BASE || 'https://api.deepgram.com').replace(/\/$/, '');
const AAI = () => (process.env.ASSEMBLYAI_API_BASE || 'https://api.assemblyai.com').replace(/\/$/, '');
const key = (p: Provider) => (p === 'deepgram' ? process.env.DEEPGRAM_API_KEY : process.env.ASSEMBLYAI_API_KEY)?.trim() || '';

export const defaultProvider = (): Provider => ((process.env.UNEDIT_STT || '').trim() === 'assemblyai' ? 'assemblyai' : 'deepgram');
export const providerReady = (p: Provider) => Boolean(key(p));
export const costCents = (p: Provider, seconds: number) => Math.max(1, Math.ceil((seconds / 60) * CENTS_PER_MIN[p]));

async function deepgram(mp3: Buffer): Promise<Word[]> {
  const q = new URLSearchParams({ model: 'nova-3', smart_format: 'true', punctuate: 'true', language: 'en' });
  const r = await fetch(`${DG()}/v1/listen?${q}`, { method: 'POST', headers: { authorization: `Token ${key('deepgram')}`, 'content-type': 'audio/mpeg' }, body: new Uint8Array(mp3), signal: AbortSignal.timeout(540_000) });
  const j = (await r.json().catch(() => ({}))) as { err_msg?: string; results?: { channels?: { alternatives?: { words?: { word: string; punctuated_word?: string; start: number; end: number; confidence?: number }[] }[] }[] } };
  if (!r.ok) throw new Error(`Deepgram: ${j.err_msg || `HTTP ${r.status}`}`);
  return (j.results?.channels?.[0]?.alternatives?.[0]?.words ?? []).map((w) => ({ w: w.punctuated_word || w.word, s: w.start, e: w.end, c: w.confidence }));
}

async function assemblyai(mp3: Buffer): Promise<Word[]> {
  const h = { authorization: key('assemblyai') };
  const up = await fetch(`${AAI()}/v2/upload`, { method: 'POST', headers: { ...h, 'content-type': 'application/octet-stream' }, body: new Uint8Array(mp3), signal: AbortSignal.timeout(120_000) });
  const u = (await up.json().catch(() => ({}))) as { upload_url?: string; error?: string };
  if (!up.ok || !u.upload_url) throw new Error(`AssemblyAI upload: ${u.error || `HTTP ${up.status}`}`);
  const start = await fetch(`${AAI()}/v2/transcript`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ audio_url: u.upload_url, language_code: 'en', punctuate: true, format_text: true }), signal: AbortSignal.timeout(30_000) });
  const s = (await start.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!start.ok || !s.id) throw new Error(`AssemblyAI: ${s.error || `HTTP ${start.status}`}`);
  // A 15-minute talk usually finishes in well under two minutes; give it up to eight.
  for (let i = 0; i < 160; i++) {
    await new Promise((res) => setTimeout(res, i ? 3000 : 1500));
    const g = await fetch(`${AAI()}/v2/transcript/${s.id}`, { headers: h, signal: AbortSignal.timeout(30_000) });
    const t = (await g.json().catch(() => ({}))) as { status?: string; error?: string; words?: { text: string; start: number; end: number; confidence?: number }[] };
    if (t.status === 'completed') return (t.words ?? []).map((w) => ({ w: w.text, s: w.start / 1000, e: w.end / 1000, c: w.confidence }));
    if (t.status === 'error') throw new Error(`AssemblyAI: ${t.error || 'transcription failed'}`);
  }
  throw new Error('AssemblyAI took longer than eight minutes.');
}

/** Transcribe the talk with one service. Words come back in order, trimmed of empties. */
export async function transcribe(mp3: Buffer, seconds: number, provider: Provider = defaultProvider()): Promise<Transcript> {
  if (!providerReady(provider)) throw new Error(`${provider === 'deepgram' ? 'DEEPGRAM_API_KEY' : 'ASSEMBLYAI_API_KEY'} is not set on this deployment.`);
  const raw = provider === 'deepgram' ? await deepgram(mp3) : await assemblyai(mp3);
  const words = raw.filter((w) => w.w && Number.isFinite(w.s) && Number.isFinite(w.e) && w.e >= w.s).sort((a, b) => a.s - b.s);
  if (!words.length) throw new Error(`${provider === 'deepgram' ? 'Deepgram' : 'AssemblyAI'} heard no speech in this recording.`);
  return { provider, words, seconds, cents: costCents(provider, seconds) };
}
