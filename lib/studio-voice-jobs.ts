// Voice jobs: a script's lines voiced with the Studio's Gemini key (the one Helix uses; it never leaves the server),
// in an original prebuilt voice. Staff queue a job (app/api/studio/voice); the Studio cron voices a few lines per
// tick under a lease, so a long script finishes over a couple of minutes without a long request. Each line's WAV is
// kept in private storage; the job's results list them with their spoken length. Server only.
import 'server-only';
import { put } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { narrate, VOICES } from '@/lib/studio-voice';

export type VoiceLine = { id: string; text: string };
export type VoiceJob = { id: string; title: string; voice: string; style: string | null; lines: VoiceLine[]; results: Record<string, { path: string; secs: number }>; status: string; error: string | null; created_at: string; done_at: string | null };

const MAX_LINES = 40, MAX_CHARS = 900, BUDGET_MS = 35_000;
/** Voice one line: words only (lib/studio-voice.ts narrate), trimmed of leading and trailing silence. */
async function voiceLine(text: string, voice: string) {
  return trimWav(await narrate(text, voice));
}

/** Check a job before it's queued: known voice, sensible ids, lines short enough to voice in one call. */
export function checkJob(j: { title?: unknown; voice?: unknown; style?: unknown; lines?: unknown }): { title: string; voice: string; style: string | null; lines: VoiceLine[] } | string {
  const title = typeof j.title === 'string' ? j.title.trim().slice(0, 120) : '';
  if (!title) return 'Give the job a title.';
  const voice = typeof j.voice === 'string' && j.voice ? j.voice : 'Charon';
  if (!VOICES.includes(voice)) return `Unknown voice ${voice}.`;
  const style = typeof j.style === 'string' && j.style.trim() ? j.style.trim() : null;
  if (style) return 'Voice jobs take the words only: a delivery direction can be read aloud. Pick the voice for the tone instead.';
  if (!Array.isArray(j.lines) || !j.lines.length) return 'Add at least one line.';
  if (j.lines.length > MAX_LINES) return `At most ${MAX_LINES} lines per job.`;
  const seen = new Set<string>(), lines: VoiceLine[] = [];
  for (const l of j.lines as { id?: unknown; text?: unknown }[]) {
    const id = typeof l?.id === 'string' ? l.id.trim() : '', text = typeof l?.text === 'string' ? l.text.trim() : '';
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/i.test(id)) return `Line id "${id}" must be letters, numbers, - or _.`;
    if (seen.has(id)) return `Line id "${id}" is used twice.`;
    if (!text) return `Line "${id}" is empty.`;
    if (text.length > MAX_CHARS) return `Line "${id}" is over ${MAX_CHARS} characters; split it.`;
    seen.add(id); lines.push({ id, text });
  }
  return { title, voice, style, lines };
}

/** Spoken length of a 16-bit mono WAV, and the same audio with leading and trailing silence trimmed. */
function trimWav(wav: Buffer): { wav: Buffer; secs: number } {
  const rate = wav.readUInt32LE(24), pcm = wav.subarray(44), n = pcm.length / 2, gate = 500, pad = Math.round(rate * 0.06);
  let a = 0, b = n - 1;
  while (a < n && Math.abs(pcm.readInt16LE(a * 2)) < gate) a++;
  while (b > a && Math.abs(pcm.readInt16LE(b * 2)) < gate) b--;
  a = Math.max(0, a - pad); b = Math.min(n - 1, b + pad);
  const body = pcm.subarray(a * 2, (b + 1) * 2), h = Buffer.from(wav.subarray(0, 44));
  h.writeUInt32LE(36 + body.length, 4); h.writeUInt32LE(body.length, 40);
  return { wav: Buffer.concat([h, body]), secs: Math.round((body.length / 2 / rate) * 100) / 100 };
}

/** The cron's turn: claim open jobs one at a time and voice their remaining lines until the time budget runs out. */
export async function runVoiceJobs(): Promise<{ voiced: number; done: number; failed: number }> {
  const db = adminDb(), t0 = Date.now(), out = { voiced: 0, done: 0, failed: 0 };
  const { data: open } = await db.from('studio_voice_jobs').select('id').in('status', ['queued', 'voicing']).order('created_at').limit(5);
  for (const { id } of open ?? []) {
    if (Date.now() - t0 > BUDGET_MS) break;
    const now = new Date().toISOString();
    const { data: job } = await db.from('studio_voice_jobs').update({ status: 'voicing', lease_until: new Date(Date.now() + 90_000).toISOString() })
      .eq('id', id).in('status', ['queued', 'voicing']).or(`lease_until.is.null,lease_until.lt.${now}`).select('*').maybeSingle();
    if (!job) continue; // another tick holds it
    const j = job as unknown as VoiceJob;
    const results = { ...j.results };
    try {
      for (const l of j.lines) {
        if (results[l.id]) continue;
        if (Date.now() - t0 > BUDGET_MS) break;
        const { wav, secs } = await voiceLine(l.text, j.voice);
        const path = `studio/voice/${j.id}/${l.id}.wav`;
        await put(path, wav, { access: 'private', contentType: 'audio/wav', addRandomSuffix: false, allowOverwrite: true });
        results[l.id] = { path, secs };
        out.voiced++;
        await db.from('studio_voice_jobs').update({ results }).eq('id', j.id);
      }
      const finished = j.lines.every((l) => results[l.id]);
      await db.from('studio_voice_jobs').update(finished ? { status: 'done', done_at: new Date().toISOString(), lease_until: null } : { lease_until: null }).eq('id', j.id);
      if (finished) out.done++;
    } catch (e) {
      out.failed++;
      await db.from('studio_voice_jobs').update({ status: 'failed', error: e instanceof Error ? e.message.slice(0, 500) : 'voicing failed', lease_until: null }).eq('id', j.id);
    }
  }
  return out;
}
