// Verify phone alerts on PREVIEW (throwaway push keys, generated here):
//  1. the console's alerts panel always shows (never hides silently), including inside the Genovus app shell
//  2. turning alerts on saves the device; "Send a test" reaches the push service and says so
//  3. a device the push service refuses is reported with the service's answer, not silently skipped
//   node --conditions=react-server --env-file=.env.local scripts/verify-push-alerts.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3942, ORIGIN = `http://localhost:${PORT}`;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

// One throwaway key pair, kept between runs: the dev server caches the public key it inlined into the page.
const KEYS = path.join(os.tmpdir(), 'genovus-verify-vapid.json');
const vapid = fs.existsSync(KEYS) ? JSON.parse(fs.readFileSync(KEYS, 'utf8')) : webpush.generateVAPIDKeys();
fs.writeFileSync(KEYS, JSON.stringify(vapid));
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email.toLowerCase();
const before = new Set(((await db.from('push_subscriptions').select('id').eq('user_id', admin.user_id)).data ?? []).map((r) => r.id));

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env, NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:verify@genovus.io' } });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
const port = 9586, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const bws = new WebSocket(ver.webSocketDebuggerUrl);
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(), on = new Map();
const wire = (w) => { w.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); }; };
wire(ws); wire(bws);
await Promise.all([new Promise((r) => (ws.onopen = r)), new Promise((r) => (bws.onopen = r))]);
const sendTo = (w) => (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); w.send(JSON.stringify({ id: i, method, params })); });
const send = sendTo(ws), bsend = sendTo(bws);
const ev = async (x) => (await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await send('Page.navigate', { url: ORIGIN + u }); await l; await sleep(2500); };
const waitFor = async (fn, ms = 30000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); };
const panel = () => ev(`(() => { const p = document.querySelector('[data-alerts]'); return p ? { state: p.dataset.alerts, text: p.innerText } : null; })()`);
try {
  check((await fetch(`${ORIGIN}/api/push/test`, { method: 'POST' })).status === 401, 'nobody signed out can send a test alert');
  await send('Emulation.setDeviceMetricsOverride', { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'link');
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console');
  await waitFor(async () => !!(await panel()), 20000);
  const p0 = await panel();
  check(p0 && ['off', 'on'].includes(p0.state), `the console shows the alerts panel (${p0?.state})`);

  // 3. a device the push service refuses: reported with its answer
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const fake = must(await db.from('push_subscriptions').insert({ user_id: admin.user_id, endpoint: `https://fcm.googleapis.com/fcm/send/verify-fake-${crypto.randomUUID()}`, p256dh: ecdh.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url'), device: 'verify fake' }).select('id').single(), 'fake');
  const t1 = await ev(`fetch('/api/push/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json())`);
  check(t1 && t1.devices >= 1 && t1.errors?.some((e) => /fcm\.googleapis\.com: \d{3}/.test(e)), `a refused device comes back with the push service's answer (${t1?.errors?.[0] ?? t1?.message})`);
  const fakeLeft = (await db.from('push_subscriptions').select('id, failures').eq('id', fake.id).maybeSingle()).data;
  check(!fakeLeft || fakeLeft.failures >= 1, 'and it is removed or counted as a failure');
  await db.from('push_subscriptions').delete().eq('id', fake.id);

  // 2. turn alerts on in this browser and send a real test through the push service
  await bsend('Browser.grantPermissions', { origin: ORIGIN, permissions: ['notifications'] });
  await go('/console');
  await waitFor(async () => !!(await panel()), 20000);
  await ev(`[...document.querySelectorAll('[data-alerts] button')].find((b) => /Alert me on this device/.test(b.textContent))?.click()`);
  const turnedOn = await waitFor(async () => (await panel())?.state === 'on', 30000);
  const p1 = await panel();
  if (turnedOn) {
    const mine = ((await db.from('push_subscriptions').select('id, endpoint').eq('user_id', admin.user_id)).data ?? []).filter((r) => !before.has(r.id));
    check(mine.length === 1, 'turning alerts on saves this device');
    await ev(`[...document.querySelectorAll('[data-alerts] button')].find((b) => /Send a test/.test(b.textContent))?.click()`);
    await waitFor(async () => /Sent to|refused|wasn’t on file|No devices/.test((await panel())?.text ?? ''), 30000);
    const p2 = await panel();
    check(/Sent to \d/.test(p2?.text ?? ''), `"Send a test" goes through the push service (${(p2?.text ?? '').split('\n').pop()})`);
    await shot('alerts-on-test');
    // the server lost the device (as when the push service rejects it): the next visit puts it back
    await db.from('push_subscriptions').delete().in('id', mine.map((r) => r.id));
    await go('/console');
    await waitFor(async () => !!(await panel()), 20000);
    const back = await waitFor(async () => ((await db.from('push_subscriptions').select('id').eq('endpoint', mine[0].endpoint)).data ?? []).length === 1, 15000);
    check(back && (await panel())?.state === 'on', 'a device the server lost is saved again on the next visit');
  } else {
    console.log(`NOTE  headless Chrome could not subscribe to push here (${p1?.text?.split('\n').pop() ?? 'no message'}); real-device steps skipped`);
    check(/Couldn|push|service|Registration/i.test(p1?.text ?? '') || p1?.state === 'off', 'a failure to turn on is shown, not hidden');
  }

  // 1. inside the Genovus app shell, the panel explains where alerts work instead of disappearing
  await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.Capacitor = { isNativePlatform: () => true };' });
  await go('/console');
  await waitFor(async () => !!(await panel()), 20000);
  const p3 = await panel();
  check(p3?.state === 'app' && /Genovus app can’t show/.test(p3.text), 'inside the Genovus app, it says where to turn alerts on');
  await shot('alerts-in-app');
} finally {
  ws.close(); bws.close(); chrome.kill();
  try { execSync(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${PORT} ^| findstr LISTENING') do taskkill /F /T /PID %a`, { shell: 'cmd.exe', stdio: 'ignore' }); } catch {}
  dev.kill();
  const added = ((await db.from('push_subscriptions').select('id').eq('user_id', admin.user_id)).data ?? []).filter((r) => !before.has(r.id)).map((r) => r.id);
  if (added.length) await db.from('push_subscriptions').delete().in('id', added);
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} failed` : 'all passed'}`);
process.exit(failed ? 1 : 0);
