// Verify Book a consultation on genovus.io (migration 0086) and the social links, on PREVIEW.
//  1. the site leads with "Book a consultation" and shows Genovus's social profiles (header, footer, sameAs)
//  2. /book: the short form goes straight to the open times; picking one books 30 minutes on the Genovus calendar,
//     invites the visitor and the team, uses the standing video room, marks the inquiry contacted
//  3. the longer /start form also lands on the open times; a bot submission books nothing
//   node --conditions=react-server --env-file=.env.local scripts/verify-public-booking.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3937, ORIGIN = `http://localhost:${PORT}`, SECRET = 'verify-public-booking-secret';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
const DOMAIN = 'verify-public-booking.example', ROOM = 'https://meet.google.com/verify-room';
const TEAM = [`team1@${DOMAIN}`, `team2@${DOMAIN}`];
const before = must(await db.from('app_settings').select('key, value').in('key', ['consult_video_url', 'consult_team_emails']), 'settings');
await db.from('app_settings').upsert([{ key: 'consult_video_url', value: ROOM }, { key: 'consult_team_emails', value: TEAM.join(', ') }]);

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env, CONSULT_LINK_SECRET: SECRET } });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
const port = 9582, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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
const shot = async (name, full) => {
  const p = full ? { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: await ev('innerWidth'), height: await ev('document.documentElement.scrollHeight'), scale: 1 } } : { format: 'png' };
  const s = await send('Page.captureScreenshot', p); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64'));
};
const fill = (vals) => ev(`(() => { for (const [n, v] of Object.entries(${JSON.stringify(vals)})) { const el = document.querySelector('form.form-card [name="' + n + '"]'); if (!el) continue; if (el.type === 'checkbox') { el.checked = true; continue; } el.value = v; } })()`);
const phone = () => send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const desk = () => send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
const eventIds = [];
try {
  // 1. the front door
  await desk(); await go('/');
  const nav = await ev(`[...document.querySelectorAll('.site-nav a')].map((a) => [a.textContent.trim(), a.getAttribute('href'), a.getAttribute('aria-label')])`);
  check(nav.some(([t, h]) => /^Book a consultation/.test(t) && h === '/book'), 'the header button is Book a consultation');
  check(await ev(`[...document.querySelectorAll('.hero2 a.btn')].some((a) => /Book a consultation/.test(a.textContent) && a.getAttribute('href') === '/book')`) ?? false, 'the hero leads with Book a consultation');
  const foot = await ev(`[...document.querySelectorAll('.site-foot .socials a')].map((a) => a.href)`);
  check(foot.length === 3 && foot.some((u) => /instagram\.com\/genovusintelliware/.test(u)) && foot.some((u) => /facebook\.com\/61595014457345/.test(u)) && foot.some((u) => /youtube\.com\/channel\/UCPukNUTk8ZJJSzovTqAhICA/.test(u)), `the footer shows Instagram, Facebook and YouTube (${foot.length})`);
  check(nav.filter(([, , l]) => /^Genovus on /.test(l ?? '')).length === 3, 'the desktop header shows them too');
  const ld = await ev(`JSON.parse(document.querySelector('script[type="application/ld+json"]')?.textContent || '{}')`);
  check(ld['@type'] === 'Organization' && ld.sameAs?.length === 3, 'search engines get the profiles (Organization sameAs)');
  await phone(); await go('/');
  check(!(await ev('document.documentElement.scrollWidth > innerWidth')) && await ev(`(() => { const b = [...document.querySelectorAll('.site-nav a.btn')].find((a) => /Book/.test(a.textContent)); const r = b?.getBoundingClientRect(); return !!r && r.width > 0 && r.right <= innerWidth; })()`), 'on a phone the Book button fits the header, no sideways scroll');
  await shot('home-phone-top');
  await ev('scrollTo(0, document.documentElement.scrollHeight)'); await sleep(500);
  await shot('home-phone-footer');

  // 2. /book on a phone
  await go('/book');
  check(await ev(`document.querySelectorAll('form.form-card input:not([type=hidden]):not([type=checkbox]):not([name=website])').length`) === 5 && await ev(`!!document.querySelector('form.form-card textarea[name=goals]')`), 'the booking form asks five things plus one optional question about the call');
  check(!(await ev('document.documentElement.scrollWidth > innerWidth')), '/book fits a phone');
  await shot('book-form', true);
  const email = `dana@${DOMAIN}`;
  await fill({ name: 'Dana Verify', org: 'Verify Family Insurance', email, phone: '404-555-0100', carrier: 'GEICO Exclusive Agency', consent: 'yes' });
  await sleep(2600);
  await ev(`document.querySelector('form.form-card button[type=submit]').click()`);
  check(await waitFor(async () => /^\/book\/[0-9a-f-]{36}\./.test(await ev('location.pathname'))), 'sending it goes straight to the open times');
  await sleep(1200);
  const inq = must(await db.from('inquiries').select('id, status, consent_text').eq('email', email).single(), 'inquiry');
  const inv = must(await db.from('consult_invites').select('id, minutes, inquiry_id, created_by, tenant_id, emails').eq('inquiry_id', inq.id).single(), 'invite');
  check(inq.status === 'new' && !!inq.consent_text && inv.minutes === 30 && inv.tenant_id === house.id && !inv.created_by && JSON.stringify(inv.emails) === JSON.stringify([email]), 'the inquiry is saved with consent; a 30-minute invitation on the Genovus calendar');
  const text = await ev('document.body.innerText');
  const times = await ev(`document.querySelectorAll('.ck-form button[aria-pressed]').length`);
  check(/Pick a time to talk/.test(text) && /30 minutes on video/.test(text) && /Thanks, Dana/i.test(text) && times > 0, `the page greets them and shows ${times} open times`);
  const todayMd = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  check((await ev("document.querySelector('.ck-day b')?.textContent")) !== todayMd, 'website bookings start the next business day, never today');
  check(!(await ev('document.documentElement.scrollWidth > innerWidth')), 'the time picker fits a phone');
  await shot('book-times', true);
  await ev(`document.querySelector('.ck-form button[aria-pressed]').click()`); await sleep(300);
  await ev(`[...document.querySelectorAll('.ck-form button')].find((b) => /^Book /.test(b.textContent))?.click()`);
  check(await waitFor(async () => !!(await db.from('consult_invites').select('booked_at').eq('id', inv.id).single()).data?.booked_at), 'picking a time books it');
  const evId = must(await db.from('consult_invites').select('event_id').eq('id', inv.id).single(), 'booked').event_id; eventIds.push(evId);
  const row = must(await db.from('calendar_events').select('starts_at, ends_at, location, attendees, notes').eq('id', evId).single(), 'event');
  const mails = must(await db.from('outbox').select('to_email, data').eq('template', 'meeting_invite').like('dedupe_key', `invite:${evId}:%`), 'invites');
  check(Date.parse(row.ends_at) - Date.parse(row.starts_at) === 1_800_000 && row.location === ROOM && /genovus\.io/.test(row.notes), `30 minutes, in the standing video room (${row.location})`);
  check(mails.length === 3 && [email, ...TEAM].every((e) => mails.some((m) => m.to_email === e)) && mails.every((m) => m.data.location === ROOM && m.data.from_email === TEAM[0]), `the invite goes to the visitor and the team (${mails.map((m) => m.to_email).join(', ')})`);
  check((await db.from('inquiries').select('status').eq('id', inq.id).single()).data?.status === 'contacted', 'the inquiry moves to contacted');
  check(/You’re booked for/.test(await ev('document.body.innerText')), 'they see it confirmed');
  await shot('book-confirmed');

  // 3. the longer form, and a bot
  await desk(); await go('/start');
  const email2 = `sam@${DOMAIN}`;
  await fill({ name: 'Sam Verify', org: 'Verify Auto & Home', email: email2, carrier: 'Independent', states: 'GA', goals: 'More quote requests', consent: 'yes' });
  await sleep(2600);
  await ev(`document.querySelector('form.form-card button[type=submit]').click()`);
  check(await waitFor(async () => /^\/book\//.test(await ev('location.pathname'))), '/start also lands on the open times');
  await go('/book');
  await fill({ name: 'Bot', org: 'Bot Co', email: `bot@${DOMAIN}`, consent: 'yes', website: 'http://spam.example' });
  await ev(`document.querySelector('form.form-card [name=website]').value = 'http://spam.example'`);
  await ev(`document.querySelector('form.form-card button[type=submit]').click()`);
  await waitFor(async () => (await ev('location.pathname')) === '/thanks', 10000);
  check(!(await db.from('inquiries').select('id').eq('email', `bot@${DOMAIN}`).maybeSingle()).data, 'a bot (hidden field filled) books nothing');
} finally {
  ws.close(); chrome.kill();
  try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
  dev.kill();
  for (const k of ['consult_video_url', 'consult_team_emails']) {
    const b = before.find((x) => x.key === k);
    if (b) await db.from('app_settings').update({ value: b.value }).eq('key', k); else await db.from('app_settings').delete().eq('key', k);
  }
  const iq = ((await db.from('inquiries').select('id').like('email', `%@${DOMAIN}`)).data ?? []).map((x) => x.id);
  if (iq.length) {
    const evs = ((await db.from('consult_invites').select('event_id').in('inquiry_id', iq)).data ?? []).map((x) => x.event_id).filter(Boolean);
    await db.from('consult_invites').delete().in('inquiry_id', iq);
    if (evs.length) await db.from('calendar_events').delete().in('id', evs);
    await db.from('inquiries').delete().in('id', iq);
  }
  await db.from('outbox').delete().like('to_email', `%@${DOMAIN}`);
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
