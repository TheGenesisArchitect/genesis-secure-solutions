// Verify that Helix travels with you, on the PREVIEW database with a Gemini stand-in (no real AI calls, no spend):
//  1. ask on Leads, move to Pipeline by the menu (client navigation): the drawer stays open with the same thread
//  2. the next question carries the earlier turns, and the thread shows "→ Pipeline" where it moved
//  3. minimize to the pill (Helix's last line), keep working on Calendar, reopen: nothing lost
//  4. an "Ask Helix" button on a page adds to the thread instead of resetting it; Esc minimizes
//  5. the full Ask Helix page shows the same thread
//  6. saved to the account (0066): a reload picks up where they left off, Helix reads the saved turns (not the
//     browser's), and the saved-conversation notice shows
//  7. who can read it: the person and their agency owner can, another office member can't, and a member can't add
//     to someone else's thread
// Uses the "test-launch" agency from verify-agency-dashboard.mjs (run that first); adds Helix for the run, then removes it.
//   node --env-file=.env.local scripts/verify-helix-threads.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39558, SLUG = 'test-launch', BASE = `/app/${SLUG}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const t = must(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) throw new Error(`${SLUG} is missing: run verify-agency-dashboard.mjs first`);
const email = `owner@${SLUG}.example`;
const REASON = 'Verify Helix threads';
must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'clear grants');
must(await db.from('module_grants').insert(['helix', 'pipeline', 'calendar'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 86_400_000).toISOString(), reason: REASON }))), 'grants');
must(await db.from('helix_threads').delete().eq('tenant_id', t.id), 'clear threads');
const owner = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email);
// A second person in the office (not the owner), for who-can-read checks.
const MEMBER = `member@${SLUG}.example`;
let member = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === MEMBER);
if (!member) member = must(await db.auth.admin.createUser({ email: MEMBER, email_confirm: true }), 'member').user;
must(await db.from('memberships').upsert({ tenant_id: t.id, user_id: member.id, role: 'staff' }, { onConflict: 'tenant_id,user_id' }), 'member membership');
/** A database client signed in as this person (their own session, so row-level security applies). */
const as = async (who) => {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const l = must(await db.auth.admin.generateLink({ type: 'magiclink', email: who }), 'link');
  must(await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' }), 'session');
  return c;
};

// Gemini stand-in: numbers its replies and says how many earlier turns it was given.
const asks = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    if (!j.systemInstruction) { res.end('{}'); return; }
    asks.push(j.contents ?? []);
    const reply = { answer: `Verify reply ${asks.length} (saw ${(j.contents ?? []).length - 1} earlier turns).`, followUps: [], drafts: [] };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
  });
}).listen(MOCK);

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9493, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const text = () => ev('document.body.innerText');
const drawer = () => ev(`(() => { const d = document.querySelector('.helix-drawer'); return d && !d.hidden ? d.innerText : null; })()`);
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const shot = async (name, w, h, mobile) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(600);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64'));
};
// Client-side navigation through the menu, the way an agent moves around (no page load).
const navTo = async (p) => {
  const ok = await ev(`(() => { const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '${BASE}${p}'); a && a.click(); return !!a; })()`);
  await waitFor(async () => (await ev('location.pathname')) === `${BASE}${p}`, 20000);
  await sleep(800);
  return ok;
};
const click = (sel, re) => ev(`(() => { const b = [...document.querySelectorAll('${sel}')].find((x) => ${re}.test(x.textContent + ' ' + (x.getAttribute('aria-label') || ''))); b && b.click(); return !!b; })()`);

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`${BASE}/leads`)}`);
  await click('button', /Continue/);
  await waitFor(async () => (await ev('location.pathname')) === `${BASE}/leads`, 20000);
  await ev(`localStorage.setItem('helix-voice', 'off')`); // no microphone in this run
  await go(`${BASE}/leads`);

  // 1. Ask on Leads, then move to Pipeline through the menu.
  await ev(`document.querySelector('.helix-fab')?.click()`); await sleep(800);
  await click('.helix-drawer button', /Who should I call first/);
  check(await waitFor(async () => /Verify reply 1/.test((await drawer()) ?? '')), 'Helix answers on Leads');
  check(await navTo('/pipeline'), 'the menu moves to Pipeline without a page load');
  const d1 = (await drawer()) ?? '';
  check(/Verify reply 1/.test(d1) && /on Pipeline/.test(d1), 'on Pipeline the drawer is still open with the same conversation, and knows the page');

  // 2. The next question carries the thread, and the thread marks where it moved.
  await click('.helix-drawer button', /consults are coming up/);
  check(await waitFor(async () => /Verify reply 2/.test((await drawer()) ?? '')), 'Helix answers on Pipeline');
  check((asks.at(-1) ?? []).length >= 3, `the Pipeline question carried the Leads turns (${(asks.at(-1) ?? []).length - 1} earlier turns sent)`);
  check(/→ Pipeline/.test((await drawer()) ?? ''), 'the thread shows "→ Pipeline" where it moved');
  await shot('threads-drawer-pipeline', 1440, 900, false);

  // 3. Minimize, keep working, reopen.
  await click('.helix-drawer button', /Minimize/);
  await sleep(400);
  check((await drawer()) === null && /Verify reply 2/.test((await ev(`document.querySelector('.helix-pill')?.innerText`)) ?? ''), 'minimize shows the pill with Helix’s last line');
  check(await navTo('/calendar'), 'the menu moves to Calendar while Helix is minimized');
  check(!!(await ev(`!!document.querySelector('.helix-pill')`)), 'the pill stays on Calendar');
  await shot('threads-pill-calendar', 1440, 900, false);
  await ev(`document.querySelector('.helix-pill')?.click()`); await sleep(500);
  const d2 = (await drawer()) ?? '';
  check(/Verify reply 1/.test(d2) && /Verify reply 2/.test(d2) && /on Calendar/.test(d2), 'reopened on Calendar: the whole conversation is still there');

  // 4. An "Ask Helix" button adds to the thread; Esc minimizes.
  await ev(`window.dispatchEvent(new CustomEvent('genovus:helix', { detail: { question: 'What about Dana Ruiz?', context: 'lead Dana Ruiz' } }))`);
  check(await waitFor(async () => /Verify reply 3/.test((await drawer()) ?? '')), 'an Ask Helix button asks in the same drawer');
  const d3 = (await drawer()) ?? '';
  check(/Verify reply 1/.test(d3) && /What about Dana Ruiz/.test(d3), 'the button added to the thread instead of resetting it');
  check(/lead Dana Ruiz/.test(JSON.stringify(asks.at(-1))), 'the button’s item reached Helix as context');
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(300);
  check((await drawer()) === null && !!(await ev(`!!document.querySelector('.helix-pill')`)), 'Esc minimizes (the conversation keeps going)');

  // 5. The full Ask Helix page shows the same thread.
  check(await navTo('/helix'), 'the menu opens the full Ask Helix page');
  const full = await text();
  check(/Verify reply 1/.test(full) && /Verify reply 3/.test(full) && !(await ev(`!!document.querySelector('.helix-pill, .helix-fab')`)), 'the full page shows the same thread (and no second Helix button)');
  check(await navTo('/leads'), 'back to Leads');
  await ev(`document.querySelector('.helix-pill, .helix-fab')?.click()`); await sleep(500);
  await shot('threads-drawer-phone', 390, 844, true);
  check(/Verify reply 3/.test((await drawer()) ?? ''), 'on a phone-sized screen the drawer still has the thread');
  check(/Visible to you, your agency owner and the Genovus support team/.test((await drawer()) ?? ''), 'the drawer says the conversation is saved and who can see it');

  // 6. Saved to the account: a reload (new page, nothing in memory) picks up where they left off.
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const threads = must(await db.from('helix_threads').select('id, user_id, surface, title, last_page').eq('tenant_id', t.id), 'threads');
  const msgs = threads[0] ? must(await db.from('helix_messages').select('role, page, context').eq('thread_id', threads[0].id).order('id'), 'messages') : [];
  check(threads.length === 1 && threads[0].user_id === owner.id && threads[0].surface === 'agency' && /Who should I call first/.test(threads[0].title ?? ''), 'one saved thread for the owner, titled by the first question');
  check(msgs.length === 6 && msgs.filter((m) => m.role === 'user').map((m) => m.page).join(',') === 'Leads,Pipeline,Calendar' && msgs.some((m) => m.context === 'lead Dana Ruiz'), `six turns saved with the page each was asked on and the button's item (${msgs.length})`);
  await go(`${BASE}/pipeline`);
  await ev(`document.querySelector('.helix-fab')?.click()`);
  check(await waitFor(async () => /Verify reply 3/.test((await drawer()) ?? '')), 'after a reload the drawer restores the conversation');
  check(/Picked up where you left off/.test((await drawer()) ?? ''), 'and says it picked up where they left off');
  await click('.helix-drawer button', /Who’s stalling/);
  check(await waitFor(async () => /Verify reply 4/.test((await drawer()) ?? '')), 'Helix answers after the reload');
  check((asks.at(-1) ?? []).length - 1 >= 6, `Helix read the saved turns from the server (${(asks.at(-1) ?? []).length - 1} earlier turns)`);
  check((await db.from('helix_threads').select('id').eq('tenant_id', t.id)).data?.length === 1, 'the reload continued the same thread (no second one)');
  await shot('threads-restored', 1440, 900, false);

  // 7. Who can read it.
  const ownerDb = await as(email), memberDb = await as(MEMBER);
  check(((await ownerDb.from('helix_threads').select('id').eq('tenant_id', t.id)).data ?? []).length === 1, 'the owner reads their own thread');
  check(((await memberDb.from('helix_threads').select('id').eq('tenant_id', t.id)).data ?? []).length === 0 && ((await memberDb.from('helix_messages').select('id').eq('thread_id', threads[0].id)).data ?? []).length === 0, 'another office member can’t read the owner’s thread or its messages');
  const theirs = await memberDb.rpc('helix_append', { p_thread: threads[0].id, p_tenant: t.id, p_surface: 'agency', p_page: 'Leads', p_turns: [{ role: 'user', text: 'Verify member question' }] });
  check(!theirs.error && theirs.data !== threads[0].id, 'a member naming the owner’s thread gets their own thread instead');
  check(((await ownerDb.from('helix_threads').select('id, user_id').eq('tenant_id', t.id)).data ?? []).length === 2, 'the owner can read the member’s thread too (owner oversight)');
  const outsider = await memberDb.rpc('helix_append', { p_thread: null, p_tenant: owner.id, p_surface: 'agency', p_page: '', p_turns: [{ role: 'user', text: 'x' }] });
  check(!!outsider.error, 'nobody can save into an agency they don’t belong to');
  const ent = await memberDb.rpc('helix_append', { p_thread: null, p_tenant: t.id, p_surface: 'enterprise', p_page: '', p_turns: [{ role: 'user', text: 'x' }] });
  check(!!ent.error, 'an agency member can’t save an Enterprise thread');
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  check(((await anon.from('helix_messages').select('id').limit(1)).data ?? []).length === 0, 'signed out, nothing is readable');
} finally {
  must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'remove grants');
  must(await db.from('helix_threads').delete().eq('tenant_id', t.id), 'remove threads');
  must(await db.from('memberships').delete().eq('tenant_id', t.id).eq('user_id', member.id), 'remove member');
  ws.close(); chrome.kill(); mock.close();
  // The dev server runs under a shell: end the whole tree so it doesn't hold the port after the run.
  try { execSync(process.platform === 'win32' ? `taskkill /PID ${dev.pid} /T /F` : `kill ${dev.pid}`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
