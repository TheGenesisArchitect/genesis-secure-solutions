// Verify the Genovus line on the PREVIEW database with a Twilio stand-in (no real numbers, no real calls): the phone
// service is proven on Genovus's own line before any agency can get a number, and then only as a Growth option.
//  1. before any calls: the Call list shows "Proving"; an agency's phone panel says it's offered after the proof
//  2. signed Twilio webhooks to the Genovus number: one answered (recorded), one missed; Helix's note is written
//  3. the Call list shows "Proven", the call with its note and a recording that plays
//  4. the agency panel now asks for the Call tracking option; switched on, the button opens
// Cleans up its own number, calls and grant at the end.
//   node --env-file=.env.local scripts/verify-genovus-line.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39556;
const TW_TOKEN = 'test-twilio-token';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house account');
const agency = must(await db.from('tenants').select('id').eq('slug', 'test-launch').single(), 'test agency (run verify-agency-dashboard.mjs first)');
const staffRow = must(await db.from('staff').select('user_id').limit(1).single(), 'a staff user');
const staffEmail = must(await db.auth.admin.getUserById(staffRow.user_id), 'staff email').user.email;
const TN = '+17065550888', RINGS = '+17065550111';
// Never touch a real Genovus line: only this script's stand-in number may exist on the house account.
const real = must(await db.from('tracking_numbers').select('e164, twilio_sid').eq('tenant_id', house.id), 'house numbers').filter((n) => n.twilio_sid !== 'PNhouse');
if (real.length) throw new Error(`refusing: the Genovus account has a real number (${real.map((n) => n.e164).join(', ')})`);
const clean = async () => {
  must(await db.from('calls').delete().eq('tenant_id', house.id), 'clear house calls');
  must(await db.from('tracking_numbers').delete().eq('tenant_id', house.id), 'clear house numbers');
  must(await db.from('leads').delete().eq('tenant_id', house.id).eq('channel', 'call'), 'clear house call leads');
  must(await db.from('follow_ups').delete().eq('tenant_id', house.id).ilike('reason', 'Missed call%'), 'clear house callbacks');
  must(await db.from('module_grants').delete().eq('tenant_id', agency.id).eq('module_key', 'calls'), 'clear calls option');
};
await clean();
const prior = (await db.from('agency_profiles').select('*').eq('tenant_id', house.id).maybeSingle()).data;
const priorProfile = prior?.main_phone_e164 === '+17065550111' ? null : prior;
must(await db.from('agency_profiles').upsert({ tenant_id: house.id, main_phone_e164: RINGS, lines: [], service_radius_mi: 15, licensed_states: [] }), 'house profile');
// The number is connected through the console ("connect a number you bought in Twilio"), against the stand-in.
let configured = null;

const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    if (/Recordings\/.+\.mp3/.test(req.url)) { res.setHeader('content-type', 'audio/mpeg'); return res.end(Buffer.alloc(64)); }
    res.setHeader('content-type', 'application/json');
    // The number as bought in the Twilio console (still on the demo webhooks), then Genovus re-pointing it.
    if (req.method === 'GET' && req.url.includes('/IncomingPhoneNumbers.json')) return res.end(JSON.stringify({ incoming_phone_numbers: decodeURIComponent(req.url).includes(TN) ? [{ sid: 'PNhouse', phone_number: TN }] : [] }));
    if (req.method === 'POST' && req.url.includes('/IncomingPhoneNumbers/PNhouse.json')) { configured = Object.fromEntries(new URLSearchParams(body)); return res.end(JSON.stringify({ sid: 'PNhouse', phone_number: TN })); }
    res.statusCode = 404; res.end('{}');
  });
}).listen(MOCK);
const env = { ...process.env, TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: TW_TOKEN, TWILIO_API_BASE: `http://localhost:${MOCK}`, GEMINI_API_KEY: '' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

// Headless Chrome, signed in as Genovus staff.
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9493, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await cdp('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const text = () => ev('document.body.innerText');
const shot = async (name, w = 1440) => {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 600 }); await sleep(400);
  const fh = await ev('Math.min(document.documentElement.scrollHeight, 4200)');
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: fh, deviceScaleFactor: 1, mobile: w < 600 }); await sleep(300);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
};
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: staffEmail }), 'link');
await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith('/console'); i++) await sleep(250);

// 1. Before the proof.
await go('/console/prospects/calls');
let t1 = await text();
check(/Genovus line/.test(t1) && /Proving/i.test(t1) && /Agencies can’t get numbers/.test(t1), 'Call list: the Genovus line shows "Proving" before any calls');
await go('/console/clients/test-launch');
check(/Offered after the Genovus line is proven/.test(await text()), 'agency phone panel: offered only after the Genovus line is proven');
check(/Call tracking/.test(await text()) && /Growth option/.test(await text()), 'Modules list shows Call tracking as a Growth option');

// Connect the number bought in Twilio (no copying URLs).
await go('/console/prospects/calls');
await ev(`(() => { const f = [...document.querySelectorAll('form')].find((x) => /connect a number you bought in Twilio/i.test(x.innerText)); const i = f.querySelector('input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '(706) 555-0888'); i.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => f.requestSubmit(), 100); return true; })()`);
for (let i = 0; i < 40 && !configured; i++) await sleep(250);
await sleep(1500);
const conn = must(await db.from('tracking_numbers').select('e164, twilio_sid, forward_to, label').eq('tenant_id', house.id).is('released_at', null), 'connected');
check(configured && /\/api\/voice\/incoming$/.test(configured.VoiceUrl) && configured.VoiceMethod === 'POST' && configured.SmsUrl === '', `connecting re-points the number's calls to Genovus and turns off the demo text reply (${configured?.VoiceUrl})`);
check(conn.length === 1 && conn[0].e164 === TN && conn[0].twilio_sid === 'PNhouse' && conn[0].forward_to === RINGS, 'the connected number is the Genovus line, ringing the saved phone');

// 2. Calls to the Genovus line, exactly as Twilio sends them.
const sign = (url, p) => createHmac('sha1', TW_TOKEN).update(url + Object.keys(p).sort().map((k) => k + p[k]).join('')).digest('base64');
const tw = async (route, p) => { const url = `${ORIGIN}${route}`; const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sign(url, p) }, body: new URLSearchParams(p) }); return [r.status, await r.text()]; };
const [s0, x0] = await tw('/api/voice/incoming', { CallSid: 'CAhouse1', To: TN, From: '+14045550142' });
check(s0 === 200 && x0.includes('may be recorded') && x0.includes(RINGS), 'a call to the Genovus number: recording notice, rings the Genovus phone');
await tw('/api/voice/dialed', { CallSid: 'CAhouse1', To: TN, From: '+14045550142', DialCallStatus: 'completed', DialCallDuration: '140' });
await tw('/api/voice/recording', { CallSid: 'CAhouse1', RecordingSid: 'REhouse1', RecordingDuration: '135', RecordingStatus: 'completed' });
await tw('/api/voice/incoming', { CallSid: 'CAhouse2', To: TN, From: '+14045550177' });
await tw('/api/voice/dialed', { CallSid: 'CAhouse2', To: TN, From: '+14045550177', DialCallStatus: 'no-answer', DialCallDuration: '0' });
// No Gemini key locally: write Helix's note the way summarizeCall does.
must(await db.rpc('set_call_summary', { p_call_sid: 'CAhouse1', p_summary: 'Dana, a State Farm agent in Atlanta, wants a site and lead tracking; asked for a demo Thursday at 2.' }), 'note');
const fu = must(await db.from('follow_ups').select('id').eq('tenant_id', house.id).ilike('reason', 'Missed call%'), 'callback');
check(fu.length === 1, 'the missed call became a call-back follow-up in the Genovus account');

// 3. Proven.
await go('/console/prospects/calls');
t1 = await text();
check(/Proven/i.test(t1) && /Helix: Dana, a State Farm agent/.test(t1) && /Answered/i.test(t1) && /Missed/i.test(t1), 'Call list: "Proven", both calls listed with Helix’s note');
const audio = await ev(`fetch(document.querySelector('audio')?.src ?? '/none').then((r) => r.status + ' ' + r.headers.get('content-type'))`);
check(/^200 audio\/mpeg/.test(audio ?? ''), `staff can play the Genovus line recording (${audio})`);
await shot('genovus-line-proven');
// The call leads and the call-back live in the Genovus account's own dashboard ("Open leads").
await go('/app/genovus/leads');
const lt = await text();
check(/\(404\) 555-0177/.test(lt) && /\(404\) 555-0142/.test(lt), 'Genovus leads: both callers are leads');
await shot('genovus-line-leads');
await go('/app/genovus/today');
check(/Call back/i.test(await text()) && (await text()).includes('Caller (404) 555-0177'), 'Genovus Today: the missed call is a call-back in Priority');

// 4. The agency now needs the option; switched on, the button opens.
await go('/console/clients/test-launch');
check(/Turn on the Call tracking option above first/.test(await text()), 'agency phone panel: proven, now asks for the Call tracking option');
must(await db.from('module_grants').insert({ tenant_id: agency.id, module_key: 'calls', until: null, reason: 'Verify option' }), 'grant option');
await go('/console/clients/test-launch');
const open = await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Get a number/.test(x.textContent)); return b ? !b.disabled : null; })()`);
check(open === true && !/Turn on the Call tracking option/.test(await text()), 'with the option on, "Get a number" opens for the agency');
await shot('genovus-line-agency-option');

await clean();
if (priorProfile) must(await db.from('agency_profiles').upsert(priorProfile), 'restore house profile');
else must(await db.from('agency_profiles').delete().eq('tenant_id', house.id), 'remove house profile');
console.log('screenshots in', OUT);
try { await cdp('Browser.close'); } catch {}
ws.close(); chrome.kill(); dev.kill(); mock.close();
spawn('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: 'ignore' });
setTimeout(() => process.exit(), 1500);
