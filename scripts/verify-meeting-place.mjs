// Verify a meeting with a long video link fits its calendar card (components/MeetingPlace.tsx) on PREVIEW, signed in
// as the agency's owner, at desktop and phone width:
//  1. the location shows as "Join Zoom meeting ↗" (the full link behind it), not the raw link
//  2. nothing in any calendar card is wider than the card; the page never scrolls sideways
//  3. a plain place ("Office, 6053 Veterans Pkwy …") still shows as text and wraps
//   node --env-file=.env.local scripts/verify-meeting-place.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3954, ORIGIN = `http://localhost:${PORT}`, SLUG = 'test-launch';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const t = must(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) throw new Error(`${SLUG} is missing: run verify-agency-dashboard.mjs first`);
const email = `owner@${SLUG}.example`;
const ZOOM = 'https://us06web.zoom.us/j/82007400993?pwd=dOkw0Fx1xearQcTUtqNEbSB9rPdabj.1';
// Tomorrow at 10 and 2 Eastern-ish (UTC 15:00, 19:00), in this week's view unless tomorrow starts a new week.
const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
// The calendar is a Growth feature; the Launch test agency gets a short grant for this check, removed at the end.
const clean = async () => {
  await db.from('calendar_events').delete().eq('tenant_id', t.id).like('title', 'MP %');
  await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', 'verify-meeting-place');
};
await clean();
must(await db.from('module_grants').insert({ tenant_id: t.id, module_key: 'calendar', until: new Date(Date.now() + 3_600_000).toISOString(), reason: 'verify-meeting-place' }), 'grant');
must(await db.from('calendar_events').insert([
  { tenant_id: t.id, title: 'MP Genovus Ads Meeting for Java Agency', starts_at: `${day}T15:00:00Z`, ends_at: `${day}T16:00:00Z`, location: ZOOM, notes: 'Strategy Meeting for FB and Google Ads', host: 'genovus' },
  { tenant_id: t.id, title: 'MP Partner lunch', starts_at: `${day}T19:00:00Z`, ends_at: `${day}T20:00:00Z`, location: 'Office, 6053 Veterans Pkwy Suite 201, Columbus, GA 31909', notes: null, host: 'agency' },
]), 'events');
const week = (() => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy`);
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
if (!(await up())) throw new Error(`the dev server on port ${PORT} didn't start: stop any other "next dev" for this project`);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9507, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const size = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
const shot = async (name) => {
  const full = await ev('Math.min(document.documentElement.scrollHeight, 3000)');
  const m = await ev('innerWidth');
  await size(m, full, m < 600); await sleep(400);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64'));
};
const measure = () => ev(`(() => {
  const cards = [...document.querySelectorAll('.cal-item')];
  const over = cards.filter((c) => c.scrollWidth > c.clientWidth + 1 || [...c.querySelectorAll('*')].some((x) => x.getBoundingClientRect().right > c.getBoundingClientRect().right + 1)).map((c) => c.innerText.split('\\n').slice(0, 2).join(' '));
  const mp = cards.find((c) => /MP Genovus Ads Meeting/.test(c.innerText));
  const a = mp && [...mp.querySelectorAll('a')].find((x) => /Join/.test(x.textContent));
  const lunch = cards.find((c) => /MP Partner lunch/.test(c.innerText));
  return { cards: cards.length, over, join: a ? a.textContent.trim() : null, href: a ? a.getAttribute('href') : null, raw: mp ? mp.innerText.includes('us06web.zoom.us') : null,
    lunch: lunch ? /6053 Veterans Pkwy/.test(lunch.innerText) : null, sideways: document.documentElement.scrollWidth > innerWidth };
})()`);

try {
  await size(1440, 900, false);
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`/app/${SLUG}/calendar?week=${week}`)}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await sleep(4000);
  await go(`/app/${SLUG}/calendar?week=${week}`);
  for (const [label, w, h, mobile] of [['desktop', 1440, 900, false], ['narrow desktop', 1100, 800, false], ['phone', 390, 844, true]]) {
    await size(w, h, mobile); await sleep(800);
    const m = await measure();
    check(m.join === 'Join Zoom meeting ↗' && m.href === ZOOM && m.raw === false, `${label}: the Zoom link shows as “${m.join}”, the full link behind it`);
    check(m.cards >= 2 && m.over.length === 0, `${label}: nothing runs past its calendar card (${m.cards} cards${m.over.length ? `; over: ${m.over.join(' | ')}` : ''})`);
    check(m.lunch === true && m.sideways === false, `${label}: a street address stays text, and the page doesn't scroll sideways`);
    await shot(`meeting-place-${label.replace(' ', '-')}`);
  }
} finally {
  await clean();
  try { ws.close(); } catch {}
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  try { execSync(`taskkill /pid ${dev.pid} /T /F`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
