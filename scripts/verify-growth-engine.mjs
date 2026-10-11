// Verify the Agency Growth Engine end to end on the PREVIEW database with stand-ins for Google Places and Twilio
// (no real spend, no real calls). Uses the "test-launch" agency from verify-agency-dashboard.mjs (run that first):
//  1. agency profile, with the office placed by the free US Census geocoder
//  2. a tracking number; two signed Twilio webhooks per call: one answered (recorded), one missed (voicemail)
//  3. the partner radar through the scan cron against a fake Places API (in-radius, out-of-radius, a competitor)
//  4. signs in as the owner and screenshots Home, Leads, Partners, Market, Calendar and the Helix drawer
//   node --env-file=.env.local scripts/verify-growth-engine.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39555;
const TW_TOKEN = 'test-twilio-token', CRON = 'test-cron-secret';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };

const t = must(await db.from('tenants').select('id').eq('slug', 'test-launch').single(), 'tenant (run verify-agency-dashboard.mjs first)');

// 1. Profile: the office placed by the Census geocoder (the same call the console makes).
const geo = await (await fetch('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent('6053 Veterans Pkwy, Columbus, GA 31909'))).json();
const c = geo.result?.addressMatches?.[0]?.coordinates;
check(!!c, `Census geocoder placed the office (${c?.y?.toFixed(4)}, ${c?.x?.toFixed(4)})`);
const office = { lat: c?.y ?? 32.54, lng: c?.x ?? -84.95 };
must(await db.from('agency_profiles').upsert({ tenant_id: t.id, address: '6053 Veterans Pkwy Ste 201', city: 'Columbus', state: 'GA', zip: '31909', lat: office.lat, lng: office.lng, lines: ['auto', 'home', 'renters', 'boat', 'rv', 'motorcycle'], service_radius_mi: 15, licensed_states: ['GA', 'AL'], carrier: 'GEICO', main_phone_e164: '+17065550100', website: 'https://example.com' }), 'profile');
must(await db.from('module_grants').delete().eq('tenant_id', t.id), 'clear grants');
must(await db.from('module_grants').insert(['pipeline', 'calendar', 'helix', 'kpis', 'content', 'partners', 'market'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 30 * 86_400_000).toISOString(), reason: 'Verify trial' }))), 'grants');
for (const tbl of ['calls', 'partner_events', 'partner_targets', 'partner_scans', 'tracking_numbers']) must(await db.from(tbl).delete().eq('tenant_id', t.id), `clear ${tbl}`);
must(await db.from('leads').delete().eq('tenant_id', t.id).eq('channel', 'call'), 'clear call leads');
must(await db.from('follow_ups').delete().eq('tenant_id', t.id).ilike('reason', 'Missed call%'), 'clear callbacks');
const TN = '+17065550999';
must(await db.from('tracking_numbers').insert({ tenant_id: t.id, e164: TN, twilio_sid: 'PNtest', label: 'Website', source: 'website', forward_to: '+17065550100' }), 'number');

// Stand-ins: Google Places (searchText + details) and Twilio (recording audio).
const off = (dLat, dLng) => ({ latitude: office.lat + dLat, longitude: office.lng + dLng });
const PLACES = {
  'car dealership': [{ id: 'mock-dealer-1', displayName: { text: 'Columbus Toyota' }, types: ['car_dealer'], location: off(0.02, 0.03) }, { id: 'mock-dealer-2', displayName: { text: 'Riverside Ford' }, types: ['car_dealer'], location: off(-0.05, 0.02) }, { id: 'mock-far', displayName: { text: 'Atlanta Motors' }, types: ['car_dealer'], location: off(0.6, 0.6) }],
  'real estate agency': [{ id: 'mock-realtor-1', displayName: { text: 'Peachtree Realty' }, types: ['real_estate_agency'], location: off(0.01, -0.02) }, { id: 'mock-insurer', displayName: { text: 'Another Insurance Agency' }, types: ['insurance_agency'], location: off(0.01, 0.01) }],
  marina: [{ id: 'mock-marina-1', displayName: { text: 'Lake Oliver Marina' }, types: ['marina'], location: off(0.08, -0.1) }],
  'RV dealer': [{ id: 'mock-rv-1', displayName: { text: 'Chattahoochee RV' }, types: ['rv_dealer'], location: off(-0.03, -0.04) }],
};
const byId = Object.fromEntries(Object.values(PLACES).flat().map((p) => [p.id, p]));
let searches = 0;
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/places:searchText')) { searches++; const q = JSON.parse(body || '{}'); return res.end(JSON.stringify({ places: PLACES[q.textQuery] ?? [] })); }
    const m = req.url.match(/^\/v1\/places\/([^?]+)/);
    if (m) { const p = byId[decodeURIComponent(m[1])]; return res.end(JSON.stringify(p ? { displayName: p.displayName, formattedAddress: 'Columbus, GA', nationalPhoneNumber: '(706) 555-0123', websiteUri: 'https://example.com', googleMapsUri: 'https://maps.google.com' } : {})); }
    if (/Recordings\/.+\.mp3/.test(req.url)) { res.setHeader('content-type', 'audio/mpeg'); return res.end(Buffer.alloc(64)); }
    res.statusCode = 404; res.end('{}');
  });
}).listen(MOCK);

// Dev server with the stand-ins.
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, PLACES_API_BASE: `http://localhost:${MOCK}/v1`, GOOGLE_PLACES_API_KEY: 'test', TWILIO_ACCOUNT_SID: 'ACtest', TWILIO_AUTH_TOKEN: TW_TOKEN, TWILIO_API_BASE: `http://localhost:${MOCK}`, CRON_SECRET: CRON, GEMINI_API_KEY: '' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

// 2. Calls, exactly as Twilio sends them (signed form posts).
const sign = (url, p) => createHmac('sha1', TW_TOKEN).update(url + Object.keys(p).sort().map((k) => k + p[k]).join('')).digest('base64');
const tw = async (route, p, bad) => { const url = `${ORIGIN}${route}`; const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': bad ? 'nope' : sign(url, p) }, body: new URLSearchParams(p) }); return [r.status, await r.text()]; };
const [s0, x0] = await tw('/api/voice/incoming', { CallSid: 'CAanswered', To: TN, From: '+17065550142' });
check(s0 === 200 && x0.includes('may be recorded') && x0.includes('+17065550100'), 'incoming call: recording notice + forwards to the office');
check((await tw('/api/voice/incoming', { CallSid: 'CAforged', To: TN, From: '+1' }, true))[0] === 403, 'forged webhook is refused');
const [s1] = await tw('/api/voice/dialed', { CallSid: 'CAanswered', To: TN, From: '+17065550142', DialCallStatus: 'completed', DialCallDuration: '185' });
await tw('/api/voice/recording', { CallSid: 'CAanswered', RecordingSid: 'REtest1', RecordingDuration: '180', RecordingStatus: 'completed' });
await tw('/api/voice/incoming', { CallSid: 'CAmissed', To: TN, From: '+17065550177' });
const [s2, x2] = await tw('/api/voice/dialed', { CallSid: 'CAmissed', To: TN, From: '+17065550177', DialCallStatus: 'no-answer', DialCallDuration: '0' });
check(s1 === 200 && s2 === 200 && x2.includes('<Record'), 'missed call goes to voicemail');
const calls = must(await db.from('calls').select('call_sid, status, duration_s, recording_sid, lead_id').eq('tenant_id', t.id), 'calls');
const ans = calls.find((x) => x.call_sid === 'CAanswered'), mis = calls.find((x) => x.call_sid === 'CAmissed');
check(ans?.status === 'answered' && ans.duration_s === 185 && ans.recording_sid === 'REtest1' && ans.lead_id, 'answered call logged with length, recording and lead');
// Dana Ruiz (from the website, (706) 555-0142) called: the call joins her existing lead instead of a new one.
const dana = must(await db.from('leads').select('id, channel').eq('tenant_id', t.id).eq('ext_id', 'v1').maybeSingle(), 'dana');
check(ans?.lead_id === dana?.id, 'a call from an existing lead joins that lead (no duplicate)');
const fu = must(await db.from('follow_ups').select('who, reason').eq('tenant_id', t.id).ilike('reason', 'Missed call%'), 'fu');
check(mis?.status === 'missed' && fu.length === 1, 'missed call → a "call back" follow-up in Today');
const callLead = must(await db.from('leads').select('name, source, channel, consent_text').eq('id', mis.lead_id).single(), 'missed lead');
check(callLead.channel === 'call' && callLead.source === 'website' && /No texting consent/.test(callLead.consent_text), 'new caller becomes a call lead tagged website, with no texting consent');
const anon = await fetch(`${ORIGIN}/api/voice/recording/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}`);
check(anon.status === 404, 'recordings are not reachable without signing in');

// 3. The partner radar through the cron, against the stand-in Places API.
const queue = [['car-dealer', 'auto', 'car dealership', 'car_dealer', 30], ['realtor', 'home', 'real estate agency', 'real_estate_agency', 30], ['marina', 'boat', 'marina', undefined, 20], ['rv-dealer', 'rv', 'RV dealer', undefined, 30], ['title', 'home', 'title company', undefined, 16]]
  .map(([cat, line, query, type, weight]) => ({ cat, line, query, type, weight, rect: { south: office.lat - 0.22, north: office.lat + 0.22, west: office.lng - 0.26, east: office.lng + 0.26 } }));
must(await db.from('partner_scans').insert({ tenant_id: t.id, cap_cents: 2500, radius_mi: 15, queue }), 'scan');
const cron = await fetch(`${ORIGIN}/api/cron/scan`, { headers: { authorization: `Bearer ${CRON}` } }).then((r) => r.json());
const targets = must(await db.from('partner_targets').select('place_id, line, category, distance_mi, fit').eq('tenant_id', t.id), 'targets');
const scan = must(await db.from('partner_scans').select('status, requests, cost_cents, found').eq('tenant_id', t.id).single(), 'scan row');
check(targets.length === 5 && !targets.some((x) => x.place_id === 'mock-far') && !targets.some((x) => x.place_id === 'mock-insurer'), `radar kept 5 in-radius partners, dropped the far one and the competitor (${targets.map((x) => `${x.category} ${x.distance_mi}mi fit ${x.fit}`).join('; ')})`);
check(scan.status === 'done' && scan.requests === 5 && Number(scan.cost_cents) <= 2500, `radar finished: ${scan.requests} searches, $${(Number(scan.cost_cents) / 100).toFixed(2)} of $25 (cron: ${JSON.stringify(cron.radars)})`);
// Book a visit with the dealer (as the Call Desk does), so it shows on the calendar.
const dealer = must(await db.from('partner_targets').select('id').eq('tenant_id', t.id).eq('place_id', 'mock-dealer-1').single(), 'dealer');
const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
must(await db.from('partner_targets').update({ status: 'meeting', next_action_at: `${tomorrow}T18:00:00Z`, contact_name: 'Sam (sales manager)' }).eq('id', dealer.id), 'visit');

// 4. Sign in as the owner and look at every surface.
const email = 'owner@test-launch.example';
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9492, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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
const shot = async (name, w, h, mobile, full = true) => {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(500);
  if (full) { const fh = await ev('Math.min(document.documentElement.scrollHeight, 4200)'); await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: fh, deviceScaleFactor: 1, mobile }); await sleep(300); }
  const s = await cdp('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64'));
};
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/app/test-launch')}`);
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith('/app/test-launch'); i++) await sleep(250);
for (const [name, p] of [['home', ''], ['leads', '/leads'], ['partners', '/partners'], ['market', '/market'], ['calendar', '/calendar']]) { await go(`/app/test-launch${p}`); await shot(`growth-${name}`, 1440, 900, false); }
await go('/app/test-launch/leads');
const audio = await ev(`fetch(document.querySelector('audio')?.src ?? '/none').then((r) => r.status + ' ' + r.headers.get('content-type'))`);
check(/^200 audio\/mpeg/.test(audio ?? ''), `the owner can play the recording (${audio})`);
await ev(`[...document.querySelectorAll('.helix-fab')][0]?.click()`); await sleep(800);
await shot('growth-helix-drawer', 1440, 900, false, false);
await go('/app/test-launch/partners'); await shot('growth-partners-phone', 430, 932, true);
console.log('screenshots in', OUT, '| fake Places searches:', searches);
try { await cdp('Browser.close'); } catch {}
ws.close(); chrome.kill(); dev.kill(); mock.close();
spawn('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: 'ignore' });
setTimeout(() => process.exit(), 1500);
