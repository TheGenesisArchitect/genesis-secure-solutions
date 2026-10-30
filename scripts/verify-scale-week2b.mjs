// Verify Scale Up week 2, release 2 on PREVIEW (migration 0090): consultation follow-ups.
//  1. drafts pass the copy rules; the email carries the mailing address, a stop link and one-click unsubscribe
//  2. the consult page shows the due step's draft; without a mailing address it can't be sent; edited and sent by a
//     person it queues once, with replies to them; the next step waits for its day
//  3. a no-show's due follow-up is on the Command Brief; sending it makes a fresh pick-a-time link that works
//  4. stops: "guarantee" never goes; the team's stop button; their own stop link (and one-click); another booking;
//     becoming a client
//   node --conditions=react-server --env-file=.env.local scripts/verify-scale-week2b.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { register } from 'node:module';
import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3940, ORIGIN = `http://localhost:${PORT}`, SECRET = 'verify-scale-week2b-secret';
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const H = 3_600_000, DOMAIN = 'verify-scale-week2b.example';
const stopToken = (id) => `${id}.${createHmac('sha256', SECRET).update(`followup-stop:${id}`).digest('base64url').slice(0, 24)}`;

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }`));
const F = await import('../data/consult-followups.ts');
const { copyWarnings } = await import('../lib/copy-rules.ts');
const { outboxEmail } = await import('../lib/email.ts');

// 1. drafts and the email
const inp = { first: 'Sam', org: 'Sam Verify Insurance', goal: 'More Google reviews', origin: 'https://genovus.io', rebook: 'https://genovus.io/book/x.y' };
const drafts = [...F.SHOWED, ...F.NO_SHOW].map((s) => ({ s: s.step, d: F.followupDraft(s.step, inp) }));
const words = drafts.map(({ d }) => `${d.subject} ${d.body}`).join(' | ');
check(drafts.length === 7 && !/guarantee/i.test(words) && copyWarnings(words).length === 0, `all 7 drafts pass the copy rules (${copyWarnings(words).join('; ') || 'no warnings'})`);
check(drafts.find((x) => x.s === 's1').d.body.includes('“More Google reviews”') && drafts.filter((x) => x.s.startsWith('n')).every((x) => x.d.button?.url), 'day 1 names their #1 goal; every no-show step carries a pick-a-time button');
const mail = outboxEmail('consult_followup', 'sam@x.example', { subject: 'Thanks for the call, Sam', body: 'Para one.\n\nPara two.', address: '100 Verify St, Columbus, GA 31909', stop_url: 'https://genovus.io/followups/stop/t', unsubscribe_url: 'https://genovus.io/api/followups/stop/t', reply_to: 'me@genovus.io', button_label: 'Pick a new time', button_url: 'https://genovus.io/book/x' }, 'https://genovus.io');
check(mail.subject === 'Thanks for the call, Sam' && /100 Verify St/.test(mail.text) && /followups\/stop\/t/.test(mail.text) && /Para two\./.test(mail.html) && /Pick a new time/.test(mail.html) && mail.replyTo === 'me@genovus.io', 'the email carries the message, the button, our mailing address and a stop link; replies go to the sender');
check(mail.headers?.['List-Unsubscribe'] === '<https://genovus.io/api/followups/stop/t>' && mail.headers?.['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click', 'and one-click unsubscribe headers');

const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email.toLowerCase();
const made = { events: [], invites: [], inquiries: [] };
async function seed(label, endedAgo, outcome, goals) {
  const email = `${label.toLowerCase()}@${DOMAIN}`;
  const inq = must(await db.from('inquiries').insert({ kind: 'agency', name: `${label} Verify`, email, org: `${label} Verify Insurance`, details: goals ? { goals } : {}, consent_text: 'verify', status: 'contacted' }).select('id').single(), 'inquiry');
  const end = new Date(Date.now() - endedAgo);
  const ev = must(await db.from('calendar_events').insert({ tenant_id: house.id, title: `Genovus consultation: ${label}`, starts_at: new Date(+end - 30 * 60_000).toISOString(), ends_at: end.toISOString(), location: 'Video call (link to follow)', attendees: [email], host: 'genovus', status: 'scheduled' }).select('id').single(), 'event');
  const ci = must(await db.from('consult_invites').insert({ tenant_id: house.id, label: `${label} Verify, ${label} Verify Insurance`, emails: [email], minutes: 30, event_id: ev.id, inquiry_id: inq.id, booked_at: new Date(+end - 3 * 24 * H).toISOString(), outcome }).select('id').single(), 'invite');
  made.inquiries.push(inq.id); made.events.push(ev.id); made.invites.push(ci.id);
  return { ci: ci.id, inq: inq.id, email };
}
const block = async (ci) => (await db.rpc('consult_followup_block', { p_invite: ci })).data;
const savedAddress = (await db.from('app_settings').select('value').eq('key', 'business_postal_address').maybeSingle()).data;
await db.from('app_settings').delete().eq('key', 'business_postal_address');

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env, CONSULT_LINK_SECRET: SECRET, APP_ORIGIN: ORIGIN } });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
const port = 9585, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(), on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');
let dialogs = [];
on.set('Page.javascriptDialogOpening', (p) => { dialogs.push(p.message); send('Page.handleJavaScriptDialog', { accept: true }); });
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); };
const text = () => ev('document.body.innerText');
const fu = (sel) => `document.querySelector('#follow-up ${sel}')`;
try {
  const sam = await seed('Sam', 26 * H, 'showed', 'More Google reviews');
  const nia = await seed('Nia', 3 * H, 'no_show', '');
  const ozzy = await seed('Ozzy', 26 * H, 'showed', '');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'link');
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console');

  // 2. the consult page
  await go(`/console/consults/${sam.ci}`);
  check(/Day 1 · thanks and recap/.test(await text()) && /Add it in Setup/.test(await text()) && !(await ev(fu('form[data-helix-form="follow-up"]') + ' !== null')), 'with no mailing address set, the draft can\'t be sent and the page says where to add it');
  await db.from('app_settings').upsert({ key: 'business_postal_address', value: '100 Verify Street, Columbus, GA 31909', updated_at: new Date().toISOString() });
  await go(`/console/consults/${sam.ci}`);
  const subj = await ev(fu('[name=subject]') + '?.value'), body = await ev(fu('[name=body]') + '?.value');
  check(subj === 'Thanks for the call, Sam' && /“More Google reviews”/.test(body ?? ''), 'the due step\'s draft is ready to edit, with their #1 goal');
  await shot('followup-draft');
  await ev(`(() => { const f = ${fu('form[data-helix-form="follow-up"]')}; f.querySelector('[name=subject]').value = 'Thanks for the call today, Sam'; f.querySelector('button[type=submit]').click(); })()`);
  const sent = await waitFor(async () => ((await db.from('consult_followups').select('id').eq('invite_id', sam.ci).eq('step', 's1')).data ?? []).length === 1);
  check(sent && dialogs.some((d) => d.includes(sam.email)), 'a person confirms who it goes to, then it sends');
  const ob = (await db.from('outbox').select('data, dedupe_key').eq('template', 'consult_followup').eq('to_email', sam.email)).data ?? [];
  check(ob.length === 1 && ob[0].data.subject === 'Thanks for the call today, Sam' && ob[0].data.reply_to === adminEmail && /Columbus, GA/.test(ob[0].data.address) && ob[0].data.stop_url === `${ORIGIN}/followups/stop/${stopToken(sam.ci)}`, 'it queues once, with their edit, replies to the sender, the address and their stop link');
  check(((await db.from('audit_events').select('id').eq('action', 'consult.followup').ilike('subject', 'Sam Verify%')).data ?? []).length >= 1, 'and it is in the audit log');
  await go(`/console/consults/${sam.ci}`);
  const after = await text();
  check(/Sent /.test(after) && /Preview the next one \(Day 3/.test(after) && !(await ev(fu('form[data-helix-form="follow-up"]') + ' !== null')), 'the next step waits for its day (preview only)');
  await shot('followup-sent');

  // 3. no-show on the Brief, and the fresh link
  await go('/console');
  const card = await waitFor(async () => await ev(`[...document.querySelectorAll('*')].some((n) => n.children.length === 0 && n.textContent === 'Follow up with Nia')`), 30000);
  check(card, 'a no-show\'s due follow-up is on the Command Brief');
  check(!(await ev(`[...document.querySelectorAll('*')].some((n) => n.children.length === 0 && n.textContent === 'Follow up with Sam')`)), 'a step already sent isn\'t');
  await shot('brief-followup');
  await ev(`(() => { let el = [...document.querySelectorAll('*')].find((n) => n.children.length === 0 && n.textContent === 'Follow up with Nia'); while (el && !el.querySelector('button')) el = el.parentElement; [...el.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Review and send')?.click(); })()`);
  check(await waitFor(async () => (await ev('location.pathname')) === `/console/consults/${nia.ci}`, 90000), '"Review and send" opens the consultation');
  await sleep(1500);
  check(/We missed you today/.test((await ev(fu('[name=subject]') + '?.value')) ?? '') && /Pick a new time/.test(await text()), 'the same-day no-show draft offers a new time');
  await ev(`${fu('form[data-helix-form="follow-up"] button[type=submit]')}.click()`);
  await waitFor(async () => ((await db.from('outbox').select('id').eq('template', 'consult_followup').eq('to_email', nia.email)).data ?? []).length === 1);
  const nob = ((await db.from('outbox').select('data').eq('template', 'consult_followup').eq('to_email', nia.email)).data ?? [])[0];
  const rebook = ((await db.from('consult_invites').select('id').eq('inquiry_id', nia.inq).neq('id', nia.ci)).data ?? []);
  check(nob && /\/book\/[0-9a-f-]{36}\./.test(nob.data.button_url ?? '') && rebook.length === 1 && nob.data.button_url.includes(rebook[0].id), 'sending makes a fresh pick-a-time link of their own');
  const bookPage = nob ? await fetch(nob.data.button_url.replace('https://genovus.io', ORIGIN)) : { status: 0, text: async () => '' };
  check(bookPage.status === 200 && /Pick a time/.test(await bookPage.text()), 'and the link opens their booking page');

  // 4. stops
  await go(`/console/consults/${ozzy.ci}`);
  dialogs = [];
  await ev(`(() => { const f = ${fu('form[data-helix-form="follow-up"]')}; f.querySelector('[name=body]').value = 'We guarantee more leads in 30 days.'; f.querySelector('button[type=submit]').click(); })()`);
  await sleep(4000);
  check(((await db.from('consult_followups').select('id').eq('invite_id', ozzy.ci)).data ?? []).length === 0, '"guarantee" never goes out');
  await go(`/console/consults/${ozzy.ci}`);
  await ev(`[...document.querySelectorAll('#follow-up button')].find((b) => /Stop follow-ups/.test(b.textContent))?.click()`);
  check(await waitFor(async () => !!(await db.from('consult_invites').select('followups_stopped_at').eq('id', ozzy.ci).single()).data?.followups_stopped_at), 'the team can stop a sequence');
  check(/Follow-ups were stopped|Stopped by the team/.test(await block(ozzy.ci) ?? ''), 'and nothing more can be sent');
  check(!(await fetch(`${ORIGIN}/followups/stop/${sam.ci}.badsignature`)).ok, 'a forged stop link is refused');
  await go(`/followups/stop/${stopToken(sam.ci)}`);
  check(/Stop follow-up emails\?/.test(await text()) && !(await db.from('consult_invites').select('followups_stopped_at').eq('id', sam.ci).single()).data?.followups_stopped_at, 'opening their stop link alone changes nothing (mail scanners open links)');
  await shot('stop-page');
  await ev(`document.querySelector('form[action^="/api/followups/stop/"] button').click()`);
  await waitFor(async () => /No more follow-ups/.test(await text()));
  const supp = (await db.from('suppression').select('id').eq('email', sam.email)).data ?? [];
  check(/No more follow-ups/.test(await text()) && /They asked to stop/.test(await block(sam.ci) ?? '') && supp.length === 1, 'their stop button stops the sequence and suppresses their address');
  const oneClick = await fetch(`${ORIGIN}/api/followups/stop/${stopToken(nia.ci)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' });
  check(oneClick.status === 200 && /They asked to stop/.test(await block(nia.ci) ?? ''), 'mail apps\' one-click unsubscribe works too');
  // another booking, then becoming a client (fresh consults so the stops above don't mask them)
  const tia = await seed('Tia', 26 * H, 'showed', '');
  check((await block(tia.ci)) === null, 'a showed consult with nothing in the way can be followed up');
  const again = must(await db.from('consult_invites').insert({ tenant_id: house.id, label: 'Tia Verify, again', emails: [tia.email], minutes: 30, inquiry_id: tia.inq, booked_at: new Date().toISOString() }).select('id').single(), 'again'); made.invites.push(again.id);
  check(/booked another consultation/.test(await block(tia.ci) ?? ''), 'booking another consultation stops it');
  const uma = await seed('Uma', 26 * H, 'showed', '');
  const anyTenant = (await db.from('tenants').select('id').eq('kind', 'agency').limit(1).single()).data;
  await db.from('inquiries').update({ tenant_id: anyTenant.id }).eq('id', uma.inq);
  check(/client now|deposit is paid/.test(await block(uma.ci) ?? ''), 'becoming a client (or paying the deposit) stops it');
  await db.from('inquiries').update({ tenant_id: null }).eq('id', uma.inq);
} finally {
  ws.close(); chrome.kill();
  try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
  dev.kill();
  if (savedAddress) await db.from('app_settings').upsert({ key: 'business_postal_address', value: savedAddress.value, updated_at: new Date().toISOString() }); else await db.from('app_settings').delete().eq('key', 'business_postal_address');
  await db.from('suppression').delete().like('email', `%@${DOMAIN}`);
  if (made.inquiries.length) await db.from('consult_invites').delete().in('inquiry_id', made.inquiries);
  if (made.invites.length) await db.from('consult_invites').delete().in('id', made.invites);
  if (made.events.length) await db.from('calendar_events').delete().in('id', made.events);
  if (made.inquiries.length) {
    for (const x of made.inquiries) await db.from('outbox').delete().like('dedupe_key', `inquiry:${x}:%`);
    await db.from('outbox').delete().in('dedupe_key', made.inquiries.map((x) => `inquiry-push:${x}`));
    await db.from('inquiries').delete().in('id', made.inquiries);
  }
  await db.from('outbox').delete().like('to_email', `%@${DOMAIN}`);
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
