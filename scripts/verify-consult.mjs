// Verify pick-a-time consultations (migration 0084) and the Launch + 30-day Growth trial onboarding, on PREVIEW.
//  1. from a prospect's page, staff send one pick-a-time link to three emails (one email each, nothing booked yet)
//  2. the link shows open times only; picking one books it on the Genovus calendar and sends the invite to all three
//     plus the sender; the link can't book twice; a tampered link or a time that isn't open books nothing
//  3. Launch with a 30-day Growth trial: Growth's features for 30 days, the Launch deposit, the trial on the proposal
//   node --conditions=react-server --env-file=.env.local scripts/verify-consult.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3936, ORIGIN = `http://localhost:${PORT}`, SECRET = 'verify-consult-secret';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email.toLowerCase();
const PLACE = `verify-consult-${Date.now().toString(36)}`, SLUG = `verify-consult-${Date.now().toString(36)}`;
const EMAILS = ['ty@verify-consult.example', 'wi@verify-consult.example', 'ty.personal@verify-consult.example'];
const pr = must(await db.from('prospects').insert({ place_id: PLACE, segment: 'captive', state: 'GA', fit_score: 90, status: 'contacting', contact_name: 'Ty Verify', contact_email: EMAILS[0] }).select('id, code').single(), 'prospect');

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env, CONSULT_LINK_SECRET: SECRET, PROPOSAL_LINK_SECRET: SECRET } });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'link');
const port = 9581, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(), on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); };
const setIn = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
let eventId = null;
try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console');

  // 1. send the link
  await go(`/console/prospects/${pr.code}`);
  const form = 'form[data-helix-form="consultation link"]';
  check(await ev(`!!document.querySelector('${form}')`) && await ev(`document.querySelector('${form}').dataset.helixLane`) === 'outward', 'the prospect page has the pick-a-time form (outward: a person sends it)');
  await setIn(`${form} [name=label]`, 'Ty Verify, Verify Insurance');
  await setIn(`${form} [name=emails]`, EMAILS.join(', '));
  await setIn(`${form} [name=minutes]`, '60');
  await ev(`document.querySelector('${form} button[type=submit]').click()`);
  check(await waitFor(async () => ((await db.from('consult_invites').select('id').eq('prospect_id', pr.id)).data ?? []).length === 1), 'one tap creates the invitation');
  const inv = must(await db.from('consult_invites').select('id, emails, minutes, tenant_id, booked_at').eq('prospect_id', pr.id).single(), 'invite');
  await waitFor(async () => ((await db.from('outbox').select('id').like('dedupe_key', `consult:${inv.id}:%`)).data ?? []).length === 3, 10000);
  const mails = must(await db.from('outbox').select('to_email, data').like('dedupe_key', `consult:${inv.id}:%`), 'mails');
  check(inv.tenant_id === house.id && inv.minutes === 60 && JSON.stringify(inv.emails) === JSON.stringify(EMAILS) && !inv.booked_at, 'for 60 minutes on the Genovus calendar, to all three, nothing booked yet');
  check(mails.length === 3 && mails.every((m) => /\/book\/[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/.test(m.data.link)) && mails.every((m) => m.data.from_email === adminEmail), `each of the three gets the pick-a-time email, replies to the sender (${mails.map((m) => m.to_email).join(', ')})`);

  // 2. pick a time
  const tokenPath = new URL(mails[0].data.link).pathname;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(tokenPath);
  const page = await ev('document.body.innerText');
  const times = await ev(`[...document.querySelectorAll('.ck-form button[aria-pressed]')].length`);
  check(/Pick a time for your Genovus consultation/.test(page) && /60 minutes/.test(page) && times > 0 && !/Genovus consultation:/.test(page), `the link shows open times only (${times} times), nothing else from the calendar`);
  check(!(await ev('document.documentElement.scrollWidth > innerWidth')), 'it fits a phone');
  await shot('consult-pick');
  const bad = await fetch(`${ORIGIN}${tokenPath.slice(0, -3)}xyz`);
  const notOpen = await (await fetch(`${ORIGIN}/api${tokenPath}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ iso: '2020-01-01T15:00:00.000Z' }) })).json();
  check(bad.status === 404 && notOpen.ok === false, 'a tampered link shows nothing; a time that isn’t open books nothing');
  await ev(`document.querySelector('.ck-form button[aria-pressed]').click()`);
  await sleep(300);
  await ev(`[...document.querySelectorAll('.ck-form button')].find((b) => /^Book /.test(b.textContent))?.click()`);
  check(await waitFor(async () => !!(await db.from('consult_invites').select('booked_at').eq('id', inv.id).single()).data?.booked_at), 'picking a time books it');
  const booked = must(await db.from('consult_invites').select('event_id').eq('id', inv.id).single(), 'booked');
  eventId = booked.event_id;
  const evRow = must(await db.from('calendar_events').select('tenant_id, title, starts_at, ends_at, attendees, host, invited_at').eq('id', eventId).single(), 'event');
  const invites = must(await db.from('outbox').select('to_email, data').eq('template', 'meeting_invite').like('dedupe_key', `invite:${eventId}:%`), 'invites');
  check(evRow.tenant_id === house.id && evRow.host === 'genovus' && /Genovus consultation: Ty Verify/.test(evRow.title) && (Date.parse(evRow.ends_at) - Date.parse(evRow.starts_at)) === 3_600_000 && !!evRow.invited_at, `it's on the Genovus calendar, an hour long (${evRow.title})`);
  check(invites.length === 4 && EMAILS.every((e) => invites.some((i) => i.to_email === e)) && invites.some((i) => i.to_email === adminEmail) && invites.every((i) => i.data.from_email === adminEmail), `the invite (with the .ics) goes to all three and to you (${invites.map((i) => i.to_email).join(', ')})`);
  check(/You’re booked for|Booked/.test(await ev('document.body.innerText')), 'they see it confirmed');
  const twice = await (await fetch(`${ORIGIN}/api${tokenPath}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ iso: evRow.starts_at }) })).json();
  await go(tokenPath);
  check(twice.ok === false && /already booked/.test(twice.error) && /You’re booked for/.test(await ev('document.body.innerText')), 'the link can’t book twice; opening it again shows the booking');

  // 3. Launch with a 30-day Growth trial
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/console/prospects/${pr.code}`);
  const of = 'form[data-helix-form="onboarding"]';
  await setIn(`${of} [name=name]`, 'Verify Consult Insurance');
  await setIn(`${of} [name=slug]`, SLUG);
  await setIn(`${of} [name=email]`, EMAILS[0]);
  await setIn(`${of} [name=package]`, 'launch');
  await ev(`document.querySelector('${of} input[name=trial]').click()`);
  await ev(`document.querySelector('${of} button[type=submit]').click()`);
  check(await waitFor(async () => !!(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle()).data, 40000), 'onboarding with Launch + the Growth trial creates the client');
  const t = must(await db.from('tenants').select('id, plan').eq('slug', SLUG).single(), 'client');
  await waitFor(async () => (await db.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).single()).data?.data?.trial === 'growth' && ((await db.from('invoices').select('id').eq('tenant_id', t.id).eq('kind', 'deposit')).data ?? []).length === 1, 30000);
  const grants = must(await db.from('module_grants').select('module_key, until, reason').eq('tenant_id', t.id).is('revoked_at', null), 'grants');
  const rec = must(await db.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).single(), 'record');
  const dep = must(await db.from('invoices').select('amount_cents, status').eq('tenant_id', t.id).eq('kind', 'deposit'), 'deposit');
  check(grants.length >= 10 && grants.some((g) => g.module_key === 'helix') && grants.some((g) => g.module_key === 'visibility') && grants.every((g) => /30-day Growth trial/.test(g.reason)), `Growth's features are on for 30 days (${grants.length} modules)`);
  check(t.plan == null && rec.data.package === 'launch' && rec.data.trial === 'growth' && dep.length === 1 && dep[0].amount_cents === 105000 && dep[0].status === 'draft', 'the package stays Launch, with the Launch deposit drafted ($1,050), and the trial on the record');
  const tok = createHmac('sha256', SECRET).update(`proposal:${t.id}`).digest('base64url').slice(0, 32);
  await go(`/proposal/${t.id}.${tok}`);
  const prop = await ev('document.body.innerText');
  check(/Launch/.test(prop) && /Includes a 30-day Growth trial/.test(prop) && prop.includes('$1,050'), 'the proposal shows Launch with the 30-day Growth trial and the $1,050 deposit');
  await shot('proposal-launch-trial');
} finally {
  ws.close(); chrome.kill();
  try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
  dev.kill();
  if (eventId) await db.from('calendar_events').delete().eq('id', eventId);
  await db.from('consult_invites').delete().eq('prospect_id', pr.id);
  await db.from('outbox').delete().like('to_email', '%@verify-consult.example');
  await db.from('tenants').update({ is_sample: true, name: 'Verify consult (test)' }).like('slug', 'verify-consult-%');
  const tids = ((await db.from('tenants').select('id').like('slug', 'verify-consult-%')).data ?? []).map((x) => x.id);
  if (tids.length) { await db.from('approvals').delete().in('tenant_id', tids).eq('status', 'pending'); await db.from('module_grants').update({ revoked_at: new Date().toISOString() }).in('tenant_id', tids).is('revoked_at', null); }
  await db.from('prospects').delete().eq('id', pr.id);
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
