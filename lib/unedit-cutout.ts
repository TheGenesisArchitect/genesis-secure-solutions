// The speaker cut-out: text BEHIND the speaker (the style book's "behind" styles). For each behind graphic, the part
// worker mattes the speaker over just that window with MODNet (portrait matting, Apache-2.0, ZHKKKe/MODNet, the ONNX
// export Xenova/modnet) on onnxruntime-web's WebAssembly runtime (no GPU, no native binary), then composites
// footage → graphic → the speaker again on top. Server only; UNEDIT_CUTOUT=on turns it on (lib/unedit-style.ts).
//   speed     the matte runs at 10 fps on a 640×352 frame (the head moves slowly; the matte is blended up to 30 fps
//             and softened), about 15 s for a 3 s graphic
//   failure   never fatal: a window that can't be matted falls back to the graphic in front (the caller's catch)
import 'server-only';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { presigned } from '@/lib/unedit-media';

const MW = 640, MH = 352, MFPS = 10;
/** Where the model lives in private Blob (uploaded once by scripts/upload-cutout-model.mjs). */
const MODEL_PATH = () => (process.env.UNEDIT_CUTOUT_MODEL || 'models/modnet-photographic-portrait-matting.onnx').trim();

type Session = { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>; inputNames: readonly string[]; outputNames: readonly string[] };
let session: Promise<{ s: Session; Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown }> | null = null;

async function load() {
  const file = path.join(os.tmpdir(), 'modnet.onnx');
  const have = await fs.stat(file).then((s) => s.size > 1_000_000, () => false);
  if (!have) {
    const r = await fetch(await presigned(MODEL_PATH(), 10), { signal: AbortSignal.timeout(120_000) });
    if (!r.ok) throw new Error(`the cut-out model didn't download (${r.status})`);
    await fs.writeFile(file, Buffer.from(await r.arrayBuffer()));
  }
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = 1;
  const s = (await ort.InferenceSession.create(file, { executionProviders: ['wasm'] })) as unknown as Session;
  return { s, Tensor: ort.Tensor as unknown as new (type: 'float32', data: Float32Array, dims: number[]) => unknown };
}

/** Matte the speaker over [start, start+len] of a local video: a grayscale matte video (MW×MH, MFPS) in `dir`. */
export async function matte(video: string, start: number, len: number, dir: string, name: string): Promise<string> {
  session ??= load().catch((e) => { session = null; throw e; });
  const { s, Tensor } = await session;
  const out = path.join(dir, `${name}.mkv`);
  const ff = String(ffmpegPath);
  const dec = spawn(ff, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', start.toFixed(3), '-t', len.toFixed(3), '-i', video, '-vf', `fps=${MFPS},scale=${MW}:${MH}:flags=bilinear`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  const enc = spawn(ff, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray', '-s', `${MW}x${MH}`, '-r', String(MFPS), '-i', 'pipe:0', '-c:v', 'ffv1', out]);
  let encErr = '';
  enc.stderr.on('data', (d) => { encErr = (encErr + String(d)).slice(-500); });
  const encDone = new Promise<number>((res) => enc.on('close', (c) => res(c ?? 1)));
  const px = MW * MH, frame = px * 3;
  const input = new Float32Array(3 * px);
  let buf = Buffer.alloc(0), n = 0;
  for await (const chunk of dec.stdout as AsyncIterable<Buffer>) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= frame) {
      const f = buf.subarray(0, frame); buf = buf.subarray(frame);
      // MODNet's input: RGB planes normalized to [-1, 1].
      for (let i = 0, p = 0; i < px; i++, p += 3) { input[i] = f[p] / 127.5 - 1; input[i + px] = f[p + 1] / 127.5 - 1; input[i + 2 * px] = f[p + 2] / 127.5 - 1; }
      const r = await s.run({ [s.inputNames[0]]: new Tensor('float32', input, [1, 3, MH, MW]) });
      const m = r[s.outputNames[0]].data;
      const g = Buffer.alloc(px);
      for (let i = 0; i < px; i++) g[i] = m[i] <= 0 ? 0 : m[i] >= 1 ? 255 : Math.round(m[i] * 255);
      if (!enc.stdin.write(g)) await new Promise((res) => enc.stdin.once('drain', res));
      n++;
    }
  }
  enc.stdin.end();
  const code = await encDone;
  if (code !== 0 || !n) throw new Error(`the matte didn't encode (${n} frames): ${encErr.trim().slice(0, 200)}`);
  return out;
}

/** The ffmpeg filter that turns a matte input into a full-size, 30 fps, soft-edged alpha source, starting at `at`. */
export const matteFilter = (input: string, W: number, H: number, label: string) =>
  `[${input}]framerate=fps=30,scale=${W}:${H}:flags=bicubic,gblur=sigma=1.2,format=gray[${label}]`;
