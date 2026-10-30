// Verify Scale Up week 1 on PREVIEW (migrations 0087, 0088):
//  1. speed to lead: a website inquiry queues one team push; booking queues the confirmation email and a booking push
//  2. reminders: a day and an hour before, once each, never for someone who booked inside the window, never when cancelled
//  3. emails render: confirmation and both reminders, with the video link when there is one
//  4. after a consult, the Command Brief asks how it went; one tap records it and /console/growth shows the funnel
//   node --conditions=react-server --env-file=.env.local scripts/verify-scale-week1.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3938, ORIGIN = `http://localhost:${PORT}`, SECRET = 'verify-scale-week1-secret';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const H = 3_600_000, DOMAIN = 'verify-scale-week1.example';

// The app's own imports are extensionless (the bundler resolves them); let plain Node find the .ts beside them.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }`));
const { queueConsultReminders } = await import('../lib/consult-reminders.ts');
const { outboxEmail } = await import('../lib/email.ts');
const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email.toLowerCase();
const made = { events: [], invites: [] };

// A booked consultation straight in the database (start/booked relative to now).
async function consult(label, startIn, bookedAgo, status = 'scheduled', location = 'https://meet.google.com/verify-room') {
  const start = new Date(Date.now() + startIn), email = `${label.toLowerCase().replace(/\W+/g, '')}@${DOMAIN}`;
  const ev = must(await db.from('calendar_events').insert({ tenant_id: house.id, title: `Genovus consultation: ${label}`, starts_at: start.toISOString(), ends_at: new Date(+start + 30 * 60_000).toISOString(), location, attendees: [email], host: 'genovus', status }).select('id').single(), 'event');
  const ci = must(await db.from('consult_invites').insert({ tenant_id: house.id, label: `${label}, Verify Agency`, emails: [email], minutes: 30, event_id: ev.id, booked_at: new Date(Date.now() - bookedAgo).toISOString() }).select('id').single(), 'invite');
  made.events.push(ev.id); made.invites.push(ci.id);
  return { ev: ev.id, ci: ci.id, email };
}
const reminders = async (email) => ((await db.from('outbox').select('data, dedupe_key').eq('template', 'consult_reminder').eq('to_email', email)).data ?? []);

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env, CONSULT_LINK_SECRET: SECRET } });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
const port = 9583, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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
try {
  // 1. speed to lead, through the real /book flow
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go('/book');
  const email = `riley@${DOMAIN}`;
  await ev(`(() => { const v = { name: 'Riley Verify', org: 'Verify Coastal Insurance', email: '${email}', carrier: 'GEICO', goals: 'More quote requests from Google' }; for (const [n, x] of Object.entries(v)) document.querySelector('form.form-card [name="' + n + '"]').value = x; document.querySelector('form.form-card [name=consent]').checked = true; })()`);
  await sleep(2600);
  await ev(`document.querySelector('form.form-card button[type=submit]').click()`);
  await waitFor(async () => /^\/book\//.test(await ev('location.pathname')));
  const inq = must(await db.from('inquiries').select('id, details').eq('email', email).single(), 'inquiry');
  const push = (await db.from('outbox').select('to_email, data').eq('dedupe_key', `inquiry-push:${inq.id}`)).data ?? [];
  check(push.length === 1 && push[0].to_email === 'push' && /New inquiry · Verify Coastal Insurance/.test(push[0].data.title) && push[0].data.url === '/console/inquiries', 'a website inquiry queues one push alert to the team');
  check(inq.details?.goals === 'More quote requests from Google', 'their #1 goal for the call is saved on the inquiry');
  await sleep(1000);
  await ev(`document.querySelector('.ck-form button[aria-pressed]').click()`); await sleep(300);
  await ev(`[...document.querySelectorAll('.ck-form button')].find((b) => /^Book /.test(b.textContent))?.click()`);
  const inv = must(await db.from('consult_invites').select('id, event_id').eq('inquiry_id', inq.id).single(), 'invite');
  made.invites.push(inv.id);
  await waitFor(async () => !!(await db.from('consult_invites').select('booked_at').eq('id', inv.id).single()).data?.booked_at);
  const evId = (await db.from('consult_invites').select('event_id').eq('id', inv.id).single()).data.event_id; made.events.push(evId);
  await waitFor(async () => ((await db.from('outbox').select('id').eq('dedupe_key', `consult-confirm:${inv.id}:${email}`)).data ?? []).length === 1, 10000);
  const confirm = (await db.from('outbox').select('data').eq('dedupe_key', `consult-confirm:${inv.id}:${email}`)).data ?? [];
  const bookPush = (await db.from('outbox').select('data').eq('dedupe_key', `consult-push:${inv.id}`)).data ?? [];
  check(confirm.length === 1 && confirm[0].data.first === 'Riley' && /\d/.test(confirm[0].data.when), `booking queues the confirmation email (${confirm[0]?.data.when})`);
  check(bookPush.length === 1 && /Consultation booked/.test(bookPush[0].data.title), 'and a push to the team that a consult was booked');

  // 2. reminders
  const a = await consult('Ava', 23 * H, 3 * 24 * H);          // tomorrow, booked days ago: the day-before reminder
  const b = await consult('Ben', 50 * 60_000, 3 * 24 * H);     // in 50 minutes, booked days ago: the hour-before one only
  const c = await consult('Cal', 23 * H, 1 * H);               // tomorrow, booked an hour ago: nothing yet
  const d = await consult('Dee', 50 * 60_000, 3 * 24 * H, 'cancelled'); // cancelled: nothing
  const e = await consult('Eve', 30 * H, 3 * 24 * H);          // more than a day out: nothing yet
  await queueConsultReminders(db); await queueConsultReminders(db);
  const [ra, rb, rc, rd, re] = await Promise.all([a, b, c, d, e].map((x) => reminders(x.email)));
  check(ra.length === 1 && ra[0].data.lead === '24h', 'a day before: one reminder, even when the run repeats');
  check(rb.length === 1 && rb[0].data.lead === '1h', 'an hour before: one reminder (no late day-before one)');
  check(rc.length === 0 && rd.length === 0 && re.length === 0, 'nothing for a call booked an hour ago, a cancelled call, or one more than a day out');
  await db.from('calendar_events').update({ starts_at: new Date(Date.now() + 22 * H).toISOString(), ends_at: new Date(Date.now() + 22.5 * H).toISOString() }).eq('id', a.ev);
  await queueConsultReminders(db);
  check((await reminders(a.email)).length === 2, 'a rescheduled call gets a fresh reminder for its new time');

  // 3. the emails
  const mc = outboxEmail('consult_confirm', email, { first: 'Riley', when: 'Monday, November 2 at 10:00 AM', minutes: '30', place: 'https://meet.google.com/verify-room' }, ORIGIN);
  const m1 = outboxEmail('consult_reminder', a.email, { ...ra[0].data }, ORIGIN);
  const m2 = outboxEmail('consult_reminder', b.email, { ...rb[0].data, place: '' }, ORIGIN);
  check(/You’re booked/.test(mc.subject) && /isn’t a sales pitch/.test(mc.text ?? mc.html) && /meet\.google\.com\/verify-room/.test(mc.html) && /\/film/.test(mc.html) && /sample agency/.test(mc.html) && !/real agency/.test(mc.html), 'the confirmation frames a diagnostic, asks their #1 goal, has the video link and the film');
  check(/^Reminder: your Genovus consultation, [A-Z][a-z]+day at /.test(m1.subject) && /Join the call/.test(m1.html), `the day-before reminder (${m1.subject})`);
  check(m2.subject === 'In an hour: your Genovus consultation' && !/Join the call/.test(m2.html) && /send the video link before the call/.test(m2.html), 'the hour-before reminder; without a room link it promises one before the call');
  fs.writeFileSync(path.join(OUT, 'consult-confirm.html'), mc.html); fs.writeFileSync(path.join(OUT, 'consult-reminder-24h.html'), m1.html);

  // 4. how did it go → the funnel
  const past = await consult('Gia', -2 * H, 3 * 24 * H);
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'link');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console');
  const cardFound = await waitFor(async () => await ev(`[...document.querySelectorAll('*')].some((n) => n.children.length === 0 && /How did the consult with Gia go\\?/.test(n.textContent))`), 30000);
  check(cardFound, 'after the call, the Command Brief asks how the consult with Gia went');
  await shot('brief-consult-card');
  await ev(`(() => { const t = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && /How did the consult with Gia go\\?/.test(n.textContent)); let el = t; while (el && !el.querySelector('button')) el = el.parentElement; [...el.querySelectorAll('button')].find((b) => /They showed/.test(b.textContent))?.click(); })()`);
  check(await waitFor(async () => (await db.from('consult_invites').select('outcome').eq('id', past.ci).single()).data?.outcome === 'showed'), 'one tap records that they showed');
  const audit = (await db.from('audit_events').select('id').eq('action', 'consult.outcome').ilike('subject', 'Gia,%')).data ?? [];
  check(audit.length >= 1, 'and it is in the audit log');
  await go('/console/growth');
  const g = await ev(`document.querySelector('[data-helix-item="Sales funnel"]')?.innerText ?? ''`);
  check(/Booked consults/i.test(g) && /Show rate/i.test(g) && /Close rate/i.test(g) && /Cost per booked call/i.test(g) && /\d+%/.test(g), 'Growth shows booked consults, show rate, close rate and cost per booked call');
  await shot('growth-funnel');
  const anon = await fetch(`${ORIGIN}/api/consult-outcome`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite: past.ci, outcome: 'no_show' }) });
  check(anon.status === 401 && (await db.from('consult_invites').select('outcome').eq('id', past.ci).single()).data?.outcome === 'showed', 'nobody signed out can record an outcome');
} finally {
  ws.close(); chrome.kill();
  try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
  dev.kill();
  const iq = ((await db.from('inquiries').select('id').like('email', `%@${DOMAIN}`)).data ?? []).map((x) => x.id);
  if (made.invites.length) await db.from('consult_invites').delete().in('id', made.invites);
  if (iq.length) await db.from('consult_invites').delete().in('inquiry_id', iq);
  if (made.events.length) await db.from('calendar_events').delete().in('id', made.events.filter(Boolean));
  if (iq.length) { await db.from('outbox').delete().in('dedupe_key', iq.map((x) => `inquiry-push:${x}`)); await db.from('inquiries').delete().in('id', iq); }
  await db.from('outbox').delete().like('to_email', `%@${DOMAIN}`);
  await db.from('outbox').delete().like('dedupe_key', 'consult-push:%').like('data->>title', '%Verify%');
  await db.from('outbox').delete().eq('template', 'meeting_invite').contains('data', { notes: 'Booked on genovus.io: a first conversation about their agency.' }).like('data->>title', '%Verify%');
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
