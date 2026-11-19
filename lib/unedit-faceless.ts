// Faceless videos: a Newsroom package read by an original narrator voice (Gemini, lib/studio-voice.ts) over the
// Genovus moving background, made into a recording that the normal Unedit pipeline cuts. It is word for word the
// package's script, so its sources sheet places the facts where the narrator says them; the pipeline turns its face
// steps off for it (no face look or grade, one steady frame instead of camera sizes, more labelled illustrations).
//
// Short = whole lines from the top up to about 190 words, then the closing call to action (~75 s): the first proof.
// Full = the whole script. Original synthetic voices only, never an imitation of a real person; posts say so.
import 'server-only';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { put } from '@vercel/blob';
import { adminDb } from '@/lib/supabase/admin';
import { narrate } from '@/lib/studio-voice';
import { ffmpeg, sweepTmp } from '@/lib/unedit-media';
import { parseSheet } from '@/lib/unedit-news';
import { kick } from '@/lib/unedit';
import type { Production } from '@/lib/newsroom';
import { FACELESS_VOICES, type FacelessState } from '@/lib/faceless-voices';
import type { ScriptLine } from '@/lib/unedit-faceless-pro';

export { FACELESS_VOICES } from '@/lib/faceless-voices';
export type { FacelessState } from '@/lib/faceless-voices';
export type FacelessLength = 'short' | 'full';

const LINE_CENTS = 1; // estimate per narrated line (Gemini text-to-speech)
const SHORT_WORDS = 190;
const GAP = 0.35;     // seconds of air between lines
const RATE = 48000;
const db = () => adminDb();

/** The lines the narrator reads, in order. */
export function narration(p: Production, length: FacelessLength): string[] {
  const all = (p.script ?? []).flatMap((pt) => pt.lines.map((l) => l.say.trim())).filter(Boolean);
  const lines = all.length ? all : String(p.teleprompter ?? '').split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (length === 'full' || lines.length < 3) return lines;
  const out: string[] = [];
  let n = 0;
  for (const l of lines.slice(0, -1)) {
    const w = l.split(/\s+/).length;
    if (n && n + w > SHORT_WORDS) break;
    out.push(l); n += w;
  }
  out.push(lines[lines.length - 1]); // the call to action
  return out;
}

/** Each narrated line's start and end in the joined narration, from the padded line files (16-bit stereo at RATE). */
export async function lineWindows(dir: string, files: string[], lines: string[]): Promise<ScriptLine[]> {
  const out: ScriptLine[] = [];
  let at = 0;
  for (const [k, f] of files.entries()) {
    const secs = ((await fs.stat(path.join(dir, f))).size - 44) / (RATE * 2 * 2);
    out.push({ text: lines[k], s: Math.round(at * 100) / 100, e: Math.round((at + Math.max(0.1, secs - GAP)) * 100) / 100 });
    at += secs;
  }
  return out;
}

/** Mark the package as being voiced (refuses a second run while one is under way, or a package that has a recording). */
export async function startFaceless(tenant: string, productionId: string, opts: { voice: string; length: FacelessLength }): Promise<{ lines: number; cents: number }> {
  if (!FACELESS_VOICES.some((v) => v.id === opts.voice)) throw new Error('Pick one of the narrator voices.');
  if (opts.length !== 'short' && opts.length !== 'full') throw new Error('Pick Short or Full.');
  const { data: p } = await db().from('newsroom_productions').select('id, outputs, faceless, vlog_id').eq('id', productionId).eq('tenant_id', tenant).maybeSingle();
  if (!p) throw new Error('That package is gone.');
  if (p.vlog_id) throw new Error('This package already has a recording in Unedit.');
  const f = p.faceless as FacelessState | null;
  if (f?.status === 'voicing' && Date.now() - Date.parse(f.at) < 15 * 60_000) throw new Error('The faceless version is already being made.');
  const lines = narration(p.outputs as Production, opts.length);
  if (lines.length < 2) throw new Error('This package has no script to narrate.');
  const state: FacelessState = { status: 'voicing', voice: opts.voice, length: opts.length, at: new Date().toISOString() };
  await db().from('newsroom_productions').update({ faceless: state }).eq('id', productionId);
  return { lines: lines.length, cents: lines.length * LINE_CENTS };
}

/** Voice the package, render the background with the narration, store it and hand it to Unedit (runs in the background). */
export async function buildFaceless(tenant: string, productionId: string, origin: string, by: string | null): Promise<string> {
  const { data: p } = await db().from('newsroom_productions').select('id, story_id, outputs, faceless').eq('id', productionId).eq('tenant_id', tenant).single();
  const f = p?.faceless as FacelessState | null;
  if (!p || !f || f.status !== 'voicing') return 'Nothing to make.';
  await sweepTmp();
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-faceless-'));
  try {
    const out = p.outputs as Production;
    const lines = narration(out, f.length);
    // 1. The narration: each line in the chosen voice, three at a time, then 48 kHz stereo with air after each line.
    const files: string[] = new Array(lines.length);
    for (let i = 0; i < lines.length; i += 3) {
      await Promise.all(lines.slice(i, i + 3).map(async (line, j) => {
        const k = i + j;
        const wav = await narrate(line, f.voice); // words only: a delivery direction can be read aloud
        await fs.writeFile(path.join(d, `r${k}.wav`), wav);
        await ffmpeg(['-i', `r${k}.wav`, '-af', `aresample=${RATE},apad=pad_dur=${GAP},aformat=channel_layouts=stereo`, '-ac', '2', '-c:a', 'pcm_s16le', `l${k}.wav`], d);
        await fs.rm(path.join(d, `r${k}.wav`), { force: true });
        files[k] = `l${k}.wav`;
      }));
    }
    await fs.writeFile(path.join(d, 'lines.txt'), files.map((x) => `file '${x}'`).join('\n'));
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'lines.txt', '-c', 'copy', 'voice.wav'], d);
    const secs = ((await fs.stat(path.join(d, 'voice.wav'))).size - 44) / (RATE * 2 * 2);
    // Where each line sits (its audio, then GAP of air): the pipeline aligns the transcript to these (alignToScript).
    const script = await lineWindows(d, files, lines);
    // 2. The picture: the Genovus moving background (a slow ink-and-ember gradient sweep with a vignette; no grain: grain on every frame made the file ~30x larger), 1080p30 SDR.
    const bed = `gradients=s=1920x1080:r=30:c0=0x0b0c10:c1=0x2a1206:c2=0x8a3a0e:c3=0x120a1e:x0=0:y0=0:x1=1920:y1=1080:nb_colors=4:speed=0.0012:d=${(secs + 0.5).toFixed(2)},vignette=PI/5,format=yuv420p`;
    await ffmpeg(['-f', 'lavfi', '-i', bed, '-i', 'voice.wav', '-map', '0:v', '-map', '1:a',
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', '30',
      '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', 'faceless.mp4'], d, 780_000);
    const bytes = await fs.readFile(path.join(d, 'faceless.mp4'));
    // 3. Into Unedit: stored as an upload, with the package's sources sheet and the faceless marker.
    const blobPath = `studio/vlogs/uploads/faceless-${productionId.slice(0, 8)}-${Date.now()}.mp4`;
    const blob = await put(blobPath, bytes, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, multipart: true });
    const sha = (x: string | Buffer) => createHash('sha256').update(x).digest('hex');
    const { data: story } = await db().from('newsroom_stories').select('headline').eq('id', p.story_id).maybeSingle();
    const { entries } = parseSheet(String(out.sheet ?? ''));
    const title = `${(story?.headline as string | undefined) ?? 'Newsroom story'} · faceless`.slice(0, 120);
    const { data: v, error } = await db().from('unedit_vlogs').insert({
      tenant_id: tenant, title, file_name: path.basename(blobPath), blob_path: blobPath, blob_url: blob.url, bytes: bytes.length,
      fingerprint: `${bytes.length}:${sha(bytes)}:${sha(`${productionId}:${f.voice}:${f.length}:${f.at}`)}`, created_by: by,
      sources: entries.length ? entries : null, faceless: { voice: f.voice, production: productionId, length: f.length, script },
    }).select('id').single();
    if (error || !v) throw new Error(error?.message ?? 'The recording was not created.');
    await db().rpc('unedit_spend', { p_vlog: v.id, p_cents: lines.length * LINE_CENTS, p_what: `faceless narration, ${lines.length} lines (Gemini voice ${f.voice}, estimate)` });
    await db().from('newsroom_productions').update({ vlog_id: v.id, next_upload: false, faceless: { ...f, status: 'ready', vlog_id: v.id } }).eq('id', productionId);
    await db().from('newsroom_stories').update({ status: 'in_studio', updated_at: new Date().toISOString() }).eq('id', p.story_id);
    await kick(origin, v.id as string);
    return `Faceless ${f.length} made (${Math.round(secs)} s, ${lines.length} lines): recording ${v.id}.`;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await db().from('newsroom_productions').update({ faceless: { ...f, status: 'failed', error: msg } }).eq('id', productionId);
    return `Faceless failed: ${msg}`;
  } finally {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {});
  }
}
