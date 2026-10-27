// Verify the Places budget split, the "paused" notice and the team's saved prospect names (migration 0077):
//  1. two pots: with spend past the sweep limit (budget minus the display reserve) but under the budget, the national
//     scanner and the Competitor Radar stop, and on-screen names still load
//  2. past the whole budget, on-screen lookups pause and pages say so (staff: the budget and where to raise it;
//     agency: when names come back)
//  3. logging a call keeps the business name, address and office phone the team confirmed; a blank field never erases
//     them; non-staff can't; the prospect list, call list and office page show them while Google is paused
//  4. the scan settings save the reserve, and refuse one larger than the budget
// Preview database only; restores the budget settings. Run: node --conditions=react-server --env-file=.env.local scripts/verify-places-budget.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const MOCK = 39621, PORT = 3934, ORIGIN = `http://localhost:${PORT}`, OPS = 'verify-pb-ops@genovus.example', PLACE = 'verify-pb-office-1';
Object.assign(process.env, { PLACES_API_BASE: `http://localhost:${MOCK}/v1`, GOOGLE_PLACES_API_KEY: 'test', CRON_SECRET: 'verify-places-budget' });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(URL_, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

// A stand-in Google: every office is "Lakeside Insurance Group"; every search returns nothing (and is counted).
let searches = 0;
const mock = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url.startsWith('/v1/places:searchText')) { searches++; return res.end(JSON.stringify({ places: [] })); }
  if (req.url.startsWith('/v1/places/')) return res.end(JSON.stringify({ displayName: { text: 'Lakeside Insurance Group' }, formattedAddress: '100 Main St, Columbus, GA 31901, USA', nationalPhoneNumber: '(706) 555-0188', businessStatus: 'OPERATIONAL' }));
  res.statusCode = 404; res.end('{}');
}).listen(MOCK);

// Budget settings: saved and restored.
const KEYS = ['scan_budget_usd', 'places_display_reserve_usd'];
const saved = must(await db.from('app_settings').select('key, value').in('key', KEYS), 'settings');
const setBudget = async (budgetUsd, reserveUsd) => must(await db.from('app_settings').upsert([{ key: 'scan_budget_usd', value: String(budgetUsd), updated_at: new Date().toISOString() }, { key: 'places_display_reserve_usd', value: String(reserveUsd), updated_at: new Date().toISOString() }]), 'set budget');
const restore = async () => {
  for (const k of KEYS) { const s = saved.find((x) => x.key === k); if (s) await db.from('app_settings').update({ value: s.value }).eq('key', k); else await db.from('app_settings').delete().eq('key', k); }
};
const users = async () => (await db.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? [];
const clean = async () => {
  must(await db.from('prospects').delete().eq('place_id', PLACE), 'clear prospect');
  for (const x of (await users()).filter((x) => x.email === OPS)) { await db.from('staff').delete().eq('user_id', x.id); await db.auth.admin.deleteUser(x.id); }
};
await clean();
const ops = must(await db.auth.admin.createUser({ email: OPS, email_confirm: true }), 'operator').user;
must(await db.from('staff').insert({ user_id: ops.id, role: 'admin', display_name: 'Verify Budget' }), 'staff');
const pr = must(await db.from('prospects').insert({ place_id: PLACE, segment: 'independent', state: 'GA', fit_score: 99, status: 'new' }).select('id, code').single(), 'prospect');

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); if (s.startsWith('@/')) return next(new URL('../' + s.slice(2) + (/\\.[a-z]+$/.test(s) ? '' : '.ts'), ${JSON.stringify(new URL('./', import.meta.url).href)}).href, c); throw e; } }`));
const spentNow = async () => Number((await db.rpc('places_month_cents')).data ?? 0);

let dev, chrome, ws, restoreCarrier = async () => {};
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
try {
  dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: process.env });
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
  const cron = async () => (await fetch(`${ORIGIN}/api/cron/scan`, { headers: { authorization: 'Bearer verify-places-budget' } })).json();
  // 1. two pots: spend sits between the sweep limit and the budget
  const S = await spentNow();
  await setBudget(Math.ceil(S / 100) + 10, 20);
  const P = await import(`../lib/places.ts?t=${Date.now()}`);
  const b = await P.placesBudget();
  // One carrier switched on for scanning for this run (restored after), so the scanner reaches its budget check.
  const carrier = must(await db.from('carriers').select('id, scan_enabled, query').limit(1).single(), 'carrier');
  restoreCarrier = () => db.from('carriers').update({ scan_enabled: carrier.scan_enabled, query: carrier.query }).eq('id', carrier.id);
  must(await db.from('carriers').update({ scan_enabled: true, query: carrier.query ?? 'verify insurance agency' }).eq('id', carrier.id), 'enable carrier');
  const t = must(await db.from('tenants').select('id').eq('slug', 'test-launch').single(), 'tenant');
  const radar = await import('../lib/competitor-radar.ts');
  const prof = (await db.from('agency_profiles').select('lat, lng').eq('tenant_id', t.id).maybeSingle()).data;
  const scanId = prof?.lat ? await radar.startCompetitorScan(t.id, 5, 500, null) : null;
  const res = await cron();
  const net = res.network ?? {};
  check(b.sweepLimit === b.budget - 2000 && b.spent >= b.sweepLimit && b.spent < b.budget && net.status === 'budget' && searches === 0, `the national scanner stops at the sweep limit (${(b.sweepLimit / 100).toFixed(2)}), $20 short of the budget (${net.note ?? JSON.stringify(res).slice(0, 160)})`);
  const sc = scanId ? (await db.from('competitor_scans').select('status, requests').eq('id', scanId).single()).data : null;
  check(sc?.status === 'budget' && sc.requests === 0, `a Competitor Radar sweep stops at the sweep limit too (${sc?.status}, ${sc?.requests} searches)`);
  if (scanId) await db.from('competitor_scans').update({ status: 'stopped' }).eq('id', scanId);
  const name = await P.getSummary(PLACE);
  check(name?.name === 'Lakeside Insurance Group' && !(await P.placesPaused()).paused, 'with the reserve left, on-screen names still load');

  // 3a. logging a call keeps what the team confirmed (Google still live here)
  const signedIn = async (email) => { const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link'); const c = createClient(URL_, ANON, { auth: { persistSession: false } }); must(await c.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }), 'sign in'); return c; };
  const asOps = await signedIn(OPS), asOwner = await signedIn('owner@test-launch.example');
  const call = (c, extra) => c.rpc('log_prospect', { p_id: pr.id, p_kind: 'call', p_outcome: 'no_answer', p_note: 'Verify budget', p_status: null, p_next: null, p_contact_name: null, p_contact_email: null, p_contact_phone: null, p_known_name: null, p_known_address: null, ...extra });
  must(await call(asOps, { p_known_name: 'Lakeside Insurance Group', p_known_address: '100 Main St, Columbus, GA 31901', p_contact_phone: '(706) 555-0188', p_contact_name: 'Dana' }), 'log');
  must(await call(asOps, { p_known_name: '  ', p_known_address: '' }), 'log blank');
  const after = must(await db.from('prospects').select('known_name, known_address, known_by, contact_phone, contact_name').eq('id', pr.id).single(), 'after');
  const denied = await call(asOwner, { p_known_name: 'Hijack' });
  check(after.known_name === 'Lakeside Insurance Group' && after.known_address.startsWith('100 Main St') && after.known_by === ops.id && after.contact_phone === '(706) 555-0188', 'a logged call keeps the business name, address and office phone, with who confirmed it');
  check(!!denied.error, 'a blank field never erases them, and non-staff can’t log a prospect call');

  // 4. the reserve setting

  // 2 + 3b. past the whole budget: pages say so and show the team's records
  await setBudget(Math.max(0, Math.floor(S / 100) - 1), 0);
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: OPS }), 'browser link');
  const port = 9551, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
  chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
  ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pend = new Map(), on = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
  await send('Page.enable');
  const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
  const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); };
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  for (let i = 0; i < 80 && (await ev('location.pathname')) !== '/console'; i++) await sleep(250);
  await go('/console/prospects?state=GA');
  for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('[data-places-paused]')`)); i++) await sleep(500);
  const listText = await ev('document.body.innerText');
  check(/Google names are paused/.test(listText) && /Carriers & scanner/.test(listText), 'the prospect list says Google names are paused, with the budget and where to raise it');
  check(listText.includes('Lakeside Insurance Group') && listText.includes('100 Main St'), 'and shows the office by the name and address the team saved');
  await shot('prospects-paused');
  await go(`/console/prospects/${pr.code}`);
  const office = await ev('document.body.innerText');
  check(/From your team’s records/.test(office) && office.includes('(706) 555-0188') && /Dana/.test(office), 'the office page shows the saved record: name, address, phone, contact');
  check(await ev(`document.querySelector('input[name=known_name]')?.value`) === 'Lakeside Insurance Group', 'the call form keeps the business name ready to confirm');
  await shot('prospect-paused');
  await go('/app/test-launch/partners');
  check(/Some Google details are paused until/.test(await ev('document.body.innerText')), 'agency pages say when Google details come back');
} finally {
  try { ws?.close(); } catch {}
  chrome?.kill();
  try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
  dev?.kill();
  await restore();
  await restoreCarrier();
  await clean();
  mock.close();
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
