// Verify the production security headers allow every browser capability the code actually uses. The dev server
// never sends these headers (next.config.ts only adds them when NODE_ENV=production), so the other verifiers can't
// see this class of bug: the Studio recorder passed every dev test while genovus.io blocked its camera
// (Permissions-Policy camera=()) and its upload to Blob (CSP connect-src).
//
// 1. Always (no server, CI-safe): scan the source for each capability's use; for each one in use, the production
//    Permissions-Policy / Content-Security-Policy from next.config.ts must allow it.
// 2. With --origin (a production build or the live site): headless Chrome with a fake camera loads the page under
//    the real headers and opens the camera and microphone, reaches the Blob upload endpoint and Helix's voice
//    socket, and reports any CSP violation. Nothing is uploaded or generated.
//   node scripts/verify-prod-headers.mjs
//   node scripts/verify-prod-headers.mjs --origin https://genovus.io
//   (local: npm run build && npx next start -p 3956, then --origin http://localhost:3956)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const ORIGIN = arg('--origin');

let failed = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m) => { failed++; console.log(`FAIL  ${m}`); };

// --- 1. The production headers, exactly as next.config.ts builds them --------------------------------------------
process.env.NODE_ENV = 'production';
const warn = process.listeners('warning');
process.removeAllListeners('warning'); // Node's "module type not specified" notice for next.config.ts; harmless here
const config = (await import(pathToFileURL(path.join(ROOT, 'next.config.ts')).href)).default;
for (const l of warn) process.on('warning', l);
const all = (await config.headers()).find((h) => h.source === '/:path*')?.headers ?? [];
const header = (k) => all.find((h) => h.key.toLowerCase() === k.toLowerCase())?.value ?? '';
const csp = Object.fromEntries(header('Content-Security-Policy').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));
const perms = Object.fromEntries(header('Permissions-Policy').split(',').map((p) => p.trim().match(/^([a-z-]+)=\((.*)\)$/)).filter(Boolean).map((m) => [m[1], m[2].split(/\s+/).filter(Boolean)]));
if (!header('Content-Security-Policy') || !header('Permissions-Policy')) fail('next.config.ts sends a Content-Security-Policy and Permissions-Policy in production');

// A CSP source expression covers a URL (simplified to the forms this config uses: keywords, scheme-only, origin, path prefix).
const covers = (src, url) => {
  if (src === '*') return true;
  if (src.startsWith("'")) return false; // 'self' is checked separately: these URLs are other origins
  if (/^[a-z]+:$/.test(src)) return url.startsWith(src);
  const u = new URL(url), s = new URL(src);
  if (s.protocol !== u.protocol || s.host !== u.host) return false;
  return s.pathname === '/' || (s.pathname.endsWith('/') ? u.pathname.startsWith(s.pathname) : u.pathname === s.pathname);
};
const directive = (d) => csp[d] ?? csp['default-src'] ?? [];

// --- What the code uses ---------------------------------------------------------------------------------------
const files = [];
const walk = (dir) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|jsx?)$/.test(e.name)) files.push(p); } };
for (const d of ['app', 'components', 'lib']) walk(path.join(ROOT, d));
const src = files.map((f) => ({ f: path.relative(ROOT, f).replaceAll('\\', '/'), t: fs.readFileSync(f, 'utf8') }));
const usedBy = (re) => src.filter((s) => re.test(s.t)).map((s) => s.f);

const NEEDS = [
  { what: 'the camera (Studio Finish dialogue recorder)', use: /getUserMedia\(\s*\{[^}]*video\s*:/, ok: () => (perms.camera ?? []).includes('self'), want: 'Permissions-Policy camera=(self)' },
  { what: 'the microphone (Helix voice, recorder)', use: /getUserMedia\(\s*\{[^)]*audio\s*:/, ok: () => (perms.microphone ?? []).includes('self'), want: 'Permissions-Policy microphone=(self)' },
  { what: 'direct-to-Blob uploads (@vercel/blob/client)', use: /from ['"]@vercel\/blob\/client['"]/, ok: () => directive('connect-src').some((s) => covers(s, 'https://vercel.com/api/blob/?pathname=x')), want: 'connect-src https://vercel.com/api/blob/' },
  { what: "Helix's voice socket (Gemini Live)", use: /wss:\/\/generativelanguage\.googleapis\.com/, ok: () => directive('connect-src').some((s) => covers(s, 'wss://generativelanguage.googleapis.com/ws/x')), want: 'connect-src wss://generativelanguage.googleapis.com' },
  { what: 'playing recorded clips from blob: URLs', use: /URL\.createObjectURL\(/, ok: () => directive('media-src').includes('blob:'), want: "media-src blob:" },
  { what: 'the Helix microphone worklet', use: /audioWorklet\.addModule\(/, ok: () => directive('script-src').includes("'self'"), want: "script-src 'self'" },
];
for (const n of NEEDS) {
  const by = usedBy(n.use);
  if (!by.length) { console.log(`skip  ${n.what}: not used in the code`); continue; }
  (n.ok() ? pass : fail)(`production headers allow ${n.what}: ${n.want} (used by ${by.slice(0, 3).join(', ')}${by.length > 3 ? ', …' : ''})`);
}

// --- 2. A real browser under the real headers -----------------------------------------------------------------
if (ORIGIN) {
  const CH = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
  const port = 9335, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-headers-'));
  const chrome = spawn(CH, ['--headless=new', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let tgt; for (let i = 0; i < 60 && !tgt; i++) { await sleep(250); try { tgt = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
    if (!tgt) throw new Error(`Chrome didn't start (${CH}; set CHROME to its path)`);
    const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
    let id = 0; const pend = new Map();
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
    const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (e) => (await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
    await cdp('Page.enable');
    await cdp('Page.navigate', { url: ORIGIN }); await sleep(3000);
    const r = await ev(`(async () => {
      const v = []; document.addEventListener('securitypolicyviolation', (e) => v.push(e.violatedDirective + ' ' + e.blockedURI));
      const out = {};
      try { const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true }); out.video = s.getVideoTracks().length; out.audio = s.getAudioTracks().length; s.getTracks().forEach((t) => t.stop()); } catch (e) { out.video = 0; out.audio = 0; out.mediaError = e.name; }
      try { await fetch('https://vercel.com/api/blob/?pathname=header-probe', { method: 'OPTIONS' }); out.blob = true; } catch (e) { out.blob = false; }
      out.wss = await new Promise((done) => { try { const w = new WebSocket('wss://generativelanguage.googleapis.com/ws/header-probe'); w.onopen = w.onerror = w.onclose = () => { w.close(); done(true); }; setTimeout(() => done(true), 4000); } catch { done(false); } });
      await new Promise((d) => setTimeout(d, 500)); out.violations = v; return out; })()`);
    const blocked = (p) => r.violations.some((x) => x.includes(p));
    (r.video > 0 ? pass : fail)(`${ORIGIN}: the camera opens under the production headers (${r.video} video track${r.mediaError ? `, ${r.mediaError}` : ''})`);
    (r.audio > 0 ? pass : fail)(`${ORIGIN}: the microphone opens (${r.audio} audio track)`);
    (r.blob && !blocked('vercel.com') ? pass : fail)(`${ORIGIN}: the page can reach the Blob upload endpoint (no connect-src block)`);
    (r.wss && !blocked('generativelanguage') ? pass : fail)(`${ORIGIN}: the page can open Helix's voice socket (no connect-src block)`);
    (!r.violations.length ? pass : fail)(`${ORIGIN}: no CSP violations while probing${r.violations.length ? `: ${r.violations.join('; ')}` : ''}`);
    ws.close();
  } catch (e) { fail(`browser probe: ${e instanceof Error ? e.message : e}`); }
  finally { chrome.kill(); }
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
