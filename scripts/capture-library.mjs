// Capture the Studio's Screen Library: every screen in data/screen-library.json, on each of its devices, recorded
// from the real Genovus app in headless Chrome on the PREVIEW database with fictional data (stage-library.mjs):
// Agency screens as the demo agency's owner, Enterprise screens as the fictional team member Tasha. Each screen
// becomes a short clip (taps shown as ripples) and a still, uploaded to private storage and listed in
// data/screen-library-assets.json, which the Studio sync carries to every environment with the next release.
//   node --env-file=.env.local scripts/capture-library.mjs [--only=code,code] [--device=desktop|phone] [--no-upload]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { put } from '@vercel/blob';
import { stageLibrary } from './stage-library.mjs';

const ORIGIN = 'http://localhost:3911';
const args = process.argv.slice(2);
const ONLY = (args.find((a) => a.startsWith('--only='))?.slice(7) ?? '').split(',').filter(Boolean);
const DEVICE = args.find((a) => a.startsWith('--device='))?.slice(9) ?? null;
const UPLOAD = !args.includes('--no-upload');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-library-'));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: the Screen Library is captured on the preview database only');
const LIB = JSON.parse(fs.readFileSync('data/screen-library.json', 'utf8'));
const ASSETS_FILE = 'data/screen-library-assets.json';
const assets = fs.existsSync(ASSETS_FILE) ? JSON.parse(fs.readFileSync(ASSETS_FILE, 'utf8')) : { note: 'Written by scripts/capture-library.mjs. One entry per screen and device.', entries: {} };
const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short=7', 'HEAD']).toString().trim(); } catch { return null; } })();

// ---------- dev server ----------
const up = async () => { try { return (await fetch(`${ORIGIN}/`, { redirect: 'manual' })).status > 0; } catch { return false; } };
let dev = null;
if (!(await up())) {
  console.log('starting next dev on :3911 …');
  dev = spawn('npx', ['next', 'dev', '-p', '3911'], { stdio: 'ignore', shell: true });
  for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);
  if (!(await up())) throw new Error('next dev did not start on :3911');
}

// ---------- Chrome over CDP ----------
const port = 9489;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-capture-'));
const chrome = spawn(CHROME, ['--headless=new', '--hide-scrollbars', '--mute-audio', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} try { dev?.kill(); } catch {} };
process.on('exit', cleanup);
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const listeners = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) listeners.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed'); return r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
// Taps show as a soft ripple; the Next.js dev indicator never belongs in a frame.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  const hide = document.createElement('style'); hide.textContent = 'nextjs-portal{display:none!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(hide));
  addEventListener('pointerdown', (e) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:'+(e.clientX-28)+'px;top:'+(e.clientY-28)+'px;width:56px;height:56px;border-radius:50%;background:rgba(255,138,30,.38);border:2px solid rgba(255,138,30,.9);pointer-events:none;z-index:2147483647;transform:scale(.4);opacity:1;transition:transform .45s ease-out,opacity .6s ease-out';
    document.documentElement.appendChild(d); requestAnimationFrame(() => { d.style.transform = 'scale(1.25)'; d.style.opacity = '0'; }); setTimeout(() => d.remove(), 700);
  }, true);
` });

const VIEW = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
  phone: { width: 430, height: 932, deviceScaleFactor: 3, mobile: true },
};
let current = 'desktop';
async function view(kind) { current = kind; await send('Emulation.setDeviceMetricsOverride', VIEW[kind]); await send('Emulation.setTouchEmulationEnabled', { enabled: kind === 'phone' }); }
async function go(url) {
  const loaded = new Promise((r) => listeners.set('Page.loadEventFired', r));
  await send('Page.navigate', { url: ORIGIN + url });
  await loaded;
  for (let i = 0; i < 40; i++) { if (await ev('document.readyState === "complete" && !document.querySelector(".loading, [aria-busy=true]")')) break; await sleep(150); }
  await ev('document.fonts.ready.then(() => true)');
  await sleep(500);
}
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.includes(${JSON.stringify(text)}))`;
const centerOf = async (js) => ev(`(() => { const el = ${js}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
async function tap(js) {
  const p = await centerOf(js);
  if (!p) throw new Error(`nothing to tap: ${js}`);
  if (current === 'phone') { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] }); await sleep(90); await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  else for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) { await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); if (type === 'mousePressed') await sleep(90); }
  await sleep(350);
}
async function type(js, text, cps = 16) { await tap(js); for (const ch of text) { await send('Input.insertText', { text: ch }); await sleep(1000 / cps + (ch === ' ' ? 40 : 0)); } await sleep(250); }
async function scroll(target, ms = 1400, at = 0.35) {
  const to = typeof target === 'number' ? `scrollY + ${target}` : `(() => { const el = ${target}; return el ? scrollY + el.getBoundingClientRect().top - innerHeight * ${at} : scrollY; })()`;
  await ev(`new Promise((done) => { const from = scrollY, to = Math.max(0, Math.min(${to}, document.documentElement.scrollHeight - innerHeight)), t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ${ms}); const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; scrollTo(0, from + (to - from) * e); k < 1 ? requestAnimationFrame(step) : done(true); };
    requestAnimationFrame(step); })`);
}
// The catalog's steps: wait · scroll · tap · type.
async function run(steps) {
  for (const s of steps ?? []) {
    if (s.wait) await sleep(s.wait);
    else if (s.scroll) await scroll(typeof s.scroll.to === 'number' ? s.scroll.to : byText(s.scroll.within ?? 'section, h2, h3', s.scroll.to), s.scroll.ms ?? 1400, s.scroll.at ?? 0.3);
    else if (s.tap) await tap(byText(s.tap.within ?? 'button, a', s.tap.text));
    else if (s.type) await type(`document.querySelector(${JSON.stringify(s.type.into)})`, s.type.text, s.type.cps ?? 16);
  }
}

// ---------- recording: screencast frames → constant-frame-rate MP4, plus a still ----------
async function record(name, kind, url, steps) {
  await go(url); await go(url); // dev compiles a route on first visit: warm it so the clip opens on its own screen
  await sleep(2400); // let tile count-ups settle so the still shows the real numbers
  const stillFile = path.join(OUT, `${name}.jpg`);
  fs.writeFileSync(stillFile, Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 })).result.data, 'base64'));
  const dir = path.join(OUT, `_frames-${name}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  listeners.set('Page.screencastFrame', (p) => {
    const f = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(p.data, 'base64')); frames.push({ f, t: p.metadata.timestamp });
    send('Page.screencastFrameAck', { sessionId: p.sessionId });
  });
  const v = VIEW[kind];
  await send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: v.width * v.deviceScaleFactor, maxHeight: v.height * v.deviceScaleFactor, everyNthFrame: 1 });
  await sleep(300);
  await run(steps);
  await sleep(200);
  const tEnd = Date.now() / 1000;
  await send('Page.stopScreencast');
  listeners.delete('Page.screencastFrame');
  if (!frames.length) throw new Error(`${name}: no frames`);
  const lines = frames.map((fr, i) => `file '${path.basename(fr.f)}'\nduration ${Math.max(1 / FPS, ((frames[i + 1]?.t ?? tEnd) - fr.t)).toFixed(4)}`);
  lines.push(`file '${path.basename(frames.at(-1).f)}'`);
  fs.writeFileSync(path.join(dir, 'list.txt'), lines.join('\n'));
  const clipFile = path.join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vf', `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-movflags', '+faststart', clipFile], { cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', clipFile]).toString().trim());
  return { clipFile, stillFile, secs };
}

async function signIn(kind, creds) {
  await send('Network.clearBrowserCookies');
  await view('desktop');
  if (kind === 'agency') {
    const p = new URL(creds.agencyLink);
    await go(p.pathname + p.search);
  } else {
    await go(`/auth/continue?t=${encodeURIComponent(creds.staffToken)}&next=${encodeURIComponent('/console')}`);
  }
  await tap(`[...document.querySelectorAll('button')].find((b) => /Continue/.test(b.textContent))`);
  const want = kind === 'agency' ? '/app/demo-brooks' : '/console';
  for (let i = 0; i < 60 && !(await ev('location.pathname')).startsWith(want); i++) await sleep(250);
  if (!(await ev('location.pathname')).startsWith(want)) throw new Error(`${kind} sign-in did not land (at ${await ev('location.href')})`);
}

let done = 0, failed = 0;
try {
  const creds = await stageLibrary(ORIGIN);
  for (const side of ['agency', 'enterprise']) {
    const jobs = LIB.screens.filter((s) => s.side === side && !s.pending && (!ONLY.length || ONLY.includes(s.code)));
    if (!jobs.length) continue;
    await signIn(side, creds);
    console.log(`signed in for ${side} screens`);
    for (const s of jobs) for (const kind of s.devices.filter((d) => !DEVICE || d === DEVICE)) {
      const name = `${s.code}-${kind}`;
      await view(kind);
      try {
        const r = await record(name, kind, s.route, s.steps);
        let clip = null, still = null;
        if (UPLOAD) {
          clip = (await put(`studio/library/${name}.mp4`, fs.readFileSync(r.clipFile), { access: 'private', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true })).pathname;
          still = (await put(`studio/library/${name}.jpg`, fs.readFileSync(r.stillFile), { access: 'private', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true })).pathname;
        }
        assets.entries[`${s.code}:${kind}`] = { clip, still, secs: Math.round(r.secs * 10) / 10, captured_at: new Date().toISOString(), captured_on: commit };
        fs.writeFileSync(ASSETS_FILE, JSON.stringify(assets, null, 2) + '\n');
        done++;
        console.log(`  ✓ ${name}  ${r.secs.toFixed(1)} s${UPLOAD ? '  uploaded' : `  ${r.clipFile}`}`);
      } catch (e) { failed++; console.log(`  ✕ ${name}: ${e.message}`); }
    }
  }
  await stageLibrary(ORIGIN); // leave preview in its filming state
} finally {
  try { await send('Browser.close'); } catch {}
  ws.close(); cleanup();
}
console.log(`Screen Library: ${done} captured, ${failed} failed. Assets listed in ${ASSETS_FILE}.`);
process.exit(failed ? 1 : 0);
