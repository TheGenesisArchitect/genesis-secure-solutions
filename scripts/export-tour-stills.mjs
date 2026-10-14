// Export the Screen Library stills the public package tour shows (genovus.io/tour) into public/tour/. The stills
// are of the fictional demo agency (Brooks Family Insurance) captured on preview, so they are safe to publish.
//   node --env-file=.env.local scripts/export-tour-stills.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { get } from '@vercel/blob';
import ffmpeg from 'ffmpeg-static';

const assets = JSON.parse(fs.readFileSync('data/screen-library-assets.json', 'utf8')).entries;
const src = fs.readFileSync('lib/package-tour.ts', 'utf8');
const map = [...src.matchAll(/\['(agency-[a-z-]+)', '(desktop|phone)'\]/g)].map((m) => `${m[1]}:${m[2]}`);
const wanted = [...new Set([...map, 'agency-home:desktop'])];
fs.mkdirSync('public/tour', { recursive: true });
let n = 0;
for (const key of wanted) {
  const a = assets[key];
  if (!a?.still) { console.log(`  · no still for ${key}`); continue; }
  const res = await get(a.still, { access: 'private', useCache: false });
  const tmp = path.join('public/tour', '.tmp.jpg');
  fs.writeFileSync(tmp, Buffer.from(await new Response(res.stream).arrayBuffer()));
  const out = path.join('public/tour', `${key.replace(':', '-')}.jpg`);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', tmp, '-vf', key.endsWith(':phone') ? 'scale=560:-2' : 'scale=1440:-2', '-q:v', '5', out]);
  fs.rmSync(tmp);
  n++;
}
console.log(`exported ${n} stills to public/tour`);
