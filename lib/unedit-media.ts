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

export type Word = { w: string; s: number; e: number; c?: number };
export type Probe = { duration: number; width: number; height: number; rotation: number; vcodec: string; acodec: string };
export type Span = { from: number; to: number };

/** A presigned GET link to a private blob (Range works), valid for `mins` (Blob allows just under 7 days). */
export async function presigned(pathname: string, mins = 120): Promise<string> {
  const until = Date.now() + Math.min(mins, 6 * 24 * 60) * 60_000;
  const tok = await issueSignedToken({ pathname, operations: ['get'], validUntil: until });
  return (await presignUrl(tok, { operation: 'get', pathname, access: 'private', validUntil: until })).presignedUrl;
}

async function ffmpeg(args: string[], cwd?: string, timeoutMs = 600_000): Promise<string> {
  try {
    const { stderr } = await run(String(ffmpegPath), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { cwd, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs });
    return String(stderr);
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    throw new Error(`ffmpeg: ${String(err.stderr || err.message || 'failed').trim().split('\n').slice(-3).join(' ').slice(0, 300)}`);
  }
}

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
  };
}

/** The talk as a small mono MP3 (16 kHz, 48 kbps): what transcription receives instead of the video. */
export async function extractAudio(url: string): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-audio-'));
  try {
    const out = path.join(dir, 'talk.mp3');
    await ffmpeg(['-i', url, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '48k', out], undefined, 700_000);
    return await fs.readFile(out);
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

// ---- captions ----------------------------------------------------------------------------------------------
const FONT = 'Archivo SemiBold Expanded ExtraBold';
const assTime = (t: number) => { const cs = Math.max(0, Math.round(t * 100)); const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const assText = (t: string) => t.replace(/[{}\\]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

/** Word-by-word captions: phrases of up to 3 words (a new phrase after a sentence end or a pause), each word lighting
 *  up as it is spoken (karaoke timing), in the brand display face with an outline that reads on any background. */
export function captionsAss(words: Word[]): string {
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
    const ks = p.map((w, k) => `{\\k${Math.max(1, Math.round(((k + 1 < p.length ? p[k + 1].s : t1) - (k ? w.s : t0)) * 100))}}${assText(w.w)}`);
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

async function fontsDir(dir: string) {
  const fd = path.join(dir, 'fonts');
  await fs.mkdir(fd);
  await fs.copyFile(path.join(process.cwd(), 'lib/fonts/archivo-expanded-800.ttf'), path.join(fd, 'archivo-expanded-800.ttf'));
}

/** Render one 9:16 clip from the recording to a local MP4 (the caller stores it). Spans play in order: a hook
 *  span first when the moment was rebuilt to open on its strongest line. */
export async function renderClip(url: string, spans: Span[], words: Word[], src: Probe): Promise<{ file: string; dir: string; secs: number }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-clip-'));
  await fontsDir(dir);
  await fs.writeFile(path.join(dir, 'c.ass'), captionsAss(wordsForSpans(words, spans)));
  const portrait = src.height >= src.width;
  // Portrait phone video fills 9:16; landscape is center-cropped (a talking head sits in the middle).
  const frame = portrait
    ? `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`
    : `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  const inputs: string[] = [];
  const fc: string[] = [];
  spans.forEach((sp, i) => {
    inputs.push('-ss', sp.from.toFixed(3), '-t', (sp.to - sp.from).toFixed(3), '-i', url);
    fc.push(`[${i}:v]${frame},setsar=1,fps=${FPS},format=yuv420p[v${i}]`, `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
  });
  fc.push(`${spans.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${spans.length}:v=1:a=1[vc][ac]`);
  fc.push('[vc]ass=c.ass:fontsdir=fonts[v]', '[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]');
  const secs = spans.reduce((a, s) => a + (s.to - s.from), 0);
  await ffmpeg([...inputs, '-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'clip.mp4'], dir);
  return { file: path.join(dir, 'clip.mp4'), dir, secs };
}

/** Stills from the recording at the given seconds, as JPEGs (width `w`, height kept in proportion). */
export async function frames(url: string, at: number[], w = 1280): Promise<Buffer[]> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-frames-'));
  try {
    const out: Buffer[] = [];
    for (const [i, t] of at.entries()) {
      const f = path.join(dir, `f${i}.jpg`);
      await ffmpeg(['-ss', Math.max(0, t).toFixed(2), '-i', url, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '3', f], undefined, 90_000);
      out.push(await fs.readFile(f));
    }
    return out;
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
