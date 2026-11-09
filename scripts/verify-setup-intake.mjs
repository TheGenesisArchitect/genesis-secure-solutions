// Verify the Setup and Welcome pages for a client onboarded in Genovus before the deposit (Tyson Barrett's state,
// 2026-11-09) on PREVIEW, as the agency's owner: Growth package in the record, stage propose, no plan, no deposit, the
// Growth trial grants, a kickoff that already happened, seven open launch items, nothing answered yet.
//  1. Setup shows the setup form (0 of 22, what the build needs, a button to Welcome), the kickoff that was held, the
//     deposit, and the launch checklist; never the old "appears here when your deposit clears"
//  2. the menu names the proposed package (Growth), not Launch
//  3. Welcome says the kickoff was held; saving a section saves onto the record
//  4. no page errors, no failed requests (besides Helix's brief, which needs an AI key locally), fits a phone
//   node --env-file=.env.local scripts/verify-setup-intake.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3955, ORIGIN = `http://localhost:${PORT}`, SLUG = 'test-tyson-like';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let t = must(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) t = must(await db.from('tenants').insert({ slug: SLUG, name: 'Tyson-like GEICO Agent (verify)', kind: 'agency', stage: 'propose', plan: null, is_sample: false }).select('id').single(), 'create');
else must(await db.from('tenants').update({ stage: 'propose', plan: null }).eq('id', t.id), 'reset');
const email = `owner@${SLUG}.example`;
let user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email);
if (!user) user = must(await db.auth.admin.createUser({ email, email_confirm: true }), 'user').user;
must(await db.from('memberships').upsert({ tenant_id: t.id, user_id: user.id, role: 'owner' }, { onConflict: 'tenant_id,user_id' }), 'member');
await db.from('agent_records').delete().eq('tenant_id', t.id);
must(await db.from('agent_records').insert({ tenant_id: t.id, version: 1, is_current: true, note: 'verify', data: { agencyName: 'Tyson-like GEICO Insurance Agent', contactName: 'Ty Verify', email: `office@${SLUG}.example`, phone: '(850) 555-0101', address: '100 Main St', city: 'Pensacola', state: 'FL', zip: '32501', carrier: 'GEICO', package: 'growth', segment: 'captive', website: 'https://www.geico.com/', alertEmails: [email], prospectCode: 'abc123def' } }), 'record');
await db.from('gates').delete().eq('tenant_id', t.id);
must(await db.from('gates').insert(['photo_rights', 'carrier_approval', 'carrier_rules', 'meta_access', 'domain', 'privacy_notice', 'kickoff'].map((kind) => ({ tenant_id: t.id, kind }))), 'gates');
await db.from('module_grants').delete().eq('tenant_id', t.id);
must(await db.from('module_grants').insert(['pipeline', 'partners', 'market', 'visibility', 'radar', 'calendar', 'helix', 'helix-notes', 'kpis', 'content', 'reviews', 'report', 'booking'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 20 * 86_400_000).toISOString(), reason: 'verify growth trial' }))), 'grants');
await db.from('calendar_events').delete().eq('tenant_id', t.id);
must(await db.from('calendar_events').insert({ tenant_id: t.id, title: 'Kickoff Call', starts_at: new Date(Date.now() - 7 * 86_400_000).toISOString(), ends_at: new Date(Date.now() - 7 * 86_400_000 + 3_600_000).toISOString(), host: 'genovus' }), 'kickoff');

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy`);
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
let serverLog = ''; dev.stdout.on('data', (d) => { serverLog += d; }); dev.stderr.on('data', (d) => { serverLog += d; });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9508, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map(); const errors = [];
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) {
  if (m.method === 'Runtime.exceptionThrown') errors.push(`page error: ${m.params.exceptionDetails.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails.text}`);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(`console: ${m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)}`);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) errors.push(`HTTP ${m.params.response.status} ${m.params.response.url.replace(ORIGIN, '')}`);
  on.get(m.method)?.(m.params); } };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(2500); };
const shot = async (name, w = 1440, h = 900, mobile = false) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); await sleep(600);
  const full = await ev('Math.min(document.documentElement.scrollHeight, 4000)');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: full, deviceScaleFactor: 1, mobile }); await sleep(400);
  const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
};

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const real = () => errors.filter((e) => !/\/api\/helix\/brief/.test(e));
const main = () => ev(`document.querySelector('main')?.innerText ?? ''`);

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`/app/${SLUG}`)}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await sleep(5000);

  // 1–2. Setup
  errors.length = 0;
  await go(`/app/${SLUG}/setup`);
  const s = await main();
  check(/Your setup form/.test(s) && /0 of 22 answered/.test(s) && /Your business’s legal name/.test(s) && /Start your setup form/.test(s), 'Setup shows the setup form: 0 of 22, what the build needs, a button to it');
  check(!/appears here when your deposit clears/.test(s) && !/Not part of your setup yet/.test(s), 'and never the old empty panels');
  check(/Held .*November|Held \w+day/.test(s) && /\$1,750 · invoice coming/.test(s), 'the kickoff that was held and the deposit');
  check(/0 of 7 cleared/.test(s), 'the launch checklist (0 of 7)');
  check((await ev(`document.querySelector('a[href$="/welcome"].btn')?.getAttribute('href') ?? ''`)) === `/app/${SLUG}/welcome`, 'the button opens Welcome');
  const menu = await ev(`document.body.innerText`);
  check(/YOUR PROGRAM · GROWTH/i.test(menu) && !/YOUR PROGRAM · LAUNCH/i.test(menu), 'the menu names the proposed package (Growth), not Launch');
  check(real().length === 0, `no page errors or failed requests on Setup (${real().join('; ') || 'none'})`);
  await shot('setup-intake-setup-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }); await sleep(800);
  check(!(await ev('document.documentElement.scrollWidth > innerWidth')), 'Setup fits a phone');
  await shot('setup-intake-setup-phone', 390, 844, true);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // 3. Welcome
  errors.length = 0;
  await go(`/app/${SLUG}/welcome`);
  const wtext = await ev(`document.body.innerText`);
  check(/Held .* Eastern/.test(wtext) && !/We’re setting the time with you/.test(wtext), 'Welcome says the kickoff was held');
  const SAVE = String.raw`(async () => {
    const sec = document.querySelector('.wl-sec[open]');
    const inp = sec && [...sec.querySelectorAll('input, textarea')].find((x) => x.type !== 'hidden' && x.name);
    if (!inp) return 'no field';
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(inp), 'value').set;
    setter.call(inp, 'Tyson Verify Insurance Agency, LLC'); inp.dispatchEvent(new Event('input', { bubbles: true }));
    [...sec.querySelectorAll('button')].find((b) => /Save this section/.test(b.textContent)).click();
    await new Promise((r) => setTimeout(r, 4000));
    return JSON.stringify({ field: inp.name, shown: sec.innerText.split('\n').filter((l) => /Saved|of \d/i.test(l)).slice(0, 3) });
  })()`;
  const r = JSON.parse(await ev(SAVE));
  const rec = must(await db.from('agent_records').select('version, data').eq('tenant_id', t.id).eq('is_current', true).single(), 'rec');
  check(r.field === 'legalName' && r.shown.includes('Saved.') && rec.data?.intake?.legalName === 'Tyson Verify Insurance Agency, LLC', `saving “Your office” saves onto the record (v${rec.version})`);
  check(real().length === 0, `no page errors or failed requests on Welcome (${real().join('; ') || 'none'})`);
  await go(`/app/${SLUG}/setup`);
  check(/1 of 22 answered/.test(await main()), 'and Setup counts it (1 of 22)');
} finally {
  try { ws.close(); } catch {}
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  try { execSync(`taskkill /pid ${dev.pid} /T /F`, { stdio: 'ignore' }); } catch {}
  const bad = serverLog.split('\n').filter((l) => /⨯|Unhandled|TypeError|ReferenceError/.test(l)).slice(0, 10);
  if (bad.length) { console.log('server errors:\n' + bad.join('\n')); failed++; }
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
