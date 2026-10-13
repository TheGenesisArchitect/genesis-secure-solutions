// Verify the StudioNext home on the PREVIEW database: the billboard features the trailer (gjk-h01, coming soon),
// the rows show box art, the V2 cast is on the Studio, and the trailer's board opens with Runway shots.
// Read-only: it signs in as an admin and looks; nothing is generated.
//   node --env-file=.env.local scripts/verify-studio-home.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy`);

const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const email = must(await db.auth.admin.getUserById(admin.user_id), 'email').user.email;
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env } });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9496, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await cdp('Page.navigate', { url: ORIGIN + u }); await l; await sleep(2000); };
const shot = async (name, h = 900) => { await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(500); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console/studio')}`);
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith('/console'); i++) await sleep(250);

await go('/console/studio');
const t = await ev('document.body.innerText');
check(await ev(`!!document.querySelector('.sx-bill')`) && /Just Ask Helix · Series Trailer/.test(t) && /Coming soon/i.test(t), 'billboard features the trailer as coming soon');
check(await ev(`document.querySelectorAll('.sx-card').length`) >= 3, `rows of box art (${await ev(`document.querySelectorAll('.sx-card').length`)} cards)`);
check(/Cast · Marcus, Tasha and Julian/.test(t) && await ev(`[...document.querySelectorAll('.cast-card img')].some((i) => /studio\\/cast\\/(marcus|tasha|julian)\\.jpg/.test(i.src) && i.naturalWidth > 0)`), 'the V2 cast shows on the Studio with their portraits');
check(/Runway engine/i.test(t), 'the Runway engine tile is on the Studio');
await shot('studio-home');
await shot('studio-home-full', 2000);
// The old cast is retired everywhere on the front page.
const rows = await ev(`[...document.querySelectorAll('.sx-row')].map((r) => ({ h: r.querySelector('h3').textContent, cards: [...r.querySelectorAll('.sx-info b')].map((b) => b.textContent) }))`);
const soonRow = rows.find((r) => /Coming soon/.test(r.h)), vault = rows.find((r) => /Archive/.test(r.h));
check(soonRow && soonRow.cards.length === 1 && /Just Ask Helix/.test(soonRow.cards[0]) && vault && vault.cards.length >= 4, `Coming soon holds only the V2 trailer; the old episodes sit in the archive (${vault?.cards.length ?? 0})`);
const below = await ev(`(() => { const s = [...document.querySelectorAll('.panel')].filter((p) => /Series bible|Fresh takes/.test(p.innerText)); return s.map((p) => p.innerText).join(' '); })()`);
check(!/Maya|Trent|\bBri\b/.test(below) && /Marcus/.test(below) && /No takes yet from Marcus, Tasha and Julian/.test(below), 'Series bible and Fresh takes show only the V2 cast');

await go('/console/studio/gjk-h01');
const t2 = await ev('document.body.innerText');
check(await ev(`!!document.querySelector('.pb')`) && await ev(`document.querySelectorAll('.pb-card2').length`) === 12, 'the trailer opens on the production board with 12 shots');
check(/Seedance 2\.5 · hero/i.test(t2) && /Phone capture|Real screen/i.test(t2) && /Production run/i.test(t2) && await ev(`document.querySelectorAll('.pb-member').length`) === 3, 'board shows engines, the capture, the estimate and the 3 cast members');
check(await ev(`!!document.querySelector('.pb-read i')`), 'line reads show their direction tags');
await shot('studio-trailer-board', 1400);
// Direct a shot: the change saves to the shot's log.
const shotRow = must(await db.from('studio_shots').select('id, log, studio_episodes!inner(code)').eq('studio_episodes.code', 'gjk-h01').eq('n', 110).single(), 'shot 110');
const prior = shotRow.log;
await ev(`(() => { const a = document.querySelector('#shot-110 details'); a.open = true; const f = a.querySelector('form'); const i = f.querySelector('input[name=acting]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Verify: a slower turn, eyes first'); i.dispatchEvent(new Event('input', { bubbles: true })); f.requestSubmit(); return true; })()`);
let saved = null; for (let i = 0; i < 40; i++) { saved = (await db.from('studio_shots').select('log').eq('id', shotRow.id).single()).data?.log; if (saved?.acting === 'Verify: a slower turn, eyes first') break; await sleep(250); }
check(saved?.acting === 'Verify: a slower turn, eyes first', 'directing a shot saves the acting note on the shot');
must(await db.from('studio_shots').update({ log: prior }).eq('id', shotRow.id), 'restore shot log');
await go('/console/studio/gjk-t1');
check(/Archived · made with the retired development cast/i.test(await ev('document.body.innerText')), 'an old episode is marked archived');
await go('/console/studio/library');
const libCards = await ev(`document.querySelectorAll('.sl-card').length`);
const stillsOk = await ev(`Promise.all([...document.querySelectorAll('.sl-card img')].slice(0, 6).map((i) => i.decode().then(() => i.naturalWidth > 0).catch(() => false))).then((r) => r.every(Boolean))`);
check(libCards >= 30 && stillsOk && /Waiting to be captured/i.test(await ev('document.body.innerText')), `the Screen Library shows real captured screens (${libCards}) and what's still waiting`);
await ev(`document.querySelector('.sl-card .sp-play').click()`); await new Promise((r) => setTimeout(r, 900));
check(await ev(`!!document.querySelector('.sp-back video')`), 'pressing play on a library screen opens the player');
await shot('screen-library', 1600);
` + '' + `
await go('/console/studio/bible');
const tb = await ev('document.body.innerText');
check(/Version 2/.test(tb) && /Marcus/.test(tb) && /The camera break/i.test(tb) && !/Maya addresses/.test(tb), 'the Character Bible page is V2');
if (!/Version 2/.test(tb)) console.log('BIBLE TEXT:', tb.slice(0, 400));

console.log('screenshots in', OUT);
try { await cdp('Browser.close'); } catch {}
ws.close(); chrome.kill(); dev.kill();
spawn('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: 'ignore' });
setTimeout(() => process.exit(), 1500);
