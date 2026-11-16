// Voice enhancement: the take's soundtrack through ElevenLabs voice isolation (via Runway, eleven_voice_isolation,
// 1 credit per 6 s), the studio-grade cleanup behind "enhance audio" in the social apps: room echo, hum, traffic and
// fans out, the voice left clean. The isolated track is stored next to the original (audio-voice.m4a beside
// audio.m4a) and becomes the recording's soundtrack, for the episode and the clips; the original stays for a
// before/after. Never fatal: any failure (or a result whose length doesn't match) keeps the original sound.
import 'server-only';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { put } from '@vercel/blob';
import { CREDIT_CENTS, runwayConfigured, runwayTask, runwayVoiceIsolation } from '@/lib/runway';
import { ffmpeg, presigned, sweepTmp } from '@/lib/unedit-media';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

export const VOICE_FILE = 'audio-voice.m4a';
export const isEnhanced = (p: string | null | undefined) => Boolean(p && p.endsWith(`/${VOICE_FILE}`));
const ON = () => process.env.UNEDIT_VOICE !== 'off';

/** The length of an audio file (or link) in seconds, from its header. */
async function seconds(src: string): Promise<number | null> {
  const err = await new Promise<string>((res) => execFile(String(ffmpegPath), ['-hide_banner', '-i', src], { maxBuffer: 4 * 1024 * 1024, timeout: 60_000 }, (_e, _o, e2) => res(String(e2))));
  const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Isolate the voice of `audioPath` (a private Blob path) and store it beside it. Returns the new path and its cost,
 *  or null with the reason (the caller keeps the original). */
export async function enhanceVoice(audioPath: string): Promise<{ path: string; why?: undefined; cents: number } | { path: null; why: string; cents: number }> {
  if (!ON()) return { path: null, why: 'voice enhancement is off (UNEDIT_VOICE=off)', cents: 0 };
  if (!runwayConfigured()) return { path: null, why: 'Runway is not connected', cents: 0 };
  const src = await presigned(audioPath, 60);
  const secs = await seconds(src);
  if (!secs || secs < 5 || secs > 3590) return { path: null, why: `the soundtrack is ${Math.round(secs ?? 0)} s (voice isolation takes 5 s to 60 min)`, cents: 0 };
  const cents = Math.ceil(secs / 6) * CREDIT_CENTS;
  try {
    const { id } = await runwayVoiceIsolation(src);
    let t = await runwayTask(id);
    for (let i = 0; i < 72 && !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(t.status); i++) { await new Promise((r) => setTimeout(r, 5000)); t = await runwayTask(id); }
    if (t.status !== 'SUCCEEDED' || !t.output?.[0]) return { path: null, why: `voice isolation ${t.status === 'SUCCEEDED' ? 'returned nothing' : (t.failure ?? t.status).toLowerCase()}`, cents: t.status === 'SUCCEEDED' ? cents : 0 };
    await sweepTmp();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-voice-'));
    try {
      const r = await fetch(t.output[0], { signal: AbortSignal.timeout(180_000) });
      if (!r.ok) return { path: null, why: `the isolated voice didn't download (${r.status})`, cents };
      await fs.writeFile(path.join(dir, 'in.audio'), Buffer.from(await r.arrayBuffer()));
      await ffmpeg(['-i', 'in.audio', '-vn', '-ar', '48000', '-ac', '2', '-c:a', 'aac', '-b:a', '256k', 'voice.m4a'], dir);
      // The cut list is timed on the original: the isolated track must line up with it.
      const got = await seconds(path.join(dir, 'voice.m4a'));
      if (!got || Math.abs(got - secs) > 0.25) return { path: null, why: `the isolated voice is ${got?.toFixed(2)} s, the take ${secs.toFixed(2)} s, so it would drift out of sync`, cents };
      const out = `${path.dirname(audioPath)}/${VOICE_FILE}`;
      await put(out, await fs.readFile(path.join(dir, 'voice.m4a')), { access: 'private', contentType: 'audio/mp4', addRandomSuffix: false, allowOverwrite: true });
      return { path: out, cents };
    } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
  } catch (e) {
    return { path: null, why: `voice isolation failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`, cents: 0 };
  }
}
