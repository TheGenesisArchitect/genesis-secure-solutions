// Verify the agency dashboard as a REAL (non-sample) agency on the preview database: creates "test-launch"
// (Launch program, live), an owner, a lead key, sends three leads through /api/leads/ingest exactly as an agency
// website would, signs in as the owner and screenshots each page. Preview only; never run against production.
//   node --env-file=.env.local scripts/verify-agency-dashboard.mjs [outDir] [plan]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PLAN = process.argv[3] || 'launch';
const ORIGIN = 'http://localhost:3911';
const SLUG = `test-${PLAN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };

// 1. The test agency (not a sample), its owner and a lead key.
let t = must(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) t = must(await db.from('tenants').insert({ slug: SLUG, name: `Test ${PLAN[0].toUpperCase()}${PLAN.slice(1)} Agency`, kind: 'agency', stage: 'care', plan: PLAN, care_plan: PLAN === 'launch' ? 'Essential Care' : PLAN === 'growth' ? 'Growth Care' : 'Optimization Care', is_sample: false }).select('id').single(), 'create tenant');
else must(await db.from('tenants').update({ plan: PLAN, stage: 'care', is_sample: false }).eq('id', t.id), 'update tenant');
const email = `owner@${SLUG}.example`;
let user = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email);
if (!user) user = must(await db.auth.admin.createUser({ email, email_confirm: true }), 'user').user;
must(await db.from('memberships').upsert({ tenant_id: t.id, user_id: user.id, role: 'owner' }, { onConflict: 'tenant_id,user_id' }), 'membership');
must(await db.from('leads').delete().eq('tenant_id', t.id), 'clear leads');
const key = `gnv_lk_${randomBytes(32).toString('base64url')}`;
must(await db.from('lead_keys').insert({ tenant_id: t.id, key_hash: createHash('sha256').update(key).digest('hex'), label: 'Verify' }), 'key');

// 2. Dev server.
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
let dev = null;
if (!(await up())) { dev = spawn('npx', ['next', 'dev', '-p', '3911'], { stdio: 'ignore', shell: true }); for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000); }

// 3. Leads through the real ingest endpoint, the way the agency website sends them.
const consent = `I agree that Test Agency may contact me about this request.`;
const send = (body, k = key) => fetch(`${ORIGIN}/api/leads/ingest`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
const results = [
  await send({ id: 'v1', name: 'Dana Ruiz', email: 'dana@example.com', phone: '(706) 555-0142', topic: 'Auto insurance', message: 'Just moved to Columbus, two cars.', consent, attribution: { utm_source: 'facebook', utm_medium: 'paid', utm_campaign: 'fall-launch' } }),
  await send({ id: 'v2', name: 'Marcus Lee', phone: '(706) 555-0199', topic: 'Homeowners', consent, attribution: { gclid: 'abc', landing: 'https://example.com/' } }),
  await send({ id: 'v3', name: 'Priya Shah', email: 'priya@example.com', topic: 'Renters', consent, attribution: { referrer: 'https://www.instagram.com/' } }),
  await send({ id: 'v1', name: 'Dana Ruiz', email: 'dana@example.com', phone: '(706) 555-0142', topic: 'Auto insurance', consent }),
  await send({ id: 'v9', name: 'Bad Key', email: 'x@example.com', consent }, 'gnv_lk_' + 'x'.repeat(43)),
];
console.log('ingest results (expect 3 ok, 1 duplicate, 1 unknown key):', JSON.stringify(results));

// 3b. Growth trial on a Launch agency (the Enterprise toggle), one booked consult, two follow-ups.
const GRANT = process.argv[4] === 'growth-trial';
must(await db.from('module_grants').delete().eq('tenant_id', t.id), 'clear grants');
if (GRANT) must(await db.from('module_grants').insert(['pipeline', 'calendar', 'helix', 'kpis', 'content'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 30 * 86_400_000).toISOString(), reason: 'Verify trial' }))), 'grants');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10);
must(await db.from('leads').update({ status: 'booked', booked_for: tomorrow + 'T15:00:00Z', first_contact_at: new Date().toISOString() }).eq('tenant_id', t.id).eq('ext_id', 'v1'), 'book');
must(await db.from('leads').update({ status: 'contacted', first_contact_at: new Date(Date.now() + 4 * 60_000).toISOString() }).eq('tenant_id', t.id).eq('ext_id', 'v2'), 'contact');
must(await db.from('follow_ups').delete().eq('tenant_id', t.id), 'clear fu');
must(await db.from('follow_ups').insert([{ tenant_id: t.id, who: 'Marcus Lee', reason: 'Homeowners quote follow-up', due_on: today, due_at: '14:00' }, { tenant_id: t.id, who: 'Priya Shah', reason: 'Renters: send the checklist', due_on: tomorrow, due_at: '10:30' }]), 'fu');

// 4. Sign in as the owner (one-time link) and screenshot each page.
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9491, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send2 = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send2('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send2('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send2('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1200); };
const shot = async (name, w, h, mobile) => {
  await send2('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(500);
  const full = await ev('Math.min(document.documentElement.scrollHeight, 4000)');
  await send2('Emulation.setDeviceMetricsOverride', { width: w, height: full, deviceScaleFactor: 1, mobile });
  await sleep(300);
  const s = await send2('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64'));
};
await send2('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`/app/${SLUG}`)}`);
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith(`/app/${SLUG}`); i++) await sleep(250);
console.log('signed in at', await ev('location.pathname'));
const tag = GRANT ? `${PLAN}-trial` : PLAN;
for (const [name, p] of [['home', ''], ['leads', '/leads'], ['pipeline', '/pipeline'], ['calendar', '/calendar'], ['helix', '/helix'], ['program', '/program'], ['performance', '/performance']]) { await go(`/app/${SLUG}${p}`); await shot(`${tag}-${name}`, 1440, 900, false); }
await go(`/app/${SLUG}/pipeline`); await shot(`${tag}-pipeline-phone`, 430, 932, true);
console.log('screenshots in', OUT);
try { await send2('Browser.close'); } catch {}
ws.close(); chrome.kill(); dev?.kill();
process.exit(0);
