// Renders the "Cast of Genovus" Facebook Highlights cards (1080x1920) through headless Chrome.
// Run from this folder: node render-cast.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const OUT = path.resolve('../../../public/brand/genovus/cast-highlights');
fs.mkdirSync(OUT, { recursive: true });
const cards = ['intro', 'marcus', 'tasha', 'julian'];
const port = 9448;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-kit-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false });
for (const [n, c] of cards.entries()) {
  await send('Page.navigate', { url: pathToFileURL(path.resolve('cast-card.html')).href + '?c=' + c });
  await new Promise((r) => setTimeout(r, 2500));
  const fonts = (await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family + " " + f.weight).join(", "))', awaitPromise: true, returnByValue: true })).result?.result?.value;
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1080, height: 1920, scale: 1 } });
  const out = `${n + 1}-${c}.png`;
  fs.writeFileSync(path.join(OUT, out), Buffer.from(s.result.data, 'base64'));
  console.log(out, 'fonts:', fonts);
}
try { await send('Browser.close'); } catch {}
chrome.kill(); process.exit(0);
