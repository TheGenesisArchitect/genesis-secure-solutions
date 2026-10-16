// Verify new-lead alerts and What's new on the PREVIEW database, with a local stand-in for the browser push service
// (real web push encryption, decrypted here; no real devices, no spend):
//  1. Today offers "Alert me on this device"; a device saved through /api/push belongs to that person only
//  2. a new lead queues one push for the agency; the outbox run sends it to each device: "New lead · <name>", opening
//     Today with that lead; a device the push service says is gone is removed
//  3. an alert opens Today with that lead marked; a lead already handled says so
//  4. What's new: one toast per session (newest first); Show me walks the Quick Helix Tour (opens Today, points at the
//     alerts card); Try it opens Ask Helix at the right spot; each shows once per device
// Uses the "test-launch" agency from verify-agency-dashboard.mjs; adds Helix for the run, then removes it.
//   node --env-file=.env.local scripts/verify-notify.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import ece from 'http_ece';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39562, PUSH = 39563, SLUG = 'test-launch', BASE = `/app/${SLUG}`;
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
const owner = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === email);
const REASON = 'Verify notify';
must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'clear grants');
must(await db.from('module_grants').insert(['helix', 'pipeline', 'calendar'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 86_400_000).toISOString(), reason: REASON }))), 'grants');
must(await db.from('leads').delete().eq('tenant_id', t.id).like('ext_id', 'nt-%'), 'clear nt leads');
must(await db.from('push_subscriptions').delete().eq('user_id', owner.id), 'clear subs');
must(await db.from('outbox').delete().eq('tenant_id', t.id).in('template', ['lead_push', 'lead_new']), 'clear outbox');

// The push service stand-in (HTTPS, self-signed): records each push; endpoint /gone answers 410.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-push-'));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout "${tmp}/k.pem" -out "${tmp}/c.pem" -days 1 -subj "/CN=localhost"`, { stdio: 'ignore' });
const pushes = [];
const pushSvc = https.createServer({ key: fs.readFileSync(`${tmp}/k.pem`), cert: fs.readFileSync(`${tmp}/c.pem`) }, (req, res) => {
  const chunks = []; req.on('data', (d) => chunks.push(d)); req.on('end', () => {
    pushes.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.statusCode = req.url.startsWith('/gone') ? 410 : 201; res.end();
  });
}).listen(PUSH);
// A device: its own keys, so the test can open what Genovus sent it.
const device = createECDH('prime256v1'); device.generateKeys();
const authSecret = randomBytes(16);
const sub = { endpoint: `https://localhost:${PUSH}/push/device-1`, keys: { p256dh: device.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') } };
const open = (body) => JSON.parse(ece.decrypt(body, { version: 'aes128gcm', privateKey: device, authSecret: authSecret.toString('base64url') }).toString());

const vapid = webpush.generateVAPIDKeys();
const CRON = 'verify-cron-' + Date.now();
const mock = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url.includes('auth_tokens') ? { name: 'auth_tokens/verify' } : { candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'Verify typed answer.', followUps: [], drafts: [] }) }] } }] })); }).listen(MOCK);
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '', HELIX_STANDIN: '',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:verify@genovus.io', CRON_SECRET: CRON, NODE_TLS_REJECT_UNAUTHORIZED: '0', RESEND_API_KEY: '', RESEND_GENOVOUS_API_KEY: '' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9497, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');
// The Gemini Live socket, scripted: the page's own code runs unchanged; this test plays Google's side.
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const Real = window.WebSocket;
  window.__live = { socks: [], sent: [] };
  window.WebSocket = function (url, p) {
    if (!String(url).includes('generativelanguage')) return new Real(url, p);
    const s = { url, readyState: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
      send(d) { window.__live.sent.push(JSON.parse(d)); },
      close() { s.readyState = 3; s.onclose && s.onclose({ code: 1000, reason: '' }); } };
    window.__live.socks.push(s);
    setTimeout(() => { s.readyState = 1; s.onopen && s.onopen(); }, 50);
    return s;
  };
  window.WebSocket.OPEN = 1;
  window.__live.emit = (m) => { const s = window.__live.socks.at(-1); s && s.onmessage && s.onmessage({ data: JSON.stringify(m) }); };
})();` });
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const drawer = () => ev(`(() => { const d = document.querySelector('.helix-drawer'); return d && !d.hidden ? d.innerText : null; })()`);
const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const emit = (m) => ev(`window.__live.emit(${JSON.stringify(m)})`);
const say = async (heard, said) => { if (heard) await emit({ serverContent: { inputTranscription: { text: heard } } }); if (said) await emit({ serverContent: { outputTranscription: { text: said } } }); await emit({ serverContent: { turnComplete: true } }); await sleep(800); };
let callN = 0;
const tool = async (name, args) => {
  const callId = `v${++callN}`;
  await emit({ toolCall: { functionCalls: [{ id: callId, name, args }] } });
  let out = null;
  await waitFor(async () => { out = await ev(`(() => { const r = window.__live.sent.flatMap((m) => m.toolResponse?.functionResponses ?? []).find((f) => f.id === '${callId}'); return r ? r.response.result : null; })()`); return !!out; }, 15000);
  return out ?? {};
};
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); };
const voiceMsgs = async () => { const th = (await db.from('helix_threads').select('id').eq('tenant_id', t.id)).data ?? []; return th.length ? must(await db.from('helix_messages').select('role, channel, text, page').in('thread_id', th.map((x) => x.id)).order('id'), 'msgs') : []; };

const outbox = () => fetch(`${ORIGIN}/api/cron/outbox`, { headers: { authorization: `Bearer ${CRON}` } }).then((r) => r.json());
const consent = 'I agree that Test Agency may contact me about this request.';
const newLead = async (ext, name) => must(await db.from('leads').insert({ tenant_id: t.id, ext_id: ext, name, phone: '(706) 555-0144', topic: 'Motorcycle', source: 'website', consent_text: consent, consent_at: new Date().toISOString(), status: 'new', channel: 'form' }).select('id').single(), 'lead');

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`${BASE}/today`)}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === `${BASE}/today`);
  // What's new waits for its own section below: mark everything seen for now.
  await ev(`localStorage.setItem('helix-voice', 'off'); localStorage.setItem('genovus-whats-new', JSON.stringify(['lead-alerts-2026-10-15','helix-confirm-2026-10-15','helix-ptt-2026-10-15','helix-moves-2026-10-15','helix-travels-2026-10-15']))`);
  await go(`${BASE}/today`);

  // 1. The offer, and a device saved for this person only.
  check(await waitFor(async () => /Alert me on this device/.test((await ev(`document.querySelector('.lead-alerts')?.innerText`)) ?? '')), 'Today offers “Alert me on this device”');
  const saved = await ev(`fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: ${JSON.stringify(sub)}, device: 'Verify phone' }) }).then((r) => r.status)`);
  const gone = await ev(`fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: ${JSON.stringify({ ...sub, endpoint: `https://localhost:${PUSH}/gone/device-2` })}, device: 'Old phone' }) }).then((r) => r.status)`);
  const subs = must(await db.from('push_subscriptions').select('user_id, device').eq('user_id', owner.id), 'subs');
  check(saved === 200 && gone === 200 && subs.length === 2 && subs.every((s) => s.user_id === owner.id), 'the device is saved for this person');
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  check(((await anon.from('push_subscriptions').select('id')).data ?? []).length === 0, 'nobody else can read it');

  // 2. A new lead → one push → the device; the gone device is removed.
  const lead = await newLead('nt-1', 'Marco Alert');
  const queued = must(await db.from('outbox').select('id, template, to_email').eq('tenant_id', t.id).eq('template', 'lead_push'), 'queued');
  check(queued.length === 1, `a new lead queues one push for the agency (${queued.length})`);
  const run = await outbox();
  check(await waitFor(async () => pushes.filter((p) => p.path === '/push/device-1').length === 1, 15000), `the outbox run sends it to the device (${JSON.stringify(run)})`);
  const got = pushes.find((p) => p.path === '/push/device-1');
  let msg = {};
  try { msg = open(got.body); } catch (e) { console.log('decrypt failed', e.message); }
  check(msg.title === 'New lead · Marco Alert' && /Motorcycle/.test(msg.body ?? '') && msg.url === `${BASE}/today?lead=${lead.id}`, `the alert reads “${msg.title}: ${msg.body}” and opens Today with that lead`);
  check(/vapid/i.test(got.headers.authorization ?? '') && got.headers.urgency === 'high' && Number(got.headers.ttl) > 0, 'it is signed for Genovus and marked urgent');
  check(!(await db.from('push_subscriptions').select('id').eq('user_id', owner.id).eq('device', 'Old phone')).data?.length, 'the device the push service says is gone is removed');
  const row = must(await db.from('outbox').select('status').eq('id', queued[0].id).single(), 'row');
  check(row.status === 'sent', 'the push is marked sent');
  check(((await db.from('audit_events').select('id').eq('tenant_id', t.id).eq('action', 'push.sent').gte('at', new Date(Date.now() - 600_000).toISOString())).data ?? []).length >= 1, 'and recorded in the audit log');
  await outbox();
  check(pushes.filter((p) => p.path === '/push/device-1').length === 1, 'it goes out once');

  // 3. Opening the alert.
  await go(`${BASE}/today?lead=${lead.id}`);
  check(await waitFor(async () => await ev(`document.querySelector('[data-lead-id="${lead.id}"]')?.classList.contains('lead-focus') ?? false`), 8000), 'the alert opens Today with that lead marked, Call button beside it');
  await send('Page.captureScreenshot', { format: 'png' }).then((s) => fs.writeFileSync(path.join(OUT, 'notify-today.png'), Buffer.from(s.result.data, 'base64')));
  must(await db.from('leads').update({ status: 'contacted' }).eq('id', lead.id), 'handled');
  await go(`${BASE}/today?lead=${lead.id}`);
  check(await waitFor(async () => /isn’t waiting any more/.test(await ev('document.body.innerText'))), 'a lead someone already handled says so');

  // 4. What's new.
  await ev(`localStorage.removeItem('genovus-whats-new'); sessionStorage.clear()`);
  await go(`${BASE}/leads`);
  check(await waitFor(async () => /New-lead alerts on your phone/.test((await ev(`document.querySelector('.whats-new')?.innerText`)) ?? ''), 8000), 'What’s new shows the newest upgrade');
  await send('Page.captureScreenshot', { format: 'png' }).then((s) => fs.writeFileSync(path.join(OUT, 'notify-whats-new.png'), Buffer.from(s.result.data, 'base64')));
  await ev(`[...document.querySelectorAll('.whats-new button')].find((b) => /Show me/.test(b.textContent))?.click()`);
  check(await waitFor(async () => (await ev('location.pathname')) === `${BASE}/today` && /Turn alerts on for this device/.test((await ev(`document.querySelector('.qt-card')?.innerText`)) ?? '') && !!(await ev(`!!document.querySelector('.hx-spot.tour')`)), 8000), 'Show me opens Today and points at the alerts card (Quick Helix Tour, step 1)');
  await send('Page.captureScreenshot', { format: 'png' }).then((s) => fs.writeFileSync(path.join(OUT, 'notify-tour.png'), Buffer.from(s.result.data, 'base64')));
  await ev(`[...document.querySelectorAll('.qt-card button')].find((b) => /Next/.test(b.textContent))?.click()`);
  check(await waitFor(async () => /2 of 2/i.test((await ev(`document.querySelector('.qt-card')?.innerText`)) ?? '')), 'Next goes to step 2');
  await ev(`[...document.querySelectorAll('.qt-card button')].find((b) => /Got it/.test(b.textContent))?.click()`); await sleep(400);
  check(!(await ev(`!!document.querySelector('.qt-card, .whats-new')`)) && /lead-alerts-2026-10-15/.test((await ev(`localStorage.getItem('genovus-whats-new')`)) ?? ''), 'Got it closes it, and it’s seen on this device');
  await go(`${BASE}/leads`); await sleep(3500);
  check(!(await ev(`!!document.querySelector('.whats-new')`)), 'one per session: nothing more this session');
  await ev(`sessionStorage.clear()`);
  await go(`${BASE}/leads`);
  check(await waitFor(async () => /Helix updates leads, with your yes/.test((await ev(`document.querySelector('.whats-new')?.innerText`)) ?? ''), 8000), 'next session: the next upgrade');
  await ev(`[...document.querySelectorAll('.whats-new button')].find((b) => /Try it/.test(b.textContent))?.click()`);
  check(await waitFor(async () => !!(await ev(`(() => { const d = document.querySelector('.helix-drawer'); return d && !d.hidden; })()`)) && /mark <a lead’s name> called/.test((await ev(`document.querySelector('.qt-card')?.innerText`)) ?? '')), 'Try it opens Ask Helix and points at where to type, with an example');

  // 5. Every update stays on the What's new page, replayable.
  await go(`${BASE}/whats-new`);
  const arch = (await ev(`document.querySelector('.whats-new-list')?.innerText`)) ?? '';
  check(['New-lead alerts on your phone', 'Helix updates leads, with your yes', 'Push-to-talk and hands-free', 'Helix takes you there', 'Helix remembers the conversation'].every((x) => arch.includes(x)), 'the What’s new page lists every update');
  const badges = await ev(`[...document.querySelectorAll('.whats-new-item')].map((li) => li.querySelector('b').textContent + '=' + li.querySelector('.chip').textContent)`);
  check(badges.includes('New-lead alerts on your phone=Seen') && badges.includes('Helix updates leads, with your yes=Seen') && badges.includes('Push-to-talk and hands-free=New'), `with the ones already seen marked Seen and the rest New (${badges.join('; ')})`);
  check(!!(await ev(`[...document.querySelectorAll('.rail a')].some((a) => a.getAttribute('href') === '${BASE}/whats-new')`)), 'and it’s in the menu (so Ctrl+K and Helix can open it)');
  await ev(`[...document.querySelectorAll('.whats-new-item')].find((li) => /Helix takes you there/.test(li.innerText))?.querySelector('button')?.click()`);
  check(await waitFor(async () => /Tap Talk, then say where to go/.test((await ev(`document.querySelector('.qt-card')?.innerText`)) ?? '')), 'Show me replays that update’s Quick Helix Tour from the archive');
  await send('Page.captureScreenshot', { format: 'png' }).then((s) => fs.writeFileSync(path.join(OUT, 'notify-archive.png'), Buffer.from(s.result.data, 'base64')));
} finally {
  must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'remove grants');
  must(await db.from('leads').delete().eq('tenant_id', t.id).like('ext_id', 'nt-%'), 'remove nt leads');
  must(await db.from('push_subscriptions').delete().eq('user_id', owner.id), 'remove subs');
  await db.from('outbox').delete().eq('tenant_id', t.id).in('template', ['lead_push', 'lead_new']);
  await db.from('helix_threads').delete().eq('tenant_id', t.id);
  ws.close(); chrome.kill(); mock.close(); pushSvc.close();
  try { execSync(process.platform === 'win32' ? `taskkill /PID ${dev.pid} /T /F` : `kill ${dev.pid}`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
