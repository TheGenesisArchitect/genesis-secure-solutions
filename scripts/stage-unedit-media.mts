// Media for the Screen Library's Unedit screens (PREVIEW Blob only): a sample "recording", three 9:16 clips and
// three thumbnails rendered by Unedit's own thumbnail code, under studio/vlogs/library-demo/. The footage is a
// Genovus Motion Unedit Pro sample render (fictional cast), so the review card shows the real Unedit Pro look.
// stage-library.mjs then stages the vlog rows that point at these paths. Run once, or again to refresh:
//   npx tsx --env-file=.env.local --conditions=react-server scripts/stage-unedit-media.mts <unedit-pro-sample.mp4>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { put } from '@vercel/blob';
import { renderThumb } from '../lib/unedit-thumb';

if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: preview environment only');
const SRC = process.argv[2];
if (!SRC || !fs.existsSync(SRC)) throw new Error('usage: stage-unedit-media.mts <unedit-pro-sample.mp4>');
const DIR = 'studio/vlogs/library-demo';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unedit-library-'));
const ff = (args: string[]) => execFileSync(String(ffmpegPath), ['-nostdin', '-y', '-hide_banner', '-loglevel', 'error', ...args]);
const up = (p: string, file: string, type: string) => put(`${DIR}/${p}`, fs.readFileSync(file), { access: 'private', contentType: type, addRandomSuffix: false, allowOverwrite: true });

// Three clips that open on different shots of the sample (face, big number, real screen).
const CLIPS = [{ from: 0, secs: 11.5 }, { from: 3.4, secs: 8.4 }, { from: 7.6, secs: 4.3 }];
for (const [i, c] of CLIPS.entries()) {
  const out = path.join(tmp, `clip${i + 1}.mp4`);
  ff(['-ss', String(c.from), '-t', String(c.secs), '-i', SRC, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-movflags', '+faststart', out]);
  await up(`clips/${i + 1}.mp4`, out, 'video/mp4');
}
await up('source.mp4', SRC, 'video/mp4');
// Thumbnails: stills of the speaker through Unedit's renderer, one per look, as the pipeline makes them.
const LINES: [string, 'dark' | 'orange' | 'light'][] = [['ONE TAKE', 'dark'], ['NO EDITOR', 'orange'], ['YOU APPROVE', 'light']];
for (const [i, [text, look]] of LINES.entries()) {
  const still = path.join(tmp, `still${i}.jpg`);
  ff(['-ss', String([0.6, 1.4, 10.2][i]), '-i', SRC, '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', still]);
  const jpg = path.join(tmp, `thumb${i}.jpg`);
  fs.writeFileSync(jpg, await renderThumb(fs.readFileSync(still), text, look));
  await up(`thumbs/${i + 1}-${look}.jpg`, jpg, 'image/jpeg');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`staged ${DIR}: source, ${CLIPS.length} clips (${CLIPS.map((c) => c.secs).join(' / ')} s), ${LINES.length} thumbnails`);
