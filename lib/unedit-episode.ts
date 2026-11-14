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
import { matte, matteFilter } from '@/lib/unedit-cutout';

// Seconds per part, by how heavy the source is to decode (an 8K frame is 16 times a 1080p one).
export const partSeconds = (src: { width: number; height: number }) => { const px = src.width * src.height; return px > 16e6 ? 14 : px > 4e6 ? 25 : 45; };
const FPS = 30;
const GOP = FPS * 2;

export type Part = { k: number; segs: Seg[]; status: 'todo' | 'done'; blob?: string; secs?: number; ms?: number };
/** One graphic on the episode's (edited) timeline: T and D in seconds; `off` is where it sits in the rendered reel. */
export type EpGraphic = { T: number; D: number; kind: 'title' | 'lower' | 'chapter' | 'end' | 'cue' | 'kinetic' | 'emphasis'; text: string; sub?: string; n?: number; cue?: Record<string, unknown>; sound: string | null; off?: number;
  /** The style book's style (data/unedit-stylebook.ts); none = the classic look. */ style?: string; layer?: 'front' | 'behind'; /** kinetic: the word drawn in the accent color */ accent?: number; /** left-anchored type: widest it may run (fraction of the frame), so it stops short of the speaker */ maxW?: number };
/** The reel renders in chunks of about REEL_CHUNK_S seconds (one sandbox render each, inside its time limit). */
export type ReelChunk = { from: number; to: number; path?: string };
export type Graphics = { items: EpGraphic[]; reels?: ReelChunk[]; error?: string | null; chapters?: string;
  /** The show package and style-book version it was styled with; `base` is the unstyled plan, so the card can restyle. */
  pkg?: string; stylebook?: string; /** plan the graphics fresh in the next step */ replan?: boolean; base?: Omit<EpGraphic, 'style' | 'layer' | 'off'>[]; notes?: string[]; gl?: boolean;
  /** Chapter changes on the edited timeline: the footage gets a zoom-blur punch there. */ cuts?: number[];
  /** The quality check after the episode is built. */ qa?: { at: string; ok: boolean; issues: string[]; fixed: number; cents: number } };
export const REEL_CHUNK_S = 40;
export type EpisodePlan = { size: { width: number; height: number }; src: { width: number; height: number }; face: Box | null; grade: Grade; parts: number; secs: number; path?: string; at?: string; error?: string | null; sdr?: string; graphics?: Graphics };

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
export async function renderPart(url: string, part: Part, crops: Crop[], plan: Pick<EpisodePlan, 'size' | 'grade' | 'sdr'>, motion?: { p0: number; cuts: number[]; push: { after: number; amount: number } | null }): Promise<{ file: string; dir: string; secs: number }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-ep-'));
  const { width: W, height: H } = plan.size;
  const look = `${plan.sdr ? `${plan.sdr},` : ''}${gradeFilter(plan.grade)},unsharp=5:5:0.3`;
  const shots: string[] = [];
  let at = motion?.p0 ?? 0; // the shot's start on the episode's timeline
  for (const [i, s] of part.segs.entries()) {
    const out = `s${String(i).padStart(3, '0')}.mp4`;
    const d = s.to - s.from;
    const move = motion ? shotMotion(d, motion.cuts.map((c) => c - at).filter((c) => c >= -0.02 && c < d - 0.1), motion.push, W, H) : null;
    at += d;
    await ffmpeg(['-threads', '4', '-ss', s.from.toFixed(3), '-t', d.toFixed(3), '-i', url,
      '-vf', move ? `${cropF(crops[i])},${move},setsar=1,${look},format=yuv420p` : `${cropF(crops[i])},scale=${W}:${H}:flags=lanczos,setsar=1,fps=${FPS},${look},format=yuv420p`, '-an',
      '-c:v', 'libx264', '-threads', '4', '-preset', 'veryfast', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...BT709, '-g', String(GOP), '-video_track_timescale', '15360', out], dir, 600_000);
    shots.push(out);
  }
  await fs.writeFile(path.join(dir, 'shots.txt'), shots.map((f) => `file '${f}'`).join('\n'));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'shots.txt', '-c', 'copy', '-movflags', '+faststart', 'part.mp4'], dir, 300_000);
  for (const f of shots) await fs.rm(path.join(dir, f), { force: true });
  return { file: path.join(dir, 'part.mp4'), dir, secs: part.segs.reduce((a, s) => a + (s.to - s.from), 0) };
}

/** A shot's camera move, as one per-frame scale and a fixed crop (zooming about the speaker's eye line, 38 % down):
 *  a slow push-in across a shot held longer than push.after seconds (so a face shot never sits static), and at a
 *  chapter change a zoom-blur punch (in 8 %, settling over 0.35 s, blurred for its first frames) — the scene change.
 *  Null when the shot needs neither (it keeps the plain scale). */
export function shotMotion(d: number, punches: number[], push: { after: number; amount: number } | null, W: number, H: number): string | null {
  const frames = Math.max(1, Math.round(d * FPS));
  const terms: string[] = [];
  const pushing = Boolean(push && d > push.after);
  if (pushing) terms.push(`${push!.amount}*n/${frames}`);
  const ps = punches.map((c) => Math.max(0, Math.round(c * FPS)));
  for (const p of ps) terms.push(`if(gte(n,${p}),0.08*max(0,1-(n-${p})/10.5),0)`);
  if (!terms.length) return null;
  // Scale ONCE to a frame just big enough for the largest zoom, then animate the zoom from there: the per-frame scale
  // works on a ~1.13× episode frame, never on the 8K source (that ran the part workers out of memory).
  const zmax = 1 + (pushing ? push!.amount : 0) + (ps.length ? 0.08 : 0);
  const Ws = 2 * Math.ceil((W * zmax) / 2), Hs = 2 * Math.ceil((H * zmax) / 2);
  const z = `(1+${terms.join('+')})`;
  const blur = ps.flatMap((p) => [`gblur=sigma=12:enable='between(n,${p},${p + 1})'`, `gblur=sigma=5:enable='between(n,${p + 2},${p + 3})'`]);
  return [`scale=${Ws}:${Hs}:flags=lanczos`, `fps=${FPS}`, `scale=w='2*trunc(${W}*${z}/2)':h=-2:eval=frame:flags=bicubic`, `crop=${W}:${H}:(in_w-${W})/2:(in_h-${H})*0.38`, ...blur].join(',');
}

/** The quietest stretch the edit cut out (a pause, not a false start): the room's own sound, looped under the voice
 *  so the joins never drop to dead digital silence. Null when no gap is quiet enough (under -42 dB). */
async function roomTone(url: string, keep: Span[], dir: string): Promise<{ from: number; to: number } | null> {
  const gaps = keep.slice(1).map((k, i) => ({ from: keep[i].to, to: k.from })).filter((g) => g.to - g.from >= 0.9)
    .sort((a, b) => (b.to - b.from) - (a.to - a.from)).slice(0, 6)
    .map((g) => { const mid = (g.from + g.to) / 2; return { from: mid - 0.3, to: mid + 0.3 }; });
  const vols = await Promise.all(gaps.map(async (g) => {
    const out = await ffmpeg(['-loglevel', 'info', '-ss', g.from.toFixed(3), '-t', '0.6', '-vn', '-i', url, '-af', 'volumedetect', '-f', 'null', '-'], dir, 60_000).catch(() => '');
    const m = out.match(/mean_volume:\s*(-?[\d.]+) dB/);
    return m ? Number(m[1]) : 0;
  }));
  let best = -1;
  vols.forEach((v, i) => { if (v < -42 && (best < 0 || v < vols[best])) best = i; });
  return best >= 0 ? gaps[best] : null;
}

/** The music bed (UNEDIT_MUSIC: a licensed track's Blob path; off when unset): looped to the episode, faded in and
 *  out, and ducked under the voice by a sidechain compressor keyed on the voice. UNEDIT_MUSIC_DB sets its level. */
export const MUSIC = () => (process.env.UNEDIT_MUSIC || '').trim();
const MUSIC_DB = () => Number(process.env.UNEDIT_MUSIC_DB || -22);

/** The soundtrack of everything kept, joined with short fades over room tone, cleaned (rumble, noise, sibilance),
 *  gently leveled and set to -14 LUFS (two passes); then the music bed and the graphics' sounds mix under it and the
 *  final mix is measured again, so it still lands at -14 LUFS. */
export async function soundtrack(url: string, keep: Span[], dir: string, sfx: { at: number; file: string; vol: number }[] = [], music: string | null = null): Promise<string> {
  const n = keep.length;
  const total = keep.reduce((a, k) => a + (k.to - k.from), 0);
  const tone = await roomTone(url, keep, dir).catch(() => null);
  const parts = keep.map((k, i) => {
    const d = k.to - k.from;
    return `[s${i}]atrim=start=${k.from.toFixed(3)}:end=${k.to.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, d - 0.01).toFixed(3)}:d=0.01[k${i}]`;
  });
  const splits = n + (tone ? 1 : 0);
  const clean = 'highpass=f=80,afftdn=nf=-28,deesser=i=0.35:m=0.5:f=0.5,acompressor=threshold=0.1:ratio=2.2:attack=12:release=220:knee=4';
  let graph = `[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit=${splits}${Array.from({ length: splits }, (_, i) => `[s${i}]`).join('')};${parts.join(';')};${keep.map((_, i) => `[k${i}]`).join('')}concat=n=${n}:v=0:a=1,${clean}`;
  if (tone) {
    // The room tone: its own denoise, a little under its real level, looped across the whole episode.
    const len = Math.round((tone.to - tone.from) * 48000);
    graph += `[v];[s${n}]atrim=start=${tone.from.toFixed(3)}:end=${tone.to.toFixed(3)},asetpts=PTS-STARTPTS,highpass=f=80,afftdn=nf=-28,afade=t=in:d=0.05,afade=t=out:st=0.55:d=0.05,volume=0.6,aloop=loop=-1:size=${len},atrim=0:${total.toFixed(3)}[t];[v][t]amix=inputs=2:normalize=0:duration=first`;
  }
  // Pass 1: measure. Pass 2: correct linearly to the measurement (no pumping).
  await ffmpeg(['-vn', '-i', url, '-filter_complex', `${graph}[a]`, '-map', '[a]', '-c:a', 'flac', 'raw.flac'], dir, 600_000);
  const v = await loudness('raw.flac', dir);
  const ln = v
    ? `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${v.input_i}:measured_TP=${v.input_tp}:measured_LRA=${v.input_lra}:measured_thresh=${v.input_thresh}:offset=${v.target_offset}:linear=true`
    : 'loudnorm=I=-14:TP=-1.5:LRA=11';
  await ffmpeg(['-i', 'raw.flac', '-af', `${ln},aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`, '-c:a', 'flac', 'voice.flac'], dir, 300_000);
  await fs.rm(path.join(dir, 'raw.flac'), { force: true });
  const have = [];
  for (const x of sfx) if (await fs.access(x.file).then(() => true, () => false)) have.push(x);
  if (!have.length && !music) {
    await ffmpeg(['-i', 'voice.flac', '-c:a', 'aac', '-b:a', '192k', 'sound.m4a'], dir, 300_000);
    return 'sound.m4a';
  }
  // Under the voice: the graphics' sounds (each delayed to its moment) and the music bed (ducked by the voice).
  const ins = ['-i', 'voice.flac', ...have.flatMap((x) => ['-i', x.file]), ...(music ? ['-stream_loop', '-1', '-i', music] : [])];
  const chains = have.map((x, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${x.vol},adelay=${Math.round(x.at * 1000)}|${Math.round(x.at * 1000)}[f${i}]`);
  const under = have.map((_, i) => `[f${i}]`);
  let voiceOut = '[0:a]';
  if (music) {
    chains.unshift('[0:a]asplit=2[vo][key]');
    voiceOut = '[vo]';
    chains.push(`[${have.length + 1}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},asetpts=PTS-STARTPTS,volume=${MUSIC_DB()}dB,afade=t=in:d=2,afade=t=out:st=${Math.max(0, total - 3).toFixed(3)}:d=3[bed]`,
      '[bed][key]sidechaincompress=threshold=0.02:ratio=6:attack=25:release=450[duck]');
    under.push('[duck]');
  }
  chains.push(`${voiceOut}${under.join('')}amix=inputs=${under.length + 1}:normalize=0:duration=first[mx]`);
  await ffmpeg([...ins, '-filter_complex', chains.join(';'), '-map', '[mx]', '-t', total.toFixed(3), '-c:a', 'flac', 'mix.flac'], dir, 300_000);
  // The mix measured again: a linear trim back to -14 LUFS, a limiter for the peaks.
  const f = await loudness('mix.flac', dir);
  const gain = f ? Math.max(-6, Math.min(6, -14 - Number(f.input_i))) : 0;
  await ffmpeg(['-i', 'mix.flac', '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.89:level=false`, '-c:a', 'aac', '-b:a', '192k', 'mixed.m4a'], dir, 300_000);
  await fs.rm(path.join(dir, 'mix.flac'), { force: true });
  return 'mixed.m4a';
}

async function loudness(file: string, dir: string): Promise<Record<string, string> | null> {
  const m = await ffmpeg(['-loglevel', 'info', '-i', file, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], dir, 300_000);
  const j = m.match(/\{[\s\S]*?"input_i"[\s\S]*?\}/);
  return j ? (JSON.parse(j[0]) as Record<string, string>) : null;
}

/** Join the rendered parts (read from their links, in order) with the soundtrack, streaming the finished episode to
 *  `upload` as fragmented MP4: a long 1440p episode is bigger than a function's scratch disk, so it never lands there. */
export async function assemble(soundUrl: string, keep: Span[], partUrls: string[], upload: (body: ReadableStream<Uint8Array>) => Promise<unknown>, sfx: { at: number; file: string; vol: number }[] = [], music: string | null = null): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-epall-'));
  try {
    const sound = await soundtrack(soundUrl, keep, dir, sfx, music);
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

// ---- the graphics layer ---------------------------------------------------------------------------------------------

/** A moment on the recording, on the episode's edited timeline (null when the edit cut it). */
export function epTime(t: number, keep: Span[]): number | null {
  let off = 0;
  for (const k of keep) {
    if (t >= k.from - 0.05 && t <= k.to + 0.05) return off + Math.min(Math.max(0, t - k.from), k.to - k.from);
    off += k.to - k.from;
  }
  return null;
}

/** Lay the reel out: every graphic back to back (0.1 s apart), in the order the reel renders them, and cut it into
 *  chunks that each end between two graphics. */
export function layReel(items: EpGraphic[]): { items: EpGraphic[]; reels: ReelChunk[] } {
  let at = 0;
  const laid = items.map((g) => { const out = { ...g, off: Math.round(at * 1000) / 1000 }; at += g.D + 0.1; return out; });
  const reels: ReelChunk[] = [];
  for (const g of laid) {
    const last = reels[reels.length - 1];
    if (last && g.off! + g.D - last.from <= REEL_CHUNK_S) last.to = Math.round((g.off! + g.D) * 1000) / 1000;
    else reels.push({ from: g.off!, to: Math.round((g.off! + g.D) * 1000) / 1000 });
  }
  return { items: laid, reels };
}

/** The part's stretches of the reel: each graphic that overlaps the part, where it starts in the part, where to seek
 *  in the reel, and for how long. */
export type Overlay = { start: number; seek: number; len: number; chunk: number; behind: boolean };
export function partOverlays(items: EpGraphic[], reels: ReelChunk[], p0: number, p1: number): Overlay[] {
  return items.filter((g) => g.off != null && g.T < p1 && g.T + g.D > p0).map((g) => {
    const from = Math.max(g.T, p0), to = Math.min(g.T + g.D, p1);
    const chunk = Math.max(0, reels.findIndex((r) => g.off! >= r.from - 0.001 && g.off! < r.to));
    return { chunk, start: Math.round((from - p0) * 1000) / 1000, seek: Math.round((g.off! - reels[chunk].from + (from - g.T)) * 1000) / 1000, len: Math.round((to - from) * 1000) / 1000, behind: g.layer === 'behind' };
  }).filter((o) => o.len > 0.05);
}

const X264 = ['-c:v', 'libx264', '-threads', '4', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...BT709];

/** A behind-the-speaker window: the part's footage with the graphic over it, then the speaker (cut out by the matte)
 *  on top again, rendered as its own short clip that replaces those frames of the part. */
async function behindWindow(dir: string, reelUrl: string, o: Overlay, n: number, size: { width: number; height: number }): Promise<string> {
  const m = await matte(path.join(dir, 'part.mp4'), o.start, o.len, dir, `matte${n}`);
  const out = `win${n}.mp4`;
  await ffmpeg(['-ss', o.start.toFixed(3), '-t', o.len.toFixed(3), '-i', 'part.mp4', '-c:v', 'libvpx', '-ss', o.seek.toFixed(3), '-t', o.len.toFixed(3), '-i', reelUrl, '-i', m,
    '-filter_complex', `[0:v]setpts=PTS-STARTPTS,split=2[a][b];[1:v]format=yuva420p,setpts=PTS-STARTPTS[g];[a][g]overlay=format=auto[bg];${matteFilter('2:v', size.width, size.height, 'm')};[b][m]alphamerge[fg];[bg][fg]overlay=format=auto,format=yuv420p[o]`,
    '-map', '[o]', '-an', ...X264, '-crf', '15', out], dir, 600_000);
  return out;
}

/** Lay the reel's stretches over a rendered part (re-encoded once). The reel is VP8 with alpha, so it is decoded with
 *  libvpx (ffmpeg's own VP8 decoder drops the alpha). A behind graphic (UNEDIT_CUTOUT=on) is first composited under
 *  the cut-out speaker in its own window clip; if that fails, it is laid in front like any other. */
/** Seconds of matting per second of behind graphics, as budgeted (measured ~20 s/s on one core; padded). */
const CUTOUT_S_PER_S = 30;
export async function overlayPart(dir: string, reelUrls: string[], overlays: Overlay[], size?: { width: number; height: number }, cutoutBy = 0): Promise<void> {
  if (!overlays.length) return;
  const inputs: string[] = ['-i', 'part.mp4'];
  const fc: string[] = [];
  let last = '0:v';
  for (const [i, o] of overlays.entries()) {
    let win: string | null = null;
    if (o.behind && size && Date.now() + o.len * CUTOUT_S_PER_S * 1000 < cutoutBy) win = await behindWindow(dir, reelUrls[o.chunk], o, i, size).catch((e) => { console.error(`[unedit] cut-out window ${i}: ${e instanceof Error ? e.message : e}`); return null; });
    if (win) {
      inputs.push('-i', win);
      fc.push(`[${i + 1}:v]setpts=PTS-STARTPTS+${o.start.toFixed(3)}/TB[g${i}]`, `[${last}][g${i}]overlay=eof_action=pass[o${i}]`);
    } else {
      inputs.push('-c:v', 'libvpx', '-ss', o.seek.toFixed(3), '-t', o.len.toFixed(3), '-i', reelUrls[o.chunk]);
      fc.push(`[${i + 1}:v]format=yuva420p,setpts=PTS-STARTPTS+${o.start.toFixed(3)}/TB[g${i}]`, `[${last}][g${i}]overlay=eof_action=pass:format=auto[o${i}]`);
    }
    last = `o${i}`;
  }
  await ffmpeg([...inputs, '-filter_complex', fc.join(';'), '-map', `[${last}]`, '-an', ...X264, '-crf', '19', '-g', String(GOP), '-video_track_timescale', '15360',
    '-movflags', '+faststart', 'graphic.mp4'], dir, 600_000);
  await fs.rename(path.join(dir, 'graphic.mp4'), path.join(dir, 'part.mp4'));
}

/** The episode's effect sounds: each graphic's sound slot at its moment (a riser starts early so it peaks on the word,
 *  a whoosh a little early), from the sound files shipped with the Genovus Motion bundle. */
export function effectSounds(items: EpGraphic[]): { at: number; file: string; vol: number }[] {
  const LEAD: Record<string, number> = { riser: 0.9, whoosh: 0.25 };
  const VOL: Record<string, number> = { hit: 0.42, whoosh: 0.4, riser: 0.36, pop: 0.32, click: 0.4, tick: 0.3, swish: 0.4, sting: 0.34 };
  return items.filter((g) => g.sound && VOL[g.sound] != null).map((g) => ({
    at: Math.max(0, g.T - (LEAD[g.sound!] ?? 0)), vol: VOL[g.sound!],
    file: path.join(process.cwd(), 'remotion/unedit-pro/public/sfx', `${g.sound}.wav`),
  }));
}
