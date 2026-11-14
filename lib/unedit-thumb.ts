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
let serif: Buffer | null = null;
const serifFont = async () => (serif ??= await fs.readFile(path.join(process.cwd(), 'lib/fonts/instrument-serif-italic.ttf')));

/** The show package's type on the thumbnail, so the channel reads as one brand: Documentary sets the line in the
 *  italic serif it uses on screen; every premium package draws the orange rule its titles use. Classic is unchanged. */
type ThumbType = { serif: boolean; rule: boolean };
const typeOf = (pkg?: string | null): ThumbType => ({ serif: pkg === 'documentary', rule: Boolean(pkg && pkg !== 'classic') });

function element(still: string, text: string, look: ThumbLook, type: ThumbType = { serif: false, rule: false }) {
  const words = (type.serif ? text : text.toUpperCase()).split(/\s+/).filter(Boolean).slice(0, 5);
  const size = Math.round((words.join(' ').length > 18 ? 92 : words.join(' ').length > 11 ? 112 : 132) * (type.serif ? 1.3 : 1));
  const bg = look === 'orange' ? 'linear-gradient(110deg, #ff5a20 0%, #c2410c 48%, rgba(122,30,5,0) 72%)' : look === 'light' ? 'linear-gradient(100deg, rgba(244,245,247,0.97) 0%, rgba(244,245,247,0.9) 40%, rgba(244,245,247,0) 66%)' : 'linear-gradient(100deg, rgba(8,9,12,0.95) 0%, rgba(8,9,12,0.82) 40%, rgba(8,9,12,0) 68%)';
  const ink = look === 'light' ? '#121419' : '#ffffff';
  const hot = look === 'orange' ? '#ffd38a' : look === 'light' ? '#e5531a' : '#ffa31a';
  return h('div', { style: { width: TW, height: TH, display: 'flex', position: 'relative', background: '#0b0c10' } },
    h('img', { src: still, width: TW, height: TH, style: { position: 'absolute', left: 0, top: 0, width: TW, height: TH, objectFit: 'cover', objectPosition: '62% 30%' } }),
    h('div', { style: { position: 'absolute', left: 0, top: 0, width: TW, height: TH, display: 'flex', backgroundImage: bg } }),
    h('div', { style: { position: 'absolute', left: 64, top: 0, bottom: 0, width: 640, display: 'flex', flexDirection: 'column', justifyContent: 'center' } },
      ...(type.rule ? [h('div', { key: 'rule', style: { display: 'flex', width: 120, height: 10, borderRadius: 5, background: look === 'orange' ? '#ffffff' : '#ff8a1e', marginBottom: 28 } })] : []),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: type.serif ? '0 4px' : '0 22px', fontFamily: type.serif ? 'Genovus Serif' : 'Genovus Display', fontStyle: type.serif ? 'italic' : 'normal', fontSize: size, lineHeight: type.serif ? 0.95 : 1.0, color: ink, letterSpacing: type.serif ? -2 : -1 } },
        ...words.map((w, i) => h('span', { key: i, style: { display: 'flex', marginRight: type.serif && i < words.length - 1 ? 26 : 0, color: i === words.length - 1 ? hot : ink } }, w)))),
  );
}

/** One thumbnail as JPEG bytes. */
export async function renderThumb(still: Buffer, text: string, look: ThumbLook, pkg?: string | null): Promise<Buffer> {
  const type = typeOf(pkg);
  const fonts = [{ name: 'Genovus Display', data: await display(), weight: 800 as const }, ...(type.serif ? [{ name: 'Genovus Serif', data: await serifFont(), weight: 400 as const, style: 'italic' as const }] : [])];
  const res = new ImageResponse(element(`data:image/jpeg;base64,${still.toString('base64')}`, text, look, type), { width: TW, height: TH, fonts });
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'unedit-thumb-'));
  try {
    await fs.writeFile(path.join(dir, 't.png'), Buffer.from(await res.arrayBuffer()));
    await run(String(ffmpegPath), ['-y', '-hide_banner', '-loglevel', 'error', '-i', 't.png', '-q:v', '3', 't.jpg'], { cwd: dir, timeout: 60_000 });
    return await fs.readFile(path.join(dir, 't.jpg'));
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
