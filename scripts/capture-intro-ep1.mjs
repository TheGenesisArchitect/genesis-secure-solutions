// Record the real Genovus screens for Intro Series Ep. 1 "Genovus Knows" with the fictional demo agency
// (demo-brooks): stages the agency, signs in as its filming owner, drives each screen in headless Chrome the way
// Maya does in the script (taps shown as ripples, typing at a human pace) and writes one MP4 per beat.
//   node --env-file=.env.local scripts/capture-intro-ep1.mjs [--out=dir] [clip ...]
// Starts `next dev` on :3911 if nothing is listening there. Clips: see CLIPS below (default: all).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { stage, plan } from './stage-intro-ep1.mjs';

const ORIGIN = 'http://localhost:3911';
const args = process.argv.slice(2);
const OUT = args.find((a) => a.startsWith('--out='))?.slice(6) || path.join(os.homedir(), 'OneDrive/Documents/Business in a Box Platform/Genovus Pitch/_source/intro-e001/screens');
const ONLY = args.filter((a) => !a.startsWith('--'));
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const FPS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// ---------- dev server ----------
const up = async () => { try { return (await fetch(`${ORIGIN}/`, { redirect: 'manual' })).status > 0; } catch { return false; } };
let dev = null;
if (!(await up())) {
  console.log('starting next dev on :3911 …');
  dev = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev', '-p', '3911'], { stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
  if (!(await up())) throw new Error('next dev did not start on :3911');
}

// ---------- Chrome over CDP ----------
const port = 9488;
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
await send('Page.enable'); await send('Runtime.enable');

// Taps show as a soft ripple (the edit adds Maya's highlight on top); the caret blinks like a real field.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  // The Next.js dev indicator never belongs in a frame.
  const hide = document.createElement('style'); hide.textContent = 'nextjs-portal{display:none!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(hide));
  addEventListener('pointerdown', (e) => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:'+(e.clientX-28)+'px;top:'+(e.clientY-28)+'px;width:56px;height:56px;border-radius:50%;background:rgba(255,138,30,.38);border:2px solid rgba(255,138,30,.9);pointer-events:none;z-index:2147483647;transform:scale(.4);opacity:1;transition:transform .45s ease-out,opacity .6s ease-out';
    document.documentElement.appendChild(d);
    requestAnimationFrame(() => { d.style.transform = 'scale(1.25)'; d.style.opacity = '0'; });
    setTimeout(() => d.remove(), 700);
  }, true);
` });

const VIEW = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
  phone: { width: 430, height: 932, deviceScaleFactor: 2, mobile: true },
};
let current = 'desktop';
async function view(kind) {
  current = kind;
  await send('Emulation.setDeviceMetricsOverride', VIEW[kind]);
  await send('Emulation.setTouchEmulationEnabled', { enabled: kind === 'phone' });
}
async function go(url) {
  const loaded = new Promise((r) => listeners.set('Page.loadEventFired', r));
  await send('Page.navigate', { url: ORIGIN + url });
  await loaded;
  for (let i = 0; i < 40; i++) { if (await ev('document.readyState === "complete" && !document.querySelector(".loading, [aria-busy=true]")')) break; await sleep(150); }
  await ev('document.fonts.ready.then(() => true)');
  await sleep(400);
}
const centerOf = async (js) => ev(`(() => { const el = ${js}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
const byText = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.includes(${JSON.stringify(text)}))`;
async function tap(js) {
  const p = await centerOf(js);
  if (!p) throw new Error(`nothing to tap: ${js}`);
  if (current === 'phone') {
    // A real finger: touch events (the page synthesizes the click), so phone taps behave like the device.
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await sleep(90);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
      if (type === 'mousePressed') await sleep(90);
    }
  }
  await sleep(350);
}
async function type(js, text, cps = 16) {
  await tap(js);
  for (const ch of text) { await send('Input.insertText', { text: ch }); await sleep(1000 / cps + (ch === ' ' ? 40 : 0)); }
  await sleep(250);
}
const setValue = (js, v) => ev(`(() => { const el = ${js}; const set = Object.getOwnPropertyDescriptor(el.__proto__, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
// Eased scroll so the move reads on camera: an element to the viewport's `at` (0 top … 1 bottom), or by pixels.
async function scroll(target, ms = 1400, at = 0.35) {
  const to = typeof target === 'number'
    ? `scrollY + ${target}`
    : `(() => { const el = ${target}; return el ? scrollY + el.getBoundingClientRect().top - innerHeight * ${at} : scrollY; })()`;
  await ev(`new Promise((done) => { const from = scrollY, to = Math.max(0, Math.min(${to}, document.documentElement.scrollHeight - innerHeight)), t0 = performance.now();
    const step = (t) => { const k = Math.min(1, (t - t0) / ${ms}); const e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; scrollTo(0, from + (to - from) * e); k < 1 ? requestAnimationFrame(step) : done(true); };
    requestAnimationFrame(step); })`);
}

// ---------- recording: CDP screencast frames → constant-frame-rate MP4 ----------
async function record(name, kind, url, body) {
  // Load and warm the page first (dev compiles routes on first visit), so the clip opens on its own screen.
  await go(url); await go(url);
  const dir = path.join(OUT, `_frames-${name}`);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  listeners.set('Page.screencastFrame', (p) => {
    const f = path.join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(p.data, 'base64'));
    frames.push({ f, t: p.metadata.timestamp });
    send('Page.screencastFrameAck', { sessionId: p.sessionId });
  });
  const v = VIEW[kind];
  await send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: v.width * v.deviceScaleFactor, maxHeight: v.height * v.deviceScaleFactor, everyNthFrame: 1 });
  await sleep(300);
  await body();
  await sleep(200);
  const tEnd = Date.now() / 1000;
  await send('Page.stopScreencast');
  listeners.delete('Page.screencastFrame');
  if (!frames.length) throw new Error(`${name}: no frames`);
  // The screencast only sends frames when pixels change, so each frame holds until the next one arrives.
  const lines = frames.map((fr, i) => `file '${path.basename(fr.f)}'\nduration ${Math.max(1 / FPS, ((frames[i + 1]?.t ?? tEnd) - fr.t)).toFixed(4)}`);
  lines.push(`file '${path.basename(frames.at(-1).f)}'`);
  fs.writeFileSync(path.join(dir, 'list.txt'), lines.join('\n'));
  const out = path.join(OUT, `${name}.mp4`);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vf', `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-movflags', '+faststart', out], { cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
  console.log(`  ${name}.mp4  ${dur.toFixed(1)} s  (${frames.length} frames)`);
}

// ---------- the beats (see the episode script) ----------
const A = '/app/demo-brooks';
const T = plan.typed_live, C = plan.typed_care;
// The Approve button on the storm-season post's card (the decision form sits inside the card with the post text).
const APPROVE_STORM = `[...document.querySelectorAll('button[value=approved]')].find((b) => { let el = b; for (let i = 0; i < 6 && el; i++, el = el.parentElement) if (el.textContent.toLowerCase().includes('storm season')) return true; return false; })`;
const CLIPS = {
  // 14–24 "Your calls are ready the night before: who, when and why. Anything urgent stays on top."
  'today-phone': ['phone', false, `${A}/today?film=1`, async () => {
    await sleep(2600);
    await scroll(byText('section', 'Client notes'), 1600, 0.12); await sleep(2000);
    await scroll(byText('section', 'Priority follow-ups'), 1400, 0.2); await sleep(2400);
  }],
  // 24–34 Trent's Garcia renewal, already on the right day.
  'followups-desktop': ['desktop', false, `${A}/follow-ups?film=1`, async () => {
    await sleep(2400);
    await scroll(byText('li, tr, article', 'The Garcias'), 1500, 0.4); await sleep(3000);
  }],
  'followups-phone': ['phone', false, `${A}/follow-ups?film=1`, async () => {
    await sleep(2200);
    await scroll(byText('li, tr, article', 'The Garcias'), 1500, 0.35); await sleep(2800);
  }],
  // 34–42 Bri logs the Thompsons in seconds.
  'followups-add-phone': ['phone', true, `${A}/follow-ups?film=1`, async () => {
    await sleep(1500);
    await scroll('document.querySelector("input[name=who]")', 1200, 0.25); await sleep(600);
    await type('document.querySelector("input[name=who]")', T.who);
    await type('document.querySelector("input[name=reason]")', T.reason, 22);
    const d = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + T.day);
    await setValue('document.querySelector("input[name=due]")', d.toISOString().slice(0, 10));
    await setValue('document.querySelector("input[name=at]")', T.at); await sleep(500);
    await tap(byText('button', 'Save follow-up')); await sleep(2200);
    await scroll(byText('li, tr, article', T.who), 1500, 0.35); await sleep(2600);
  }],
  // 42–50 One tap to approve, and the record of every decision.
  'approvals-desktop': ['desktop', true, `${A}/approvals?film=1`, async () => {
    await sleep(2000);
    await scroll(byText('article, .panel, .card, li', 'storm season'), 1300, 0.2); await sleep(1800);
    await tap(APPROVE_STORM);
    await sleep(2600);
    await scroll(byText('h2, h3, .panel-title, section', 'Your approval record'), 1500, 0.2); await sleep(2600);
  }],
  'approvals-phone': ['phone', true, `${A}/approvals?film=1`, async () => {
    await sleep(1800);
    await scroll(byText('article, .panel, .card, li', 'storm season'), 1300, 0.15); await sleep(1600);
    await tap(APPROVE_STORM);
    await sleep(2600);
  }],
  // 50–58 Every lead, link by link.
  'performance-desktop': ['desktop', false, `${A}/performance?film=1`, async () => {
    await sleep(2600);
    await scroll(byText('h2, h3, .panel-title, section', 'This month, link by link'), 1800, 0.15); await sleep(2400);
    await scroll(byText('h2, h3, .panel-title, section', 'Time to first reply'), 1600, 0.2); await sleep(2200);
  }],
  // 58–64 Ask for a change; posts already on the calendar.
  'care-desktop': ['desktop', true, `${A}/care?film=1`, async () => {
    await sleep(1800);
    await setValue('document.querySelector("select[name=kind]")', C.kind); await sleep(300);
    await type('document.querySelector("input[name=title]")', C.title);
    await type('document.querySelector("textarea[name=detail]")', C.detail, 26);
    await tap(byText('button', 'Send request')); await sleep(2200);
    await scroll(byText('h2, h3, .panel-title, section', 'Content calendar'), 1600, 0.15); await sleep(2600);
  }],
  // Establishing: the agency's home.
  'home-desktop': ['desktop', false, `${A}?film=1`, async () => {
    await sleep(3000);
    await scroll(700, 2600); await sleep(2000);
  }],
};

try {
  const link = await stage(ORIGIN);
  await view('desktop');
  const p = new URL(link);
  await go(p.pathname + p.search);
  await tap(byText('button', 'Continue to Genovus'));
  for (let i = 0; i < 60 && !(await ev('location.pathname')).startsWith('/app/demo-brooks'); i++) await sleep(250);
  if (!(await ev('location.pathname')).startsWith('/app/demo-brooks')) throw new Error(`sign-in did not land on the agency (at ${await ev('location.href')})`);
  console.log(`signed in as the filming owner · writing to ${OUT}`);
  for (const [name, [kind, mutates, url, body]] of Object.entries(CLIPS)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    if (mutates) await stage(ORIGIN);
    await view(kind);
    try { await record(name, kind, url, body); } catch (e) { console.log(`  ${name}: FAILED ${e.message}`); }
  }
  await stage(ORIGIN); // leave the demo agency in its filming state
} finally {
  try { await send('Browser.close'); } catch {}
  ws.close(); cleanup();
}
process.exit(0);
