// Episode Pro's look: where the speaker's face is, and the grade for this recording. Server only.
//   face    Claude marks the speaker's head (top of hair or hat to chin) on six stills from the kept talk; the median
//           box frames every shot: a medium shot and a close-up for the episode, and a 9:16 crop for the clips, with
//           the eyes near the upper third and never past what the source resolution holds sharp.
//   grade   measured, not guessed: ffmpeg's signalstats on the same stills gives the color cast (U/V away from
//           neutral), the face's brightness and the saturation; each turns into one bounded correction (a partial
//           white balance, a midtone lift for the face, a saturation trim). The bounds keep it a polish, never a look.
// One grade is used for the episode, the clips and the thumbnails, so everything from one take matches.
import 'server-only';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { frames, type Span } from '@/lib/unedit-media';

export type Box = { x: number; y: number; w: number; h: number }; // fractions of the displayed frame
export type Grade = { temp: number; mix: number; lift: number; sat: number; contrast: number };
export type Look = { face: Box | null; grade: Grade; stats: { warmth: number; faceY: number | null; sat: number }; cents: number; /** the HDR-to-standard tone-map, when the source is HDR */ sdr: string };
export type Crop = { w: number; h: number; x: number; y: number };

const MODEL = () => (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5').trim();
const BASE = () => (process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com').replace(/\/$/, '');
const PRICE = { in: 300, out: 1500 };
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const even = (x: number) => Math.max(2, 2 * Math.round(x / 2));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/** How much of the frame's height the head takes, per framing (top of the hat to the chin). */
export const FILL = { medium: 0.6, close: 0.82, clip: 0.62 } as const;

export const NEUTRAL: Grade = { temp: 6500, mix: 0, lift: 0, sat: 1, contrast: 1.03 };

/** The ffmpeg filter for a grade (apply after scaling, before captions). */
export function gradeFilter(g: Grade): string {
  const lift = clamp(g.lift, 0, 0.07);
  const curves = `curves=master='0/0.01 0.22/${(0.22 + lift).toFixed(3)} 0.5/${(0.5 + lift * 0.6).toFixed(3)} 0.85/0.865 1/0.985'`;
  const wb = g.mix > 0 ? `colortemperature=temperature=${Math.round(g.temp)}:mix=${g.mix.toFixed(2)},` : '';
  return `${wb}${curves},eq=contrast=${g.contrast.toFixed(3)}:saturation=${g.sat.toFixed(3)}`;
}

/** Times to sample: six points spread over what the edit keeps (the talk, not the walk-up or walk-off). */
export function sampleTimes(keep: Span[], n = 6): number[] {
  const total = keep.reduce((a, k) => a + (k.to - k.from), 0);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let want = ((i + 0.5) / n) * total;
    for (const k of keep) { const d = k.to - k.from; if (want <= d) { out.push(Math.round((k.from + want) * 100) / 100); break; } want -= d; }
  }
  return out;
}

async function stats(file: string, crop?: Box): Promise<{ y: number; u: number; v: number; sat: number }> {
  const vf = `${crop ? `crop=iw*${crop.w.toFixed(3)}:ih*${crop.h.toFixed(3)}:iw*${crop.x.toFixed(3)}:ih*${crop.y.toFixed(3)},` : ''}signalstats,metadata=print:file=-`;
  // metadata=print writes the values to stdout.
  const txt: string = await new Promise((res) => execFile(String(ffmpegPath), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', file, '-vf', vf, '-f', 'null', '-'], { maxBuffer: 8 * 1024 * 1024, timeout: 60_000 }, (_e, so) => res(String(so ?? ''))));
  const val = (k: string) => Number(txt.match(new RegExp(`lavfi\.signalstats\.${k}=([0-9.]+)`))?.[1] ?? NaN);
  return { y: val('YAVG'), u: val('UAVG'), v: val('VAVG'), sat: val('SATAVG') };
}

/** Claude marks the speaker's head on each still; null where nobody is in frame. */
export async function faceBoxes(stills: Buffer[]): Promise<{ boxes: (Box | null)[]; cents: number }> {
  const k = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!k || !stills.length) return { boxes: stills.map(() => null), cents: 0 };
  const content = [
    ...stills.flatMap((b, i) => [{ type: 'text', text: `Still ${i}:` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b.toString('base64') } }]),
    { type: 'text', text: 'For each still, mark the main speaker\'s head: the box from the very top of the hair or hat down to the chin, left ear to right ear, as fractions of the image width and height (0 to 1, from the top-left corner). If no person is in frame, use null. Return only JSON: {"boxes":[{"x":0.41,"y":0.02,"w":0.18,"h":0.33}, null, ...]} with one entry per still, in order.' },
  ];
  try {
    const r = await fetch(`${BASE()}/v1/messages`, {
      method: 'POST', headers: { 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 1500, messages: [{ role: 'user', content }] }), signal: AbortSignal.timeout(120_000),
    });
    const j = (await r.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const cents = Math.ceil(((j.usage?.input_tokens ?? 0) * PRICE.in + (j.usage?.output_tokens ?? 0) * PRICE.out) / 1_000_000);
    if (!r.ok) return { boxes: stills.map(() => null), cents };
    const m = (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').match(/\{[\s\S]*\}/);
    const raw = m ? ((JSON.parse(m[0]) as { boxes?: unknown[] }).boxes ?? []) : [];
    const boxes = stills.map((_, i) => {
      const b = raw[i] as Partial<Box> | null | undefined;
      if (!b || typeof b !== 'object') return null;
      const box = { x: Number(b.x), y: Number(b.y), w: Number(b.w), h: Number(b.h) };
      return Object.values(box).every((n) => Number.isFinite(n)) && box.w > 0.02 && box.h > 0.03 && box.x >= -0.05 && box.y >= -0.05 && box.x + box.w <= 1.05 && box.y + box.h <= 1.05 ? box : null;
    });
    return { boxes, cents };
  } catch { return { boxes: stills.map(() => null), cents: 0 }; }
}

/** Measure the recording: the speaker's usual face position (a fallback; each shot is framed on its own) and the grade. */
export async function analyzeLook(url: string, keep: Span[], sdr = ''): Promise<Look> {
  const at = sampleTimes(keep);
  // Measured on tone-mapped stills, so the grade corrects what the viewer will actually see.
  const stills = await frames(url, at, 1024, true, sdr);
  const { boxes, cents } = await faceBoxes(stills);
  const found = boxes.filter((b): b is Box => b != null);
  const face = found.length >= 2 ? { x: median(found.map((b) => b.x)), y: median(found.map((b) => b.y)), w: median(found.map((b) => b.w)), h: median(found.map((b) => b.h)) } : null;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-look-'));
  try {
    const whole: { y: number; u: number; v: number; sat: number }[] = [];
    const faceY: number[] = [];
    for (const [i, b] of stills.entries()) {
      const f = path.join(dir, `s${i}.jpg`);
      await fs.writeFile(f, b);
      whole.push(await stats(f));
      const fb = boxes[i];
      // The face's own brightness, from its middle (skin, not the hat or the background).
      if (fb) faceY.push((await stats(f, { x: fb.x + fb.w * 0.2, y: fb.y + fb.h * 0.35, w: fb.w * 0.6, h: fb.h * 0.45 })).y);
    }
    const ok = whole.filter((s) => Number.isFinite(s.u) && Number.isFinite(s.v));
    const warmth = ok.length ? median(ok.map((s) => (s.v - 128) - (s.u - 128))) : 0;
    const sat = ok.length ? median(ok.map((s) => s.sat)) : 40;
    const fy = faceY.filter(Number.isFinite).length ? median(faceY.filter(Number.isFinite)) : null;
    const grade: Grade = {
      // A warm (yellow/orange) or cool cast is pulled partway back to neutral: walls and light keep their character.
      temp: 6500 + clamp(warmth * 22, -900, 900),
      mix: Math.abs(warmth) < 4 ? 0 : clamp(Math.abs(warmth) / 80, 0.15, 0.4),
      // A face darker than it reads on a phone gets a midtone lift; a bright one gets none.
      lift: fy == null ? 0.015 : clamp(((105 - fy) / 255) * 0.6, 0, 0.06),
      sat: sat > 55 ? 0.92 : sat < 22 ? 1.08 : 0.97,
      contrast: 1.04,
    };
    return { sdr, face, grade, stats: { warmth: Math.round(warmth * 10) / 10, faceY: fy == null ? null : Math.round(fy), sat: Math.round(sat) }, cents };
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

/** The source rectangle for one framing. `aspect` is width/height of the output; `fill` is how much of the crop's
 *  height the head should take (FILL.medium, FILL.close, FILL.clip). Never smaller than
 *  the output size divided by `maxUp` (so a close-up stays sharp), never outside the frame. Without a face: centered. */
export function framing(face: Box | null, src: { width: number; height: number }, out: { width: number; height: number }, fill: number, maxUp = 1.1): Crop {
  const aspect = out.width / out.height;
  const fit = (h: number) => { let ch = Math.min(h, src.height); let cw = ch * aspect; if (cw > src.width) { cw = src.width; ch = cw / aspect; } return { cw, ch }; };
  const floorH = Math.min(src.height, out.height / maxUp, (src.width / aspect));
  if (!face) {
    const { cw, ch } = fit(Math.max(floorH, src.height * (fill >= 0.55 ? 0.8 : 1)));
    return { w: even(cw), h: even(ch), x: even((src.width - cw) / 2), y: even(Math.max(0, (src.height - ch) * 0.3)) };
  }
  const headH = face.h * src.height;
  const { cw, ch } = fit(Math.max(floorH, headH / fill));
  const cx = (face.x + face.w / 2) * src.width;
  const eyes = (face.y + face.h * 0.45) * src.height;
  const x = clamp(cx - cw / 2, 0, src.width - cw);
  const y = clamp(eyes - ch * 0.38, 0, src.height - ch);
  return { w: even(cw), h: even(ch), x: even(x), y: even(y) };
}

/** The episode's output size: the source's shape, at 1440 lines when the source has them (else its own size). */
export function episodeSize(src: { width: number; height: number }): { width: number; height: number } {
  const want = Number(process.env.UNEDIT_EPISODE_LINES || 1440);
  const short = Math.min(src.width, src.height);
  const lines = short >= want ? want : short >= 1080 ? 1080 : short;
  return src.width >= src.height ? { width: even((lines * src.width) / src.height), height: even(lines) } : { width: even(lines), height: even((lines * src.height) / src.width) };
}
