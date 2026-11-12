// Unedit thumbnails for the full video (YouTube, 1280×720): a still of the speaker from the recording, a line of
// four words or fewer in Genovus Display, three looks (A dark, B Genovus orange, C light) so YouTube's Test &
// Compare has real options. Real footage carries no AI label. Rendered with next/og, saved as JPEG (YouTube's
// limit is 2 MB). Server only.
import 'server-only';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createElement as h } from 'react';
import { ImageResponse } from 'next/og';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const TW = 1280;
const TH = 720;
export type ThumbLook = 'dark' | 'orange' | 'light';
export const LOOKS: ThumbLook[] = ['dark', 'orange', 'light'];

let font: Buffer | null = null;
const display = async () => (font ??= await fs.readFile(path.join(process.cwd(), 'lib/fonts/archivo-expanded-800.woff')));

function element(still: string, text: string, look: ThumbLook) {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean).slice(0, 5);
  const size = words.join(' ').length > 18 ? 92 : words.join(' ').length > 11 ? 112 : 132;
  const bg = look === 'orange' ? 'linear-gradient(110deg, #ff5a20 0%, #c2410c 48%, rgba(122,30,5,0) 72%)' : look === 'light' ? 'linear-gradient(100deg, rgba(244,245,247,0.97) 0%, rgba(244,245,247,0.9) 40%, rgba(244,245,247,0) 66%)' : 'linear-gradient(100deg, rgba(8,9,12,0.95) 0%, rgba(8,9,12,0.82) 40%, rgba(8,9,12,0) 68%)';
  const ink = look === 'light' ? '#121419' : '#ffffff';
  const hot = look === 'orange' ? '#ffd38a' : look === 'light' ? '#e5531a' : '#ffa31a';
  return h('div', { style: { width: TW, height: TH, display: 'flex', position: 'relative', background: '#0b0c10' } },
    h('img', { src: still, width: TW, height: TH, style: { position: 'absolute', left: 0, top: 0, width: TW, height: TH, objectFit: 'cover', objectPosition: '62% 30%' } }),
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: TW, height: TH, display: 'flex', backgroundImage: bg } }),
    h('div', { style: { position: 'absolute', left: 64, top: 0, bottom: 0, width: 640, display: 'flex', flexWrap: 'wrap', alignContent: 'center', gap: '0 22px', fontFamily: 'Genovus Display', fontSize: size, lineHeight: 1.0, color: ink, letterSpacing: -1 } },
      ...words.map((w, i) => h('span', { key: i, style: { display: 'flex', color: i === words.length - 1 ? hot : ink } }, w))),
  );
}

/** One thumbnail as JPEG bytes. */
export async function renderThumb(still: Buffer, text: string, look: ThumbLook): Promise<Buffer> {
  const res = new ImageResponse(element(`data:image/jpeg;base64,${still.toString('base64')}`, text, look), { width: TW, height: TH, fonts: [{ name: 'Genovus Display', data: await display(), weight: 800 }] });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-thumb-'));
  try {
    await fs.writeFile(path.join(dir, 't.png'), Buffer.from(await res.arrayBuffer()));
    await run(String(ffmpegPath), ['-y', '-hide_banner', '-loglevel', 'error', '-i', 't.png', '-q:v', '3', 't.jpg'], { cwd: dir, timeout: 60_000 });
    return await fs.readFile(path.join(dir, 't.jpg'));
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
