// The episode render (StudioNext v3): the canonical timeline (lib/studio-timeline.ts) → a finished MP4, 16:9
// (1920×1080) or 9:16 for Shorts (1080×1920).
//   Picture   each shot's take or Screen Library clips at 30 fps, held on its last frame if it runs short. In 9:16,
//             cast takes are center-cropped (faces are framed in the center third), portrait phone screens fill the
//             frame, and wide screens sit over a soft blurred fill. Code cards and captions are drawn with the brand
//             fonts (the same renderer as the thumbnails) and composited, so ffmpeg itself needs no fonts
//   Sound     every dialogue read placed at its time over the score, which ducks under speech
// Runs inside a Vercel function with a bundled ffmpeg (ffmpeg-static). Server only.
import 'server-only';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement as h } from 'react';
import { ImageResponse } from 'next/og';
import { get, put } from '@vercel/blob';
import ffmpegPath from 'ffmpeg-static';
import { adminDb } from '@/lib/supabase/admin';
import type { Cut, CutItem } from '@/lib/studio-timeline';

const run = promisify(execFile);
const FPS = 30;
export type RenderFormat = 'wide' | 'vertical';
type Dim = { w: number; h: number; tall: boolean };
const DIMS: Record<RenderFormat, Dim> = { wide: { w: 1920, h: 1080, tall: false }, vertical: { w: 1080, h: 1920, tall: true } };
const ffmpeg = async (args: string[]) => { await run(String(ffmpegPath), ['-y', '-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 64 * 1024 * 1024 }); };

let fonts: { display: Buffer; body: Buffer; egg: string } | null = null;
async function brand() {
  if (fonts) return fonts;
  const root = process.cwd();
  const [display, body, egg] = await Promise.all([
    fs.readFile(path.join(root, 'lib/fonts/archivo-expanded-800.woff')),
    fs.readFile(path.join(root, 'lib/fonts/inter-600.woff')),
    fs.readFile(path.join(root, 'public/brand/genovus/genovus-egg.svg')),
  ]);
  fonts = { display, body, egg: `data:image/svg+xml;base64,${egg.toString('base64')}` };
  return fonts;
}
async function png(el: ReturnType<typeof h>, file: string, d: Dim) {
  const f = await brand();
  const res = new ImageResponse(el, { width: d.w, height: d.h, fonts: [{ name: 'Genovus Display', data: f.display, weight: 800 }, { name: 'Inter', data: f.body, weight: 600 }] });
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
}
/** A code card: the title in Genovus Display on black, the egg above it (end cards add the wordmark line). */
const cardEl = (title: string, end: boolean, egg: string, d: Dim) => h('div', { style: { width: d.w, height: d.h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#050608', gap: 36, padding: 60 } },
  h('img', { src: egg, width: 84, height: 108 }),
  h('div', { style: { display: 'flex', fontFamily: 'Genovus Display', fontSize: d.tall ? (title.length > 14 ? 76 : 96) : title.length > 26 ? 78 : 96, color: '#fff', textTransform: 'uppercase', letterSpacing: 4, textAlign: 'center', maxWidth: d.w - 160, lineHeight: 1.05 } }, title),
  end ? h('div', { style: { display: 'flex', fontFamily: 'Inter', fontSize: 34, color: '#ffd38a', letterSpacing: 8 } }, 'GENOVUS JUST KNOWS') : null);
/** The package end card: Helix's promise, the three packages (no prices) and where to take the tour. */
export const PACKAGES = [
  { name: 'Launch', line: 'Get found. Answer every lead.' },
  { name: 'Growth', line: 'Helix joins your team.' },
  { name: 'Premium', line: 'Run it hands-free.' },
];
const packagesEl = (title: string, egg: string, d: Dim) => h('div', { style: { width: d.w, height: d.h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle at 50% 38%, #2a160a 0%, #07080b 62%)', gap: d.tall ? 56 : 44, padding: d.tall ? 80 : 60 } },
  h('img', { src: egg, width: d.tall ? 96 : 72, height: d.tall ? 124 : 92 }),
  h('div', { style: { display: 'flex', fontFamily: 'Genovus Display', fontSize: d.tall ? 64 : 58, color: '#fff', textAlign: 'center', maxWidth: d.tall ? 900 : 1500, lineHeight: 1.08, letterSpacing: 1 } }, title),
  h('div', { style: { display: 'flex', flexDirection: d.tall ? 'column' : 'row', gap: d.tall ? 26 : 28 } },
    ...PACKAGES.map((p) => h('div', { key: p.name, style: { display: 'flex', flexDirection: 'column', gap: 10, width: d.tall ? 760 : 400, padding: '30px 34px', borderRadius: 26, border: '2px solid rgba(255,138,76,0.55)', background: 'rgba(12,13,18,0.82)' } },
      h('div', { style: { display: 'flex', fontFamily: 'Genovus Display', fontSize: 46, color: '#fff' } }, p.name),
      h('div', { style: { display: 'flex', fontFamily: 'Inter', fontSize: 28, color: '#d8d2c8' } }, p.line),
      h('div', { style: { display: 'flex', fontFamily: 'Inter', fontSize: 24, color: '#ff9a4d', letterSpacing: 3 } }, 'TAKE THE TOUR →')))),
  h('div', { style: { display: 'flex', fontFamily: 'Inter', fontSize: d.tall ? 34 : 30, color: '#ffd38a', letterSpacing: 6 } }, 'ASK HELIX · GENOVUS.IO/TOUR'));
/** A caption: the line on a soft dark band near the bottom (higher in 9:16, clear of the apps' own controls). */
const captionEl = (text: string, d: Dim) => h('div', { style: { width: d.w, height: d.h, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: d.tall ? 360 : 72, paddingLeft: 60, paddingRight: 60 } },
  h('div', { style: { display: 'flex', maxWidth: d.tall ? 960 : 1500, padding: '14px 28px', borderRadius: 14, background: 'rgba(0,0,0,0.62)', fontFamily: 'Inter', fontSize: d.tall ? 48 : 44, color: '#fff', textAlign: 'center', lineHeight: 1.25 } }, text));

/** Where a timeline source lives in private storage. */
async function blobPathOf(src: string): Promise<string | null> {
  const db = adminDb();
  let m = src.match(/\/api\/studio\/media\/take\/([0-9a-f-]{36})/);
  if (m) return (await db.from('studio_takes').select('blob_path').eq('id', m[1]).single()).data?.blob_path ?? null;
  m = src.match(/\/api\/studio\/media\/voice\/([0-9a-f-]{36})/);
  if (m) return (await db.from('studio_voice_clips').select('blob_path').eq('id', m[1]).single()).data?.blob_path ?? null;
  m = src.match(/\/api\/studio\/library\/([a-z0-9-]+)\/(desktop|phone)/);
  if (m) return (await db.from('studio_screens').select('clip_path').eq('code', m[1]).eq('device', m[2]).single()).data?.clip_path ?? null;
  return null;
}
async function download(src: string, file: string) {
  const p = await blobPathOf(src);
  if (!p) throw new Error(`Missing media for ${src}`);
  const res = await get(p, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(90_000) });
  if (!res || res.statusCode !== 200 || !res.stream) throw new Error(`Couldn't read ${p}`);
  await fs.writeFile(file, Buffer.from(await new Response(res.stream).arrayBuffer()));
}

const TAIL = `setsar=1,fps=${FPS},format=yuv420p`;
/** Fit a source into the frame: letterbox (16:9, or a portrait source in 9:16), center-crop (a cast take in 9:16),
 *  or a wide screen over a blurred fill (9:16). Returns a -filter_complex graph ending in [v]. */
function framing(d: Dim, mode: 'fit' | 'crop' | 'blur'): string {
  const { w, h: hh } = d;
  if (mode === 'crop') return `[0:v]scale=${w}:${hh}:force_original_aspect_ratio=increase,crop=${w}:${hh},${TAIL}[v]`;
  if (mode === 'blur') return `[0:v]split=2[a][b];[a]scale=${w}:${hh}:force_original_aspect_ratio=increase,crop=${w}:${hh},boxblur=24:2,eq=brightness=-0.18[bg];[b]scale=${w}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,${TAIL}[v]`;
  return `[0:v]scale=${w}:${hh}:force_original_aspect_ratio=decrease,pad=${w}:${hh}:(ow-iw)/2:(oh-ih)/2:color=black,${TAIL}[v]`;
}
async function isPortrait(file: string): Promise<boolean> {
  try {
    const { stderr } = await run(String(ffmpegPath), ['-hide_banner', '-i', file], { maxBuffer: 4 * 1024 * 1024 }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? '' }));
    const m = String(stderr).match(/Video:.*?(\d{2,5})x(\d{2,5})/);
    return m ? Number(m[2]) > Number(m[1]) : false;
  } catch { return false; }
}

/** Render one timeline item to a silent segment with its captions burned in. */
async function segment(it: CutItem, dir: string, i: number, d: Dim): Promise<string> {
  const out = path.join(dir, `seg-${String(i).padStart(3, '0')}.mp4`);
  const base = path.join(dir, `base-${i}.mp4`);
  const f = await brand();
  if (it.kind === 'card' || !it.src) {
    const card = path.join(dir, `card-${i}.png`);
    await png(it.card?.style === 'packages' ? packagesEl(it.card.title, f.egg, d) : cardEl(it.card?.title ?? it.label, it.card?.style === 'end', f.egg, d), card, d);
    await ffmpeg(['-loop', '1', '-t', it.dur.toFixed(3), '-i', card, '-vf', `fps=${FPS},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', base]);
  } else {
    // One clip, or several Screen Library clips sharing the shot's slot; each held on its last frame if short.
    const screens = Boolean(it.clips?.length);
    const parts = it.clips?.length ? it.clips : [{ src: it.src, dur: it.dur }];
    const partFiles: string[] = [];
    for (const [k, part] of parts.entries()) {
      const src = path.join(dir, `src-${i}-${k}.mp4`);
      await download(part.src, src);
      const mode = !d.tall ? 'fit' : screens ? ((await isPortrait(src)) ? 'fit' : 'blur') : 'crop';
      const pf = path.join(dir, `part-${i}-${k}.mp4`);
      const secs = part.dur.toFixed(3);
      await ffmpeg(['-ss', String(it.in || 0), '-i', src, '-t', secs, '-filter_complex', `${framing(d, mode)};[v]tpad=stop_mode=clone:stop_duration=${secs}[o]`, '-map', '[o]', '-t', secs, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-an', pf]);
      partFiles.push(pf);
    }
    if (partFiles.length === 1) await fs.rename(partFiles[0], base);
    else { const list = path.join(dir, `parts-${i}.txt`); await fs.writeFile(list, partFiles.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n')); await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', base]); }
  }
  if (!it.captions.length) { await fs.rename(base, out); return out; }
  // Captions: one transparent PNG per line, composited on its window.
  const inputs: string[] = ['-i', base];
  let chain = '[0:v]';
  const filters: string[] = [];
  for (const [k, c] of it.captions.entries()) {
    const cap = path.join(dir, `cap-${i}-${k}.png`);
    await png(captionEl(c.text, d), cap, d);
    inputs.push('-i', cap);
    const label = `[v${k}]`;
    filters.push(`${chain}[${k + 1}:v]overlay=0:0:enable='between(t,${c.t0.toFixed(2)},${c.t1.toFixed(2)})'${label}`);
    chain = label;
  }
  await ffmpeg([...inputs, '-filter_complex', filters.join(';'), '-map', chain, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-an', out]);
  return out;
}

export type RenderResult = { blob: string; sha256: string; secs: number; bytes: number };

/** Render the timeline to an MP4 in private storage (studio/finals/… for the final, studio/renders/… otherwise). */
export async function renderTimeline(episodeId: string, cut: Cut, kind: 'final' | 'draft' | 'short', format: RenderFormat = 'wide', name = ''): Promise<RenderResult> {
  const d = DIMS[format];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'genovus-render-'));
  try {
    const items = [...cut.items].sort((a, b) => a.start - b.start);
    // Picture: every segment in story order, then one concatenation (same codec settings, so no re-encode).
    const segs: string[] = [];
    for (const [i, it] of items.entries()) segs.push(await segment(it, dir, i, d));
    const list = path.join(dir, 'segments.txt');
    await fs.writeFile(list, segs.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
    const picture = path.join(dir, 'picture.mp4');
    await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', picture]);
    const total = items.reduce((a, it) => a + it.dur, 0);
    // Sound: each read at its absolute time; the score under everything, ducking when someone speaks.
    const voices: { file: string; at: number }[] = [];
    let offset = 0;
    for (const it of items) {
      for (const [k, v] of it.voice.entries()) { const f = path.join(dir, `voice-${voices.length}-${k}.mp3`); await download(v.src, f); voices.push({ file: f, at: offset + v.at }); }
      offset += it.dur;
    }
    let musicFile: string | null = null;
    if (cut.music) { musicFile = path.join(dir, 'score.mp3'); await download(cut.music.src, musicFile).catch(() => { musicFile = null; }); }
    const out = path.join(dir, 'episode.mp4');
    const inputs = ['-i', picture, ...voices.flatMap((v) => ['-i', v.file]), ...(musicFile ? ['-stream_loop', '-1', '-i', musicFile] : [])];
    const fc: string[] = [];
    voices.forEach((v, k) => fc.push(`[${k + 1}:a]aresample=48000,adelay=${Math.round(v.at * 1000)}|${Math.round(v.at * 1000)},apad[d${k}]`));
    const dialogue = voices.length ? `${voices.map((_, k) => `[d${k}]`).join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0,atrim=0:${total.toFixed(3)}[dlg]` : `anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(3)}[dlg]`;
    fc.push(dialogue);
    if (musicFile) {
      const m = voices.length + 1;
      fc.push(`[${m}:a]aresample=48000,volume=0.35,atrim=0:${total.toFixed(3)}[bed]`, '[dlg]asplit=2[dlg1][key]', '[bed][key]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[ducked]', '[dlg1][ducked]amix=inputs=2:normalize=0[mix]');
    } else fc.push('[dlg]anull[mix]');
    await ffmpeg([...inputs, '-filter_complex', fc.join(';'), '-map', '0:v', '-map', '[mix]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', total.toFixed(3), '-movflags', '+faststart', out]);
    const bytes = await fs.readFile(out);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const tag = [kind === 'final' ? '' : kind, name, format === 'vertical' ? 'vertical' : ''].filter(Boolean).join('-');
    const blob = `${kind === 'final' ? 'studio/finals' : 'studio/renders'}/${episodeId}/${tag ? `${tag}-` : ''}${Date.now()}.mp4`;
    await put(blob, bytes, { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true, abortSignal: AbortSignal.timeout(120_000) });
    return { blob, sha256, secs: total, bytes: bytes.length };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Is the bundled ffmpeg present and runnable here? */
export async function renderEngineReady(): Promise<{ ready: boolean; version?: string; error?: string }> {
  try {
    const { stdout } = await run(String(ffmpegPath), ['-version']);
    return { ready: true, version: stdout.split('\n')[0].slice(0, 80) };
  } catch (e) { return { ready: false, error: e instanceof Error ? e.message.slice(0, 120) : 'not runnable' }; }
}
