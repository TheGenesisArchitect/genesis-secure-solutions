// Unedit's media work, server only. A one-take vlog can be 1–3 GB, so nothing here loads the recording: ffmpeg
// reads it from a short-lived presigned link (private Blob storage answers Range requests), seeking straight to
// the seconds it needs.
//   probe       duration, displayed size, rotation and codec (for 9:16 framing and the card)
//   audio       a small mono MP3 of the whole talk (about 7 MB for 15 minutes), what transcription receives
//   clip        one 9:16 clip: an optional hook moved to the front, then the moment, framed (a portrait phone
//               recording fills the frame; a landscape one is center-cropped), loudness evened, word-by-word
//               captions burned in with libass in the brand font
//   frames      stills for the thumbnail options
// Runs inside a Vercel function with ffmpeg-static (its Linux build includes libass).
import 'server-only';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { issueSignedToken, presignUrl } from '@vercel/blob';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const FPS = 30;
const W = 1080;
const H = 1920;

export type Word = { w: string; s: number; e: number; c?: number; /** Unedit Pro: the shot's accent word */ a?: boolean };
export type Probe = { duration: number; width: number; height: number; rotation: number; vcodec: string; acodec: string; /** HDR transfer, when the phone shot HDR */ hdr?: 'hlg' | 'pq' | null };
export type Span = { from: number; to: number };

/** A presigned GET link to a private blob (Range works), valid for `mins` (Blob allows just under 7 days). */
export async function presigned(pathname: string, mins = 120): Promise<string> {
  const until = Date.now() + Math.min(mins, 6 * 24 * 60) * 60_000;
  const tok = await issueSignedToken({ pathname, operations: ['get'], validUntil: until });
  return (await presignUrl(tok, { operation: 'get', pathname, access: 'private', validUntil: until })).presignedUrl;
}

export async function ffmpeg(args: string[], cwd?: string, timeoutMs = 600_000): Promise<string> {
  try {
    const { stderr } = await run(String(ffmpegPath), ['-nostdin', '-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
    return String(stderr);
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`ffmpeg: ${String(err.stderr || err.message || 'failed').trim().split('\n').slice(-3).join(' ').slice(0, 300)}`);
  }
}

let zscale: Promise<boolean> | null = null;
/** Phones shoot HDR (HLG or PQ, BT.2020). Treated as ordinary video it looks flat and yellow, so every picture made
 *  from an HDR recording is tone-mapped to standard color (BT.709) first, before any grade. HLG's reference white is
 *  203 nits. Empty when the source is SDR or this ffmpeg lacks zscale (then the picture is left as it was). */
export async function toSdr(hdr: Probe['hdr']): Promise<string> {
  if (!hdr) return '';
  zscale ??= run(String(ffmpegPath), ['-hide_banner', '-filters'], { maxBuffer: 4 * 1024 * 1024, timeout: 30_000 }).then((r) => / zscale /.test(String(r.stdout)), () => false);
  if (!(await zscale)) return '';
  return 'zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
}
/** Tags for an encode made from tone-mapped (or ordinary) video: standard BT.709 color. */
export const BT709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

/** What the recording is: read from its header over the network (ffmpeg -i prints it and exits). */
export async function probe(url: string): Promise<Probe> {
  const out = await run(String(ffmpegPath), ['-hide_banner', '-i', url], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 })
    .then((r) => String(r.stderr)).catch((e: { stderr?: string }) => String(e.stderr ?? ''));
  const dur = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const v = out.match(/Stream #[^\n]*Video:\s*([a-z0-9_]+)[^\n]*?\s(\d{2,5})x(\d{2,5})/);
  const a = out.match(/Stream #[^\n]*Audio:\s*([a-z0-9_]+)/);
  const rot = out.match(/rotation of (-?\d+(?:\.\d+)?) degrees/) ?? out.match(/rotate\s*:\s*(-?\d+)/);
  if (!dur || !v) throw new Error(`Couldn't read the video${/Invalid data|moov atom not found/i.test(out) ? ' (the file looks incomplete)' : ''}.`);
  const rotation = rot ? ((Math.round(Number(rot[1])) % 360) + 360) % 360 : 0;
  const [w, h] = [Number(v[2]), Number(v[3])];
  const turned = rotation === 90 || rotation === 270;
  return {
    duration: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
    width: turned ? h : w, height: turned ? w : h, rotation,
    vcodec: v[1], acodec: a?.[1] ?? '',
    hdr: /arib-std-b67/.test(v[0]) ? 'hlg' : /smpte2084/.test(v[0]) ? 'pq' : null,
  };
}

/** The talk as a small mono MP3 (16 kHz, 48 kbps): what transcription receives instead of the video. */
export async function extractAudio(url: string): Promise<Buffer>;
export async function extractAudio(url: string, hq: true): Promise<{ mp3: Buffer; m4a: Buffer }>;
/** With hq: also the talk at full quality (48 kHz stereo AAC), read in the same pass, for the episode's soundtrack. */
export async function extractAudio(url: string, hq?: boolean): Promise<Buffer | { mp3: Buffer; m4a: Buffer }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-audio-'));
  try {
    const out = path.join(dir, 'talk.mp3');
    const full = path.join(dir, 'talk.m4a');
    await ffmpeg(['-i', url, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', out,
      ...(hq ? ['-map', '0:a:0', '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', full] : [])], undefined, 700_000);
    return hq ? { mp3: await fs.readFile(out), m4a: await fs.readFile(full) } : await fs.readFile(out);
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// ---- captions ----------------------------------------------------------------------------------------------
const FONT = 'Archivo SemiBold Expanded ExtraBold';
const assTime = (t: number) => { const cs = Math.max(0, Math.round(t * 100)); const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const assText = (t: string) => t.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
// Unedit Pro's accent word: Genovus orange (#FF6A2B, BGR in ASS) before and after it is spoken, a touch larger, and in
// italic serif when lib/fonts carries Instrument Serif Italic (open source, OFL); else the brand face in orange.
const ACCENT_TTF = 'instrument-serif-italic.ttf';
const ACCENT = '&H002B6AFF&';
const accentText = (t: string, serif: boolean) => serif
  ? `{\\fnInstrument Serif\\i1\\fs112\\1c${ACCENT}\\2c${ACCENT}}${t.replace(/[{}\\]/g, '').trim().toLowerCase()}{\\r}`
  : `{\\fs96\\1c${ACCENT}\\2c${ACCENT}}${assText(t)}{\\r}`;

/** Word-by-word captions: phrases of up to 3 words (a new phrase after a sentence end or a pause), each word lighting
 *  up as it is spoken (karaoke timing), in the brand display face with an outline that reads on any background. */
export function captionsAss(words: Word[], serif = false): string {
  const phrases: Word[][] = [];
  let cur: Word[] = [];
  for (const [i, w] of words.entries()) {
    const prev = words[i - 1];
    const brk = cur.length >= 3 || (prev && (/[.!?]$/.test(prev.w) || w.s - prev.e > 0.6));
    if (cur.length && brk) { phrases.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) phrases.push(cur);
  const lines = phrases.map((p, i) => {
    const t0 = p[0].s;
    const next = phrases[i + 1]?.[0].s ?? Infinity;
    const t1 = Math.min(Math.max(p[p.length - 1].e + 0.25, t0 + 0.5), next);
    // \k durations in centiseconds, from each word's start to the next word's start (the last runs to the line end).
    const ks = p.map((w, k) => `{\\k${Math.max(1, Math.round(((k + 1 < p.length ? p[k + 1].s : t1) - (k ? w.s : t0)) * 100))}}${w.a ? accentText(w.w, serif) : assText(w.w)}`);
    return `Dialogue: 0,${assTime(t0)},${assTime(t1)},Cap,,0,0,0,,${ks.join(' ')}`;
  });
  return [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Spoken words turn Genovus gold (&H001AA3FF is #FFA31A in ASS's BGR order); the rest wait in white.
    `Style: Cap,${FONT},86,&H001AA3FF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,0,0,1,7,3,2,90,90,560,1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...lines, '',
  ].join('\n');
}

/** Words that fall inside the spans, re-timed onto the clip's own timeline (spans play back to back). */
export function wordsForSpans(words: Word[], spans: Span[]): Word[] {
  const out: Word[] = [];
  let offset = 0;
  for (const sp of spans) {
    for (const w of words) if (w.s >= sp.from - 0.05 && w.e <= sp.to + 0.05) out.push({ ...w, s: Math.max(0, w.s - sp.from) + offset, e: Math.max(0, Math.min(w.e, sp.to) - sp.from) + offset });
    offset += sp.to - sp.from;
  }
  return out;
}

/** Copies the caption fonts next to the subtitles; true when the serif accent face is available. */
async function fontsDir(dir: string): Promise<boolean> {
  const fd = path.join(dir, 'fonts');
  await fs.mkdir(fd);
  await fs.copyFile(path.join(process.cwd(), 'lib/fonts/archivo-expanded-800.ttf'), path.join(fd, 'archivo-expanded-800.ttf'));
  return fs.copyFile(path.join(process.cwd(), 'lib/fonts', ACCENT_TTF), path.join(fd, ACCENT_TTF)).then(() => true, () => false);
}

/** Punch-in on accent words: the frame eases to 107% as the word starts and back out after it (at most 12 per clip,
 *  windows on the clip's own timeline). An ffmpeg expression for the scale factor, or null when there are none. */
export function zoomExpr(words: Word[]): string | null {
  const wins: [number, number][] = [];
  for (const w of words) {
    if (!w.a) continue;
    const a = Math.max(0, w.s - 0.05), b = w.e + 0.6;
    const last = wins[wins.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else wins.push([a, b]);
  }
  if (!wins.length) return null;
  // Commas inside a filter option are escaped for the filtergraph parser.
  const terms = wins.slice(0, 12).map(([a, b]) => `clip((t-${a.toFixed(2)})/0.2\\,0\\,1)*clip((${b.toFixed(2)}-t)/0.3\\,0\\,1)`);
  return `1+0.07*${terms.reduce((acc, t) => (acc ? `max(${acc}\\,${t})` : t), '')}`;
}

/** Render one 9:16 clip from the recording to a local MP4 (the caller stores it). Spans play in order: a hook
 *  span first when the moment was rebuilt to open on its strongest line. */
/** opts.crop: Episode Pro's face-aware 9:16 rectangle of a landscape source; opts.grade: its color filter. */
export async function renderClip(url: string, spans: Span[], words: Word[], src: Probe, opts: { accents?: number[]; captions?: boolean; crop?: { w: number; h: number; x: number; y: number } | null; grade?: string | null; sdr?: string | null } = {}): Promise<{ file: string; dir: string; secs: number }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-clip-'));
  const serif = await fontsDir(dir);
  // Accent words are marked by their index in the whole transcript, before the words are re-timed onto the clip.
  const marks = new Set(opts.accents ?? []);
  const timed = wordsForSpans(marks.size ? words.map((w, i) => (marks.has(i) ? { ...w, a: true } : w)) : words, spans);
  // Unedit Pro's graphics pass draws its own captions over a clean cut (captions: false).
  const captions = opts.captions !== false;
  if (captions) await fs.writeFile(path.join(dir, 'c.ass'), captionsAss(timed, serif));
  const zoom = zoomExpr(timed);
  const portrait = src.height >= src.width;
  // Portrait phone video fills 9:16; landscape is center-cropped (a talking head sits in the middle).
  const c = opts.crop;
  const frame = (c && !portrait
    ? `crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${W}:${H}:flags=lanczos`
    : portrait
      ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`
      : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`) + (opts.sdr ? `,${opts.sdr}` : '') + (opts.grade ? `,${opts.grade}` : '');
  // Piece by piece: each span decodes alone (an 8K HDR decoder is large; several at once ran a function out of
  // memory), framed, tone-mapped and graded at 1080×1920 into a near-lossless intermediate with PCM sound, so the
  // pieces join without a gap or a click. One light pass then adds the punch-ins, captions and loudness.
  const pieces: string[] = [];
  for (const [i, sp] of spans.entries()) {
    const out = `p${String(i).padStart(3, '0')}.mkv`;
    await ffmpeg(['-threads', '3', '-ss', sp.from.toFixed(3), '-t', (sp.to - sp.from).toFixed(3), '-i', url,
      '-vf', `${frame},setsar=1,fps=${FPS},format=yuv420p`, '-af', 'aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo',
      '-c:v', 'libx264', '-threads', '3', '-preset', 'veryfast', '-crf', '12', '-c:a', 'pcm_s16le', out], dir);
    pieces.push(out);
  }
  await fs.writeFile(path.join(dir, 'pieces.txt'), pieces.map((f) => `file '${f}'`).join('\n'));
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'pieces.txt', '-c', 'copy', 'joined.mkv'], dir);
  for (const f of pieces) await fs.rm(path.join(dir, f), { force: true });
  const punch = zoom ? `scale=w='2*trunc(${W}*(${zoom})/2)':h='2*trunc(${H}*(${zoom})/2)':eval=frame,crop=${W}:${H},` : '';
  const fc = [`[0:v]${punch}${captions ? 'ass=c.ass:fontsdir=fonts' : 'null'}[v]`, '[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a]'];
  const secs = spans.reduce((a, s) => a + (s.to - s.from), 0);
  await ffmpeg(['-i', 'joined.mkv', '-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', ...(opts.sdr ? BT709 : []), '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'clip.mp4'], dir);
  await fs.rm(path.join(dir, 'joined.mkv'), { force: true });
  return { file: path.join(dir, 'clip.mp4'), dir, secs };
}

/** Stills from the recording at the given seconds, as JPEGs (width `w`, height kept in proportion). */
export async function frames(url: string, at: number[], w = 1280, fast = false, pre = ''): Promise<Buffer[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-frames-'));
  try {
    const out: Buffer[] = [];
    for (const [i, t] of at.entries()) {
      const f = path.join(dir, `f${i}.jpg`);
      // fast: the nearest keyframe after t (no decoding up to the exact frame), for sampling large recordings.
      await ffmpeg([...(fast ? ['-skip_frame', 'nokey'] : []), '-ss', Math.max(0, t).toFixed(2), '-i', url, '-frames:v', '1', '-vf', `${pre ? `${pre},` : ''}scale=${w}:-2`, '-q:v', '3', f], undefined, 90_000);
      out.push(await fs.readFile(f));
    }
    return out;
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
