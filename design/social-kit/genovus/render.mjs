// Renders the social kit HTML files to PNG at exact pixel sizes through headless Chrome.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const OUT = 'C:/Users/mrbee/Projects/genesis-secure-solutions/public/brand/genovus';
const jobs = [
  ['cover.html', 1640, 624, 'genovus-facebook-cover.png'],
];
const port = 9447;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${path.resolve('chrome-kit')}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
for (const [file, w, h, out] of jobs) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(path.resolve(file)).href });
  await new Promise((r) => setTimeout(r, 2500));
  const fonts = (await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family + " " + f.weight).join(", "))', awaitPromise: true, returnByValue: true })).result?.result?.value;
  const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: w, height: h, scale: 1 } });
  fs.writeFileSync(`${OUT}/${out}`, Buffer.from(s.result.data, 'base64'));
  console.log(out, 'fonts:', fonts);
}
try { await send('Browser.close'); } catch {}
chrome.kill(); process.exit(0);
