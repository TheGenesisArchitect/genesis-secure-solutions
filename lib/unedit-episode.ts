// Episode Pro's render: the full episode, edited (lib/unedit-edit.ts) and polished (lib/unedit-look.ts). Server only.
// A long take can't render in one function, so the picture renders in parts of about PART_S seconds (one step each,
// video only), then one last step renders the whole soundtrack in a single pass (so levels and joins are seamless),
// joins the parts without re-encoding, and stores the episode.
//   picture   each kept piece: its camera's crop of the source (medium or close-up), scaled with lanczos, graded,
//             lightly sharpened; pieces join on hard cuts (the camera change hides each jump)
//   sound     every kept piece with a 10 ms fade at each join (no clicks), rumble cut, light denoise, then
//             loudness set to YouTube's -14 LUFS with a two-pass loudnorm
import 'server-only';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import ffmpegPath from 'ffmpeg-static';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BT709, ffmpeg, type Span } from '@/lib/unedit-media';
import type { Seg } from '@/lib/unedit-edit';
import { frames } from '@/lib/unedit-media';
import { FILL, faceBoxes, framing, gradeFilter, type Box, type Crop, type Grade } from '@/lib/unedit-look';

// Seconds per part, by how heavy the source is to decode (an 8K frame is 16 times a 1080p one).
export const partSeconds = (src: { width: number; height: number }) => { const px = src.width * src.height; return px > 16e6 ? 14 : px > 4e6 ? 25 : 45; };
const FPS = 30;
const GOP = FPS * 2;

export type Part = { k: number; segs: Seg[]; status: 'todo' | 'done'; blob?: string; secs?: number; ms?: number };
export type EpisodePlan = { size: { width: number; height: number }; src: { width: number; height: number }; face: Box | null; grade: Grade; parts: number; secs: number; path?: string; at?: string; error?: string | null; sdr?: string };

/** Group the camera pieces into parts of about PART_S seconds. Parts break between pieces, never inside one (each
 *  piece is framed once, so a part edge can't re-frame mid-shot); only a piece far longer than a part is split, and
 *  its halves carry the piece's own middle (`mid`) so both are framed from the same still. */
export function partsOf(segs: Seg[], PART_S: number): Part[] {
  const parts: Part[] = [];
  let cur: Seg[] = [];
  let len = 0;
  const close = () => { if (cur.length) parts.push({ k: parts.length, segs: cur, status: 'todo' }); cur = []; len = 0; };
  for (const s0 of segs) {
    const d = s0.to - s0.from;
    if (len > 0 && len + d > PART_S * 1.5) close();
    if (d > PART_S * 2) {
      const mid = Math.round(((s0.from + s0.to) / 2) * 100) / 100;
      for (let f = s0.from; f < s0.to - 0.01;) {
        const to = Math.min(s0.to, Math.round((f + PART_S) * 30) / 30);
        cur.push({ ...s0, from: f, to, mid });
        len += to - f;
        close();
        f = to;
      }
      continue;
    }
    cur.push(s0);
    len += d;
    if (len >= PART_S) close();
  }
  close();
  return parts;
}

const cropF = (c: Crop) => `crop=${c.w}:${c.h}:${c.x}:${c.y}`;

/** Frame every shot in a part on the speaker as they are in that shot: Claude marks the head on a still from the
 *  middle of each shot; a shot where nobody is found uses the recording's usual position. */
export async function shotCrops(url: string, part: Part, plan: Pick<EpisodePlan, 'size' | 'src' | 'face'>): Promise<{ crops: Crop[]; cents: number }> {
  const mids = part.segs.map((s) => s.mid ?? Math.round(((s.from + s.to) / 2) * 100) / 100);
  const stills = await frames(url, mids, 768, true).catch(() => [] as Buffer[]);
  const { boxes, cents } = stills.length === mids.length ? await faceBoxes(stills) : { boxes: mids.map(() => null), cents: 0 };
  return { crops: part.segs.map((s, i) => framing(boxes[i] ?? plan.face, plan.src, plan.size, FILL[s.cam])), cents };
}

/** Render one part's picture (no sound) to a local file. Each shot renders in its own ffmpeg run (one 8K decoder in
 *  memory at a time, threads capped), then the shots join without re-encoding. */
export async function renderPart(url: string, part: Part, crops: Crop[], plan: Pick<EpisodePlan, 'size' | 'grade' | 'sdr'>): Promise<{ file: string; dir: string; secs: number }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-ep-'));
  const { width: W, height: H } = plan.size;
  const look = `${plan.sdr ? `${plan.sdr},` : ''}${gradeFilter(plan.grade)},unsharp=5:5:0.3`;
  const shots: string[] = [];
  for (const [i, s] of part.segs.entries()) {
    const out = `s${String(i).padStart(3, '0')}.mp4`;
    await ffmpeg(['-threads', '4', '-ss', s.from.toFixed(3), '-t', (s.to - s.from).toFixed(3), '-i', url,
      '-vf', `${cropF(crops[i])},scale=${W}:${H}:flags=lanczos,setsar=1,fps=${FPS},${look},format=yuv420p`, '-an',
      '-c:v', 'libx264', '-threads', '4', '-preset', 'veryfast', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...BT709, '-g', String(GOP), '-video_track_timescale', '15360', out], dir, 600_000);
    shots.push(out);
  }
  await fs.writeFile(path.join(dir, 'shots.txt'), shots.map((f) => `file '${f}'`).join('\n'));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'shots.txt', '-c', 'copy', '-movflags', '+faststart', 'part.mp4'], dir, 300_000);
  for (const f of shots) await fs.rm(path.join(dir, f), { force: true });
  return { file: path.join(dir, 'part.mp4'), dir, secs: part.segs.reduce((a, s) => a + (s.to - s.from), 0) };
}

/** The soundtrack of everything kept, joined with short fades, cleaned and set to -14 LUFS (two passes). */
async function soundtrack(url: string, keep: Span[], dir: string): Promise<string> {
  const n = keep.length;
  const parts = keep.map((k, i) => {
    const d = k.to - k.from;
    return `[s${i}]atrim=start=${k.from.toFixed(3)}:end=${k.to.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, d - 0.01).toFixed(3)}:d=0.01[k${i}]`;
  });
  const join = `[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=${n}${keep.map((_, i) => `[s${i}]`).join('')};${parts.join(';')};${keep.map((_, i) => `[k${i}]`).join('')}concat=n=${n}:v=0:a=1,highpass=f=80,afftdn=nf=-28`;
  // Pass 1: measure. Pass 2: correct linearly to the measurement (no pumping).
  await ffmpeg(['-vn', '-i', url, '-filter_complex', `${join}[a]`, '-map', '[a]', '-c:a', 'flac', 'raw.flac'], dir, 600_000);
  const m = await ffmpeg(['-loglevel', 'info', '-i', 'raw.flac', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], dir, 300_000);
  const j = m.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  const v = j ? (JSON.parse(j[0]) as Record<string, string>) : null;
  const ln = v
    ? `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${v.input_i}:measured_TP=${v.input_tp}:measured_LRA=${v.input_lra}:measured_thresh=${v.input_thresh}:offset=${v.target_offset}:linear=true`
    : 'loudnorm=I=-14:TP=-1.5:LRA=11';
  await ffmpeg(['-i', 'raw.flac', '-af', `${ln},aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`, '-c:a', 'aac', '-b:a', '192k', 'sound.m4a'], dir, 300_000);
  await fs.rm(path.join(dir, 'raw.flac'), { force: true });
  return 'sound.m4a';
}

/** Join the rendered parts (read from their links, in order) with the soundtrack, streaming the finished episode to
 *  `upload` as fragmented MP4: a long 1440p episode is bigger than a function's scratch disk, so it never lands there. */
export async function assemble(soundUrl: string, keep: Span[], partUrls: string[], upload: (body: ReadableStream<Uint8Array>) => Promise<unknown>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-epall-'));
  try {
    const sound = await soundtrack(soundUrl, keep, dir);
    // Presigned links carry no quotes; the concat list still escapes any, as the format requires.
    const line = (u: string) => `file '${u.split("'").join("'\\''")}'`;
    await fs.writeFile(path.join(dir, 'parts.txt'), partUrls.map(line).join('\n'));
    const child = spawn(String(ffmpegPath), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-f', 'concat', '-safe', '0', '-i', 'parts.txt', '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-shortest',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', 'pipe:1'], { cwd: dir });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + String(d)).slice(-2000); });
    const exited = new Promise<number>((res) => child.on('close', (code) => res(code ?? 1)));
    await upload(Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>);
    const code = await exited;
    if (code !== 0) throw new Error(`ffmpeg: ${err.trim().split('\n').slice(-2).join(' ').slice(0, 300) || `exit ${code}`}`);
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
