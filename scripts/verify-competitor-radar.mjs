// Verify the Competitor Radar on the PREVIEW database with a stand-in for Google Places (no real searches, no spend):
//  1. a sweep keeps insurance offices inside the radius, tags each by carrier (captive or independent), skips a
//     business that only shares a carrier's name, and treats the agency's own office as "you" (not a competitor)
//  2. a busy area (a search that fills all three pages) splits into quarters until every office is found
//  3. only the place ID and our own classification are stored (no names, ratings or coordinates)
//  4. the cap is never crossed: a $1 sweep stops at "budget" with at most $1 spent
//  5. live office cards read the name, rating, reviews and ZIP from Google when shown
//  6. members save and delete views; someone outside the agency can't see the radar or save a view
//  7. the page (as the owner): offices with names, ratings and ZIPs; the carrier and ZIP filters and the radius narrow
//     the list; screenshots at desktop and phone width
// Uses the "test-launch" agency (verify-agency-dashboard.mjs) and its profile (Columbus, GA; GEICO).
//   node --conditions=react-server --env-file=.env.local scripts/verify-competitor-radar.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const MOCK = 39581, PORT = 3927, ORIGIN = `http://localhost:${PORT}`, SLUG = 'test-launch';
process.env.PLACES_API_BASE = `http://localhost:${MOCK}/v1`; process.env.GOOGLE_PLACES_API_KEY = 'test';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(URL_, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const t = must(await db.from('tenants').select('id').eq('slug', SLUG).single(), 'tenant');
const prof = must(await db.from('agency_profiles').select('lat, lng, carrier').eq('tenant_id', t.id).single(), 'profile');
if (!prof.lat) throw new Error('test-launch has no office location: run verify-growth-engine.mjs first');
const at = (miles, bearingDeg) => { const r = Math.PI / 180, d = miles / 3958.8, b = bearingDeg * r, la = prof.lat * r, lo = prof.lng * r;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return { latitude: la2 / r, longitude: lo2 / r }; };

// The stand-in market: named offices, the agency's own listing, a diner that only shares a name, one office too far,
// and a cluster of 70 independents in one busy area (so the first search fills all three pages and has to split).
const named = [
  { id: 'cr-sf-1', name: 'Jane Doe - State Farm Insurance Agent', types: ['insurance_agency'], loc: at(1.4, 200), rating: 5.0, reviews: 466, zip: '31909' },
  { id: 'cr-all-1', name: 'Allstate Insurance: Sam Lee', types: ['insurance_agency'], loc: at(2.2, 120), rating: 4.8, reviews: 212, zip: '31904' },
  { id: 'cr-alfa-1', name: 'Alfa Insurance - Columbus', types: ['insurance_agency'], loc: at(4.0, 250), rating: 4.9, reviews: 173, zip: '31907' },
  { id: 'cr-ind-1', name: 'Riverside Insurance Group', types: ['insurance_agency'], loc: at(2.7, 30), rating: 4.7, reviews: 131, zip: '31904' },
  { id: 'cr-sf-2', name: 'Pat Roe - State Farm Insurance Agent', types: ['insurance_agency'], loc: at(7.9, 205), rating: 4.9, reviews: 301, zip: '36867' },
  { id: 'cr-own', name: 'Test Agent - GEICO Insurance Agent', types: ['insurance_agency'], loc: at(0.02, 0), rating: 3.9, reviews: 151, zip: '31909' },
  { id: 'cr-diner', name: 'State Farm Road Diner', types: ['restaurant'], loc: at(3, 90), rating: 4.2, reviews: 80, zip: '31907' },
  { id: 'cr-far', name: 'Far Away - Allstate Insurance', types: ['insurance_agency'], loc: at(14.5, 90), rating: 4.5, reviews: 20, zip: '31820' },
];
const cluster = Array.from({ length: 70 }, (_, i) => ({ id: `cr-cl-${i}`, name: `Cluster Independent Agency ${i}`, types: ['insurance_agency'], loc: at(3 + (i % 10) * 0.25, 300 + Math.floor(i / 10) * 4), rating: 4.5, reviews: 10 + i, zip: '31808' }));
const PLACES = [...named, ...cluster];
const byId = new Map(PLACES.map((p) => [p.id, p]));
let searches = 0;
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/places:searchText')) {
      searches++;
      const q = JSON.parse(body || '{}'), r = q.locationRestriction.rectangle, page = Number(q.pageToken ?? 0);
      const inside = PLACES.filter((p) => p.loc.latitude >= r.low.latitude && p.loc.latitude <= r.high.latitude && p.loc.longitude >= r.low.longitude && p.loc.longitude <= r.high.longitude);
      const slice = inside.slice(page * 20, page * 20 + 20); // like Google: 20 a page, 3 pages at most
      return res.end(JSON.stringify({ places: slice.map((p) => ({ id: p.id, displayName: { text: p.name }, types: p.types, location: p.loc })), ...(page < 2 && inside.length > (page + 1) * 20 ? { nextPageToken: String(page + 1) } : {}) }));
    }
    const m = req.url.match(/^\/v1\/places\/([^?]+)/);
    const p = m && byId.get(decodeURIComponent(m[1]));
    if (p) return res.end(JSON.stringify({ displayName: { text: p.name }, rating: p.rating, userRatingCount: p.reviews, formattedAddress: `100 Main St, Columbus, GA ${p.zip}, USA`, websiteUri: `https://${p.id}.example.com/`, googleMapsUri: `https://maps.google.com/?cid=${p.id}`, businessStatus: 'OPERATIONAL' }));
    res.statusCode = 404; res.end('{}');
  });
}).listen(MOCK);

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); if (s.startsWith('@/')) return next(new URL('../' + s.slice(2) + (/\\.[a-z]+$/.test(s) ? '' : '.ts'), ${JSON.stringify(new URL('./', import.meta.url).href)}).href, c); throw e; } }`));
const radar = await import('../lib/competitor-radar.ts');
const places = await import('../lib/places.ts');

async function clean() {
  must(await db.from('competitor_offices').delete().eq('tenant_id', t.id), 'clear offices');
  must(await db.from('competitor_scans').delete().eq('tenant_id', t.id), 'clear scans');
  must(await db.from('radar_views').delete().eq('tenant_id', t.id), 'clear views');
  must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', 'Verify radar'), 'clear grants');
  for (const x of ((await db.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? []).filter((x) => x.email === 'verify-outsider@radar.example')) await db.auth.admin.deleteUser(x.id);
}
await clean();

// 1-3. the sweep
const id = await radar.startCompetitorScan(t.id, 10, 2500, null);
let r = await radar.runCompetitorSlice(id, 60_000);
const offices = must(await db.from('competitor_offices').select('*').eq('tenant_id', t.id), 'offices');
const scan = must(await db.from('competitor_scans').select('*').eq('id', id).single(), 'scan');
const got = new Set(offices.map((o) => o.place_id));
check(r.status === 'done' && got.has('cr-sf-1') && got.has('cr-all-1') && got.has('cr-alfa-1') && got.has('cr-ind-1') && got.has('cr-sf-2'), `the sweep finds the offices inside 10 mi (${r.status}, ${offices.length} offices, ${r.requests} searches)`);
const of = (pid) => offices.find((o) => o.place_id === pid);
check(of('cr-sf-1')?.carrier === 'State Farm' && of('cr-sf-1')?.segment === 'captive' && of('cr-alfa-1')?.carrier.startsWith('Alfa') && of('cr-ind-1')?.carrier === 'Independent' && of('cr-ind-1')?.segment === 'independent', 'each office is tagged by carrier (State Farm, Alfa: captive; Riverside: independent)');
check(!got.has('cr-diner') && !got.has('cr-far'), 'a diner that only shares a carrier’s name, and an office 14.5 mi out, are left off');
check(!got.has('cr-own') && scan.own_place_id === 'cr-own', 'the agency’s own GEICO listing is “you”, not a competitor');
check(cluster.every((c) => got.has(c.id)), `a busy area that fills all three pages splits until all 70 offices there are found (${cluster.filter((c) => got.has(c.id)).length}/70)`);
const sf = of('cr-sf-1');
check(Math.abs(Number(sf.distance_mi) - 1.4) <= 0.1 && Math.abs(sf.bearing_deg - 200) <= 2, `distance and bearing are computed and stored (${sf.distance_mi} mi at ${sf.bearing_deg}°)`);
const cols = Object.keys(sf);
check(!cols.some((c) => /name|rating|review|lat|lng|address|website|phone/.test(c) && c !== 'carrier'), `only the place ID and our own classification are stored (${cols.join(', ')})`);

// 4. the cap: a $1 sweep that has already spent 90 cents may not start another three-page search (9.6 cents)
const id2 = await radar.startCompetitorScan(t.id, 10, 100, null);
must(await db.from('competitor_scans').update({ cost_cents: 95 }).eq('id', id2), 'spent so far');
const s0 = searches;
r = await radar.runCompetitorSlice(id2, 60_000);
check(r.status === 'budget' && Number(r.costCents) <= 100 && searches === s0, `a sweep near its cap stops before a search that could cross it (${r.status}, ${(Number(r.costCents) / 100).toFixed(2)} of $1, no new searches)`);
const id3 = await radar.startCompetitorScan(t.id, 10, 2500, null);
const id4 = await radar.startCompetitorScan(t.id, 10, 2500, null);
const old = must(await db.from('competitor_scans').select('status').eq('id', id3).single(), 'old scan');
check(old.status === 'stopped', 'starting a new sweep stops one still running');
await radar.runCompetitorSlice(id4, 60_000);

// A sweep that cannot search (no Google key) fails and keeps its work; it is never "done" with nothing found.
const id5 = await radar.startCompetitorScan(t.id, 10, 2500, null);
process.env.GOOGLE_PLACES_API_KEY = '';
const rf = await radar.runCompetitorSlice(id5, 20_000);
process.env.GOOGLE_PLACES_API_KEY = 'test';
const s5 = must(await db.from('competitor_scans').select('status, queue').eq('id', id5).single(), 'failed scan');
check(rf.status === 'failed' && s5.status === 'failed' && s5.queue.length === 1, `without a Google key the sweep fails and keeps its area to search (${s5.status})`);

// 5. live cards
const card = await places.getOfficeCard('cr-sf-1');
check(card?.name === 'Jane Doe - State Farm Insurance Agent' && card.rating === 5 && card.reviews === 466 && card.zip === '31909', `a live card reads name, rating, reviews and ZIP (${JSON.stringify(card)})`);

// 6. views and access
const ownerEmail = `owner@${SLUG}.example`;
async function signedIn(email) {
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), `link ${email}`);
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  must(await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }), `sign in ${email}`);
  return { c, link };
}
must(await db.auth.admin.createUser({ email: 'verify-outsider@radar.example', email_confirm: true }), 'outsider');
const { c: asOwner } = await signedIn(ownerEmail), { c: asOut } = await signedIn('verify-outsider@radar.example');
const v1 = await asOwner.rpc('save_radar_view', { p_tenant: t.id, p_name: 'Verify: State Farm in 31909', p_radius: 5, p_carriers: ['State Farm'], p_zips: ['31909'] });
const v2 = await asOwner.rpc('save_radar_view', { p_tenant: t.id, p_name: 'Verify: State Farm in 31909', p_radius: 8, p_carriers: ['State Farm'], p_zips: ['31909'] });
const views = must(await db.from('radar_views').select('radius_mi').eq('tenant_id', t.id), 'views');
check(!v1.error && !v2.error && views.length === 1 && views[0].radius_mi === 8, 'a member saves a view; saving the same name again updates it');
const badZip = await asOwner.rpc('save_radar_view', { p_tenant: t.id, p_name: 'Verify: bad', p_radius: 5, p_carriers: [], p_zips: ['319'] });
check(/five digits/.test(badZip.error?.message ?? ''), 'a malformed ZIP is refused');
const outSave = await asOut.rpc('save_radar_view', { p_tenant: t.id, p_name: 'Verify: intruder', p_radius: 5, p_carriers: [], p_zips: [] });
const outSee = await asOut.from('competitor_offices').select('id').eq('tenant_id', t.id);
check(Boolean(outSave.error) && (outSee.data ?? []).length === 0, 'someone outside the agency can’t save a view or see its radar');
const del = await asOwner.rpc('delete_radar_view', { p_id: v2.data });
check(!del.error && !(await db.from('radar_views').select('id').eq('tenant_id', t.id)).data?.length, 'a member deletes a view');

// 7. the page
must(await db.from('module_grants').insert({ tenant_id: t.id, module_key: 'radar', until: new Date(Date.now() + 86_400_000).toISOString(), reason: 'Verify radar' }), 'grant');
const env = { ...process.env, PLACES_API_BASE: `http://localhost:${MOCK}/v1`, GOOGLE_PLACES_API_KEY: 'test', GEMINI_API_KEY: '' };
const app = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120; i++) { try { await fetch(ORIGIN, { redirect: 'manual' }); break; } catch {} await sleep(1000); }
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=9349', `--user-data-dir=${OUT}/.radar-prof`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
let ws; for (let i = 0; i < 40 && !ws; i++) { try { ws = (await (await fetch('http://127.0.0.1:9349/json')).json()).find((x) => x.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(250); }
const sock = new WebSocket(ws); await new Promise((res) => sock.addEventListener('open', res));
let n = 0; const pend = new Map();
sock.addEventListener('message', (e) => { const m = JSON.parse(e.data); pend.get(m.id)?.(m); pend.delete(m.id); });
const send = (method, params = {}) => new Promise((res) => { const i = ++n; pend.set(i, res); sock.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.result.value;
const go = async (p, wait = 6000) => { await send('Page.navigate', { url: ORIGIN + p }); await sleep(wait); };
const shot = async (name, w, mobile) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile });
  await go(`/app/${SLUG}/radar`, 1000); await waitFor(`Boolean(document.querySelector('.radar-table'))`, 60_000); await sleep(800);
  const h = await evalJs('document.documentElement.scrollHeight'), over = await evalJs('document.documentElement.scrollWidth > document.documentElement.clientWidth');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(600);
  fs.writeFileSync(path.join(OUT, `radar-${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).result.data, 'base64'));
  return over;
};
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: ownerEmail }), 'browser link');
await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
const waitFor = async (js, ms = 90_000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(1000)) if (await evalJs(js)) return true; return false; };
await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`/app/${SLUG}/radar`)}`, 1000);
await waitFor(`Boolean(document.querySelector('form button[type=submit]'))`);
await evalJs(`document.querySelector('form button[type=submit]').click()`);
await waitFor(`location.pathname.endsWith('/radar') && Boolean(document.querySelector('.radar-table'))`);
const rows = () => evalJs(`document.querySelectorAll('.radar-table tbody tr:not(.radar-own)').length`);
const all = await rows();
const text = await evalJs('document.body.innerText');
check(all >= 75 && /Jane Doe - State Farm Insurance Agent/.test(text) && /466/.test(text) && /31909/.test(text), `the owner sees the mapped offices with names, review counts and ZIPs (${all} rows)`);
check(/Test Launch|you/i.test(await evalJs(`document.querySelector('.radar-own')?.innerText ?? ''`)), 'their own office heads the list as “you”, with its live rating');
await evalJs(`[...document.querySelectorAll('.radar-chip')].find((b) => b.textContent.startsWith('State Farm'))?.click()`); await sleep(500);
const sfRows = await rows();
await evalJs(`[...document.querySelectorAll('.radar-chip')].find((b) => b.textContent.startsWith('31909'))?.click()`); await sleep(500);
const sfZip = await rows();
check(sfRows === 2 && sfZip === 1, `the carrier filter narrows to State Farm (${sfRows}), and a ZIP narrows it again (${sfZip})`);
await evalJs(`(() => { const s = document.querySelector('input[type=range]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; [...document.querySelectorAll('.radar-chip')].filter((b) => b.textContent === 'All').forEach((b) => b.click()); set.call(s, '2'); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(600);
const near = await rows();
check(near === 1, `the radius narrows the radar to 2 mi on screen, with no new search (${near} office)`);
const before = searches;
const overD = await shot('desktop', 1366, false), overP = await shot('phone', 390, true);
check(!overD && !overP && searches === before, 'no sideways scroll at desktop or phone width, and viewing never runs a sweep');
sock.close(); chrome.kill();
try { spawn('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore', shell: true }); } catch {}
await clean(); mock.close();
console.log(`screenshots in ${OUT} | ${failed ? `${failed} check(s) failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
