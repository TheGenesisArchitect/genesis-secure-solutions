// Verify the new client's welcome and kickoff on PREVIEW (migration 0092): a Growth client with a deposit date, a
// tentative kickoff on their calendar and an owner signed in to their dashboard.
//  1. the dashboard menu leads with Welcome; the page shows the Growth plan and terms, the deposit and its date,
//     the kickoff to confirm, Ask Helix up front, the form by section, the preview and the promo library
//  2. Helix's own page reader sees every welcome section with its fields, and fills and saves one
//  3. a section saves onto the record (and only its own fields); line pages are capped by the package
//  4. confirming the kickoff marks it and tells the team; "pick another time" offers open times and moving it
//     re-sends the calendar invite and tells the team; nobody else can do either
//  5. the console: the Welcome and kickoff panel, the deposit date, the one-tap welcome email (to the record and the
//     owners, and no second checklist email later), the kickoff agenda, and copying a same-carrier agency's promos
//  6. kickoff reminders go to the client's people a day and an hour before, never to the team
//   node --conditions=react-server --env-file=.env.local scripts/verify-welcome-kickoff.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { register, stripTypeScriptTypes } from 'node:module';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3943, ORIGIN = `http://localhost:${PORT}`;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const H = 3_600_000, DOMAIN = 'verify-welcome.example', RUN = Date.now().toString(36);

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); throw e; } }`));
const { outboxEmail } = await import('../lib/email.ts');
const { queueKickoffReminders } = await import('../lib/consult-reminders.ts');
const { copyWarnings } = await import('../lib/copy-rules.ts');

// Helix's page reader, as the browser runs it: lib/helix-page.ts with its types stripped, as one global.
const hp = stripTypeScriptTypes(fs.readFileSync('lib/helix-page.ts', 'utf8')).replace(/^'use client';/, '').replace(/^export /gm, '');
const HP = `window.__hp = (() => { ${hp}\n return { readPage, fillForm, submitForm }; })();`;

// An Eastern wall-clock time as an instant (EDT or EST, whichever applies that day).
const eastern = (day, hhmm) => { for (const off of ['-04:00', '-05:00']) { const d = new Date(`${day}T${hhmm}:00${off}`); if (d.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }) === hhmm) return d; } throw new Error('tz'); };
const nextWorkday = (n) => { const d = new Date(); let k = 0; while (true) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() % 6 !== 0 && ++k >= n) return d.toISOString().slice(0, 10); } };

const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email.toLowerCase();
const made = { tenants: [], users: [] };
const ownerEmail = `owner-${RUN}@${DOMAIN}`, recordEmail = `office-${RUN}@${DOMAIN}`;

// The client: Growth, deposit due on a set day, record from the consult, owner invited.
const t = must(await db.from('tenants').insert({ slug: `verify-welcome-${RUN}`, name: 'Verify Welcome Agency', stage: 'deposit', plan: 'growth' }).select('id, slug').single(), 'tenant');
made.tenants.push(t.id);
const rec = { agencyName: 'Verify Welcome Agency', contactName: 'Tyler Verify', email: recordEmail, phone: '(770) 555-0142', address: '1450 Main St, Peachtree City, GA 30269', city: 'Peachtree City', state: 'GA', carrier: 'GEICO', package: 'growth', lines: ['auto', 'home'] };
must(await db.from('agent_records').insert({ tenant_id: t.id, version: 1, data: rec, is_current: true, note: 'verify' }), 'record');
const due = nextWorkday(6);
must(await db.from('invoices').insert({ tenant_id: t.id, kind: 'deposit', amount_cents: 175_000, status: 'draft', note: 'Growth setup deposit', lines: [{ label: 'Growth setup: 70% deposit', cents: 175_000 }], due_date: due }), 'deposit');
const owner = must(await db.auth.admin.createUser({ email: ownerEmail, email_confirm: true }), 'owner').user;
made.users.push(owner.id);
must(await db.from('memberships').insert({ tenant_id: t.id, user_id: owner.id, role: 'owner' }), 'membership');
// The tentative kickoff Helix put on their calendar, invite already sent.
const kickDay = nextWorkday(2), kickStart = eastern(kickDay, '11:00');
const ev = must(await db.from('calendar_events').insert({ tenant_id: t.id, title: 'Genovus kickoff call', starts_at: kickStart.toISOString(), ends_at: new Date(+kickStart + 30 * 60_000).toISOString(), location: 'https://meet.example/verify', attendees: [ownerEmail, adminEmail], host: 'genovus', created_by: admin.user_id, invited_at: new Date().toISOString(), invited_sequence: 0, created_at: new Date(Date.now() - 2 * 24 * H).toISOString(), updated_at: new Date(Date.now() - 2 * 24 * H).toISOString() }).select('id').single(), 'kickoff');
// Another GEICO agency with a promo in its Library (a public image, so no file storage is needed here).
const src = must(await db.from('tenants').insert({ slug: `verify-welcome-src-${RUN}`, name: 'Verify Source GEICO Agency', stage: 'care', plan: 'growth' }).select('id').single(), 'source');
made.tenants.push(src.id);
must(await db.from('agent_records').insert({ tenant_id: src.id, version: 1, data: { agencyName: 'Verify Source GEICO Agency', carrier: 'GEICO Exclusive Agent' }, is_current: true, note: 'verify' }), 'source record');
must(await db.from('assets').insert([
  { tenant_id: src.id, kind: 'image', title: 'GEICO bundle promo (verify)', location_kind: 'public', location: '/brand/genovus/genovus-mark-128.png', audience: 'client', rights_status: 'cleared' },
  { tenant_id: src.id, kind: 'image', title: 'Private cover (verify)', location_kind: 'public', location: '/w/not-yours/social/facebook-cover.png', audience: 'client', rights_status: 'cleared' },
  { tenant_id: src.id, kind: 'image', title: 'Headshot (from your checklist)', location_kind: 'public', location: '/brand/genovus/genovus-mark-128.png', audience: 'client', rights_status: 'cleared' },
]), 'source promos');

// 6a. the welcome email itself
const mail = outboxEmail('client_welcome', ownerEmail, { agency: 'Verify Welcome Agency', first: 'Tyler', package: 'Growth', deposit: '$1,750', due: 'Monday, November 9', paid: 'false', balance: '$750', care: 'Growth Care at $399 a month', kickoff: 'Monday, November 2 at 11:00 AM', confirmed: 'false', link: 'https://genovus.io/app/x/welcome', address: '218 Neely Rd, Fayetteville GA 30214', reply_to: 'me@genovus.io' }, 'https://genovus.io');
check(/Welcome to Genovus, Tyler: your Growth plan and kickoff/.test(mail.subject) && /\$1,750/.test(mail.text) && /November 9/.test(mail.text) && /Ask Helix/.test(mail.text) && /please confirm it/i.test(mail.text) && mail.html.includes('https://genovus.io/app/x/welcome') && /218 Neely Rd/.test(mail.text) && mail.replyTo === 'me@genovus.io', 'the welcome email carries the plan, deposit and date, the kickoff to confirm, Ask Helix, the Welcome page link and our address');
const warn = copyWarnings(mail.text).filter((w) => !/^Prices|^Percentages/.test(w));
check(warn.length === 0 && !/guarantee/i.test(mail.text), `and passes the copy rules; its own plan prices are expected (${warn.join('; ') || 'no warnings'})`);
const rem = outboxEmail('consult_reminder', ownerEmail, { kind: 'kickoff', lead: '24h', first: '', when: 'Monday, November 2 at 11:00 AM', time: '11:00 AM', day: 'Monday', first_call: 'false', minutes: '30', place: 'https://meet.example/verify' }, 'https://genovus.io');
check(/kickoff call/.test(rem.subject) && !/consultation/.test(rem.text) && /Welcome page/.test(rem.text), `a kickoff reminder says kickoff, not consultation (“${rem.subject}”)`);

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env, APP_ORIGIN: ORIGIN } });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
const port = 9587, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(), on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev_ = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');
on.set('Page.javascriptDialogOpening', () => send('Page.handleJavaScriptDialog', { accept: true }));
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(2500); };
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const shot = async (name, full = false) => { if (full) { const m = await send('Page.getLayoutMetrics'); await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: Math.min(6000, Math.ceil(m.result.cssContentSize.height)), deviceScaleFactor: 1, mobile: false }); } const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); if (full) await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false }); };
const text = () => ev_('document.querySelector("main")?.innerText ?? ""');
const signIn = async (email, next) => {
  await send('Network.enable'); await send('Network.clearBrowserCookies');
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(next)}`);
  await ev_(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev_('location.pathname')) === next.split('?')[0]);
};
const intake = async () => ((await db.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).single()).data?.data?.intake ?? {});
const outbox = async (template) => (await db.from('outbox').select('to_email, data, dedupe_key').eq('template', template).or(`tenant_id.eq.${t.id},dedupe_key.ilike.%${ev.id}%`)).data ?? [];

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  check((await fetch(`${ORIGIN}/api/welcome/save`, { method: 'POST', body: new FormData() })).status === 401 && (await fetch(`${ORIGIN}/api/kickoff`, { method: 'POST', body: '{}' })).status === 401, 'signed out, nobody can save a welcome form or touch a kickoff');

  // 1. the owner's Welcome page
  await signIn(ownerEmail, `/app/${t.slug}/welcome`);
  await waitFor(async () => /let’s build your Growth platform/.test(await text()), 30000);
  const nav = await ev_(`[...document.querySelectorAll('nav a, aside a')].map((a) => a.textContent.trim()).filter(Boolean).slice(0, 4).join(' | ')`);
  check(/^(GEN\S*\s*\|\s*)?Welcome \| Home/.test(nav ?? ''),`the menu leads with Welcome (${nav})`);
  const page = await text();
  check(/Growth/.test(page) && /\$2,500/.test(page) && /\$1,750/.test(page) && /\$750/.test(page) && /Growth Care · \$399\/mo/.test(page) && /due /.test(page), 'the page shows the Growth plan: setup, the 70% deposit and its due date, the 30% at launch, then care');
  check(/Your kickoff call/i.test(page) && /Please confirm/i.test(page) && /11:00 AM/.test(page), 'the tentative kickoff is there to confirm');
  check(/meet Helix/i.test(page) && /best part of your dashboard/.test(page) && (await ev_(`!!document.querySelector('.wl-helix button')`)), 'Ask Helix is up front, with starter questions');
  check(/On file from your consult/.test(page) && (/Open your preview/.test(page) || !process.env.SITE_PREVIEW_SECRET) && /promo library/i.test(page), 'it shows what’s on file, the preview and the promo library');
  await shot('welcome-page', true);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await go(`/app/${t.slug}/welcome`);
  check((await ev_('document.documentElement.scrollWidth <= window.innerWidth + 1')) === true, 'on a phone the page fits the screen');
  await shot('welcome-phone');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/app/${t.slug}/welcome`);

  // 2. what Helix sees, and Helix filling and saving a section
  await ev_(HP);
  const map = await ev_('window.__hp.readPage()');
  const forms = (map?.forms ?? []).filter((f) => /^welcome:/i.test(f.key) || /welcome:/i.test(f.title));
  const want = ['legalName', 'hours', 'licensedStates', 'serviceArea', 'languages', 'officialUrl', 'carrierContact', 'carrierRules', 'linePages', 'story', 'goal', 'domainChoice', 'googleListing', 'facebook', 'instagram', 'alertEmails', 'team', 'questions'];
  const seen = forms.flatMap((f) => f.fields.map((x) => x.name));
  check(forms.length === 6 && forms.every((f) => f.lane === 'internal') && want.every((n) => seen.includes(n)), `Helix sees all 6 welcome sections and every field (${forms.length} forms; missing: ${want.filter((n) => !seen.includes(n)).join(', ') || 'none'})`);
  check(JSON.stringify(map).length <= 4400 + 400, `and the page fits Helix's snapshot (${JSON.stringify(map).length} chars)`);
  const office = forms.find((f) => /Your office/.test(f.key));
  const fill = await ev_(`window.__hp.fillForm(${JSON.stringify(office?.key ?? '')}, [{ name: 'legalName', value: 'Verify Welcome Agency, LLC' }, { name: 'hours', value: 'Mon–Fri 9–6, Sat 10–1' }, { name: 'licensedStates', value: 'GA' }])`);
  const sub = await ev_(`window.__hp.submitForm(${JSON.stringify(office?.key ?? '')})`);
  await waitFor(async () => (await intake()).legalName === 'Verify Welcome Agency, LLC', 20000);
  const i1 = await intake();
  check(fill?.ok !== false && sub?.ok === true && i1.legalName === 'Verify Welcome Agency, LLC' && i1.hours === 'Mon–Fri 9–6, Sat 10–1' && i1.licensedStates === 'GA', `Helix fills “Your office” and saves it onto the record (${JSON.stringify(sub)})`);

  // 3. a person saving a section; line pages capped by the package
  await go(`/app/${t.slug}/welcome`);
  const saveSection = async (title, js) => ev_(`(async () => { const f = [...document.querySelectorAll('form[data-helix-form]')].find((x) => x.dataset.helixForm === 'welcome: ${title}'); f.closest('details').open = true; ${js}; f.requestSubmit(); await new Promise((r) => setTimeout(r, 2500)); return f.innerText; })()`);
  const tooMany = await saveSection('Your lines and your story', `['auto','home','boat','rv','motorcycle'].forEach((v) => { f.querySelector('input[name=linePages][value=' + v + ']').checked = true; }); f.querySelector('[name=story]').value = 'A family office in Peachtree City.'`);
  check(/up to 4 line pages/.test(tooMany ?? '') && !(await intake()).story, 'five line pages on Growth is refused, and nothing in that section saves');
  await go(`/app/${t.slug}/welcome`);
  await saveSection('Your lines and your story', `f.querySelectorAll('input[name=linePages]').forEach((b) => { b.checked = ['auto','home','boat'].includes(b.value); }); f.querySelector('[name=story]').value = 'A family office in Peachtree City.'`);
  const i2 = await intake();
  check(i2.linePages === 'auto, home, boat' && i2.story === 'A family office in Peachtree City.' && i2.legalName === 'Verify Welcome Agency, LLC', `three line pages and the story save, and the office section is kept (${i2.linePages})`);
  await go(`/app/${t.slug}/welcome`);
  const badEmail = await saveSection('Your team and your questions', `f.querySelector('[name=alertEmails]').value = 'not an email'`);
  check(/emails separated by commas/.test(badEmail ?? ''), 'a bad lead-alert email is explained, not saved');
  await go(`/app/${t.slug}/welcome`);
  await saveSection('Web address, Google and socials', `f.querySelector('[name=facebook]').value = 'facebook.com/verifywelcome'`);
  check((await intake()).facebook === 'https://facebook.com/verifywelcome', 'a link pasted without https:// is saved as a full link');
  await go(`/app/${t.slug}/welcome`);
  check(/6 of 22 answered/.test(await text()), `the progress counts what’s answered (${(await text()).match(/\d+ of \d+ answered/)?.[0]})`);

  // 4. the kickoff: confirm, then move
  await ev_(`[...document.querySelectorAll('.wl-kick button')].find((b) => /Confirm this time/.test(b.textContent)).click()`);
  await waitFor(async () => !!(await db.from('calendar_events').select('confirmed_at').eq('id', ev.id).single()).data?.confirmed_at, 15000);
  const c1 = (await db.from('calendar_events').select('confirmed_at, confirmed_by').eq('id', ev.id).single()).data;
  const pushC = (await db.from('outbox').select('data').eq('dedupe_key', `kickoff-confirm:${ev.id}:0`)).data ?? [];
  check(!!c1.confirmed_at && c1.confirmed_by === owner.id && pushC.length === 1 && /Kickoff confirmed/.test(pushC[0].data.title), 'confirming marks the kickoff confirmed by the owner and tells the team’s phones');
  await go(`/app/${t.slug}/welcome`);
  check(/Confirmed/i.test(await ev_(`document.querySelector('.wl-kick')?.innerText`)), 'and the card says Confirmed');
  await ev_(`[...document.querySelectorAll('.wl-kick button')].find((b) => /Pick another time/.test(b.textContent)).click()`);
  await waitFor(async () => (await ev_(`document.querySelectorAll('.wl-slots button').length`)) > 0, 30000);
  const slotN = await ev_(`document.querySelectorAll('.wl-slots button').length`);
  check(slotN > 0, `“Pick another time” offers open team times (${slotN})`);
  await shot('kickoff-pick');
  await ev_(`(document.querySelectorAll('.wl-slots button')[1] ?? document.querySelector('.wl-slots button')).click()`);
  await waitFor(async () => (await db.from('calendar_events').select('sequence').eq('id', ev.id).single()).data?.sequence === 1, 20000);
  const moved = (await db.from('calendar_events').select('starts_at, ends_at, sequence, invited_sequence').eq('id', ev.id).single()).data;
  const inv = (await db.from('outbox').select('to_email').like('dedupe_key', `invite:${ev.id}:1:%`)).data ?? [];
  const pushM = (await db.from('outbox').select('data').eq('dedupe_key', `kickoff-move:${ev.id}:1`)).data ?? [];
  check(moved.sequence === 1 && Date.parse(moved.starts_at) !== +kickStart && Date.parse(moved.ends_at) - Date.parse(moved.starts_at) === 30 * 60_000 && moved.invited_sequence === 1, `moving it changes the time, keeps 30 minutes and bumps the invite (${JSON.stringify(moved)} from ${kickStart.toISOString()}; ${new Date(moved.starts_at).toLocaleString('en-US', { timeZone: 'America/New_York' })})`);
  check(inv.length === 2 && inv.some((r) => r.to_email === ownerEmail) && pushM.length === 1 && /Kickoff moved/.test(pushM[0].data.title), 'the updated calendar invite goes to everyone on it, and the team’s phones hear about it');
  const sneaky = await ev_(`fetch('/api/kickoff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: '${t.slug}', action: 'move', start: '${new Date(Date.now() + 3 * H).toISOString()}' }) }).then((r) => r.status)`);
  check(sneaky === 409 || sneaky === 400, `a time that wasn’t offered is refused (${sneaky})`);
  const other = await ev_(`fetch('/api/kickoff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'genovus', action: 'confirm' }) }).then((r) => r.status)`);
  check(other === 403, 'the owner can’t touch another agency’s kickoff');

  // 5. the console
  await signIn(adminEmail, `/console/clients/${t.slug}`);
  await waitFor(async () => /Welcome and kickoff/.test(await text()), 30000);
  const con = await text();
  check(/Welcome and kickoff/.test(con) && /Confirmed by the client/i.test(con) && /Kickoff agenda/.test(con) && /Social and Google access/.test(con) && /Dashboard and sign-in/.test(con), 'the client page has the Welcome and kickoff panel: the confirmed kickoff and the agenda');
  check(/Verify Source GEICO Agency/.test(con) && /GEICO bundle promo/.test(con), 'it offers the same-carrier agency’s promos');
  check(!con.includes('Private cover (verify)'), 'but never an image under that agency’s private welcome link');
  await ev_(`(() => { const f = [...document.querySelectorAll('form')].find((x) => x.querySelector('input[name=due]')); f.querySelector('input[name=due]').value = '2026-11-09'; f.requestSubmit(); })()`);
  await waitFor(async () => (await db.from('invoices').select('due_date').eq('tenant_id', t.id).eq('kind', 'deposit').single()).data?.due_date === '2026-11-09', 15000);
  check((await db.from('invoices').select('due_date').eq('tenant_id', t.id).eq('kind', 'deposit').single()).data?.due_date === '2026-11-09', 'the deposit date is set from the panel');
  await ev_(`(() => { const f = [...document.querySelectorAll('form')].find((x) => x.querySelector('input[name=source][value="${src.id}"]')); f.requestSubmit(); })()`);
  await waitFor(async () => ((await db.from('assets').select('id').eq('tenant_id', t.id).eq('kind', 'image')).data ?? []).length > 0, 20000);
  const copied = (await db.from('assets').select('title, notes, audience').eq('tenant_id', t.id).eq('kind', 'image')).data ?? [];
  check(copied.length === 1 && copied[0].title === 'GEICO bundle promo (verify)' && copied[0].audience === 'client' && /copied from Verify Source GEICO Agency/.test(copied[0].notes), `the ticked promo is copied into the client’s Library; the other agency’s headshot is left out by default (${copied.map((a) => a.title).join(', ')})`);
  await ev_(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Send welcome email/.test(x.textContent)); b.click(); })()`);
  await waitFor(async () => (await outbox('client_welcome')).length >= 2, 20000);
  const wel = await outbox('client_welcome');
  check(wel.length === 2 && wel.some((r) => r.to_email === ownerEmail) && wel.some((r) => r.to_email === recordEmail) && wel[0].data.due.includes('November 9') && /\/app\/verify-welcome-.*\/welcome$/.test(wel[0].data.link) && wel[0].data.confirmed === 'true', `one tap sends the welcome to the record’s email and the owner, with the new due date and the confirmed kickoff (${wel.map((r) => r.to_email).join(', ')})`);
  const tt = (await db.from('tenants').select('checklist_link_sent_at').eq('id', t.id).single()).data;
  check(!!tt.checklist_link_sent_at, 'and the deposit won’t send a second checklist email later');
  await shot('console-panel', true);

  // 6. kickoff reminders: to the client's people only
  const start = Date.parse(moved.starts_at);
  await db.from('calendar_events').update({ updated_at: new Date(start - 3 * 24 * H).toISOString() }).eq('id', ev.id);
  const n1 = await queueKickoffReminders(db, start - 23.5 * H);
  const n2 = await queueKickoffReminders(db, start - 23.5 * H);
  const rems = (await db.from('outbox').select('to_email, data').eq('template', 'consult_reminder').like('dedupe_key', `remind:${ev.id}:%`)).data ?? [];
  check(n1 >= 1 && n2 === 0 && rems.length === 1 && rems[0].to_email === ownerEmail && rems[0].data.kind === 'kickoff' && rems[0].data.lead === '24h', `a day before, one kickoff reminder goes to the owner and not the team, once (${rems.map((r) => r.to_email).join(', ')})`);
} finally {
  ws.close(); chrome.kill();
  try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
  dev.kill();
  await db.from('outbox').delete().or(`dedupe_key.ilike.%${ev.id}%,tenant_id.in.(${made.tenants.join(',')})`);
  // Files a promo copy made under the test client (a real same-carrier library may be copied too).
  const { list: blobs, del } = await import('@vercel/blob');
  for (const id of made.tenants) { const b = await blobs({ prefix: `assets/${id}/` }).catch(() => ({ blobs: [] })); if (b.blobs.length) await del(b.blobs.map((x) => x.url)).catch(() => {}); }
  // Clients can't be deleted (the audit trail keeps them): marked samples, so they never show as a real agency.
  for (const id of made.tenants) { const r = await db.from('tenants').delete().eq('id', id); if (r.error) await db.from('tenants').update({ is_sample: true }).eq('id', id); }
  for (const id of made.users) await db.auth.admin.deleteUser(id);
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
