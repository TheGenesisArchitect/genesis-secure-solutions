// The episode render needs ffmpeg-static's binary for the build platform. npm can skip the package's install script
// (script policy), so the build runs the installer itself when the binary is missing, then confirms it works.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bin = require('ffmpeg-static');
if (!bin || !fs.existsSync(bin)) {
  console.log('[ensure-ffmpeg] downloading ffmpeg for this platform…');
  execFileSync(process.execPath, [require.resolve('ffmpeg-static/install.js')], { stdio: 'inherit' });
}
if (!fs.existsSync(bin)) throw new Error('[ensure-ffmpeg] ffmpeg is still missing after the install');
const v = execFileSync(bin, ['-version']).toString().split('\n')[0];
console.log(`[ensure-ffmpeg] ${v}`);
