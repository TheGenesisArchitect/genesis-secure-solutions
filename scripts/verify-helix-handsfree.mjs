// Verify Step 8b on the PREVIEW database, with stand-ins for Google's token service and the Gemini Live socket and
// Chrome's fake microphone (no real voice, no spend):
//  1. a new lead nobody has called shows one nudge beside Ask Helix; it opens Today; dismissed, it stays gone
//  2. "Pick up where you left off" shows for a conversation from earlier, once per tab, and opens Helix
//  3. push-to-talk: the microphone sends nothing until Space is held; letting go closes it and tells Helix the person
//     finished; switching away from the window closes it too
//  4. hands-free: at the session cap, a person who spoke recently carries on in a fresh session with no wrap-up
//     line; with hands-free off, Helix wraps up and stops
// Uses the "test-launch" agency from verify-agency-dashboard.mjs; adds Helix for the run, then removes it.
//   node --env-file=.env.local scripts/verify-helix-handsfree.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39561, SLUG = 'test-launch', BASE = `/app/${SLUG}`;
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
const REASON = 'Verify Helix hands-free';
must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'clear grants');
must(await db.from('module_grants').insert(['helix', 'pipeline', 'calendar'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 86_400_000).toISOString(), reason: REASON }))), 'grants');
must(await db.from('helix_threads').delete().eq('tenant_id', t.id), 'clear threads');
must(await db.from('leads').delete().eq('tenant_id', t.id).like('ext_id', 'hf-%'), 'clear hf leads');
// Other new leads from the last day would compete for the nudge: park them for the run (put back at the end).
const parked = must(await db.from('leads').select('id').eq('tenant_id', t.id).eq('status', 'new').gte('created_at', new Date(Date.now() - 86_400_000).toISOString()), 'park');
if (parked.length) must(await db.from('leads').update({ status: 'contacted' }).in('id', parked.map((l) => l.id)), 'park leads');
const consent = 'I agree that Test Agency may contact me about this request.';
const fresh = must(await db.from('leads').insert({ tenant_id: t.id, ext_id: 'hf-1', name: 'Nadia Fresh', phone: '(706) 555-0123', topic: 'Boat', source: 'website', consent_text: consent, consent_at: new Date().toISOString(), status: 'new', channel: 'form' }).select('id').single(), 'fresh lead');
// A conversation from an hour ago, to pick up.
const old = new Date(Date.now() - 3600_000).toISOString();
const th = must(await db.from('helix_threads').insert({ tenant_id: t.id, user_id: owner.id, surface: 'agency', title: 'Who should I call first?', last_page: 'Pipeline', last_at: old }).select('id').single(), 'thread');
must(await db.from('helix_messages').insert([{ thread_id: th.id, tenant_id: t.id, role: 'user', text: 'Who should I call first?', page: 'Pipeline' }, { thread_id: th.id, tenant_id: t.id, role: 'helix', text: 'Start with Dana Ruiz.', page: 'Pipeline' }]), 'messages');
must(await db.from('helix_threads').update({ last_at: old }).eq('id', th.id), 'age thread');

const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('auth_tokens')) return res.end(JSON.stringify({ name: 'auth_tokens/verify' }));
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'Verify typed answer.', followUps: [], drafts: [] }) }] } }] }));
  });
}).listen(MOCK);

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '', HELIX_STANDIN: '' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9496, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
// Chrome's fake microphone (a steady tone) and no permission prompt, so push-to-talk has real audio to gate.
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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

// A short session cap for the hands-free check (the page's own session answer, shortened to 40 seconds).
await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
  const real = window.fetch;
  window.fetch = async (u, o) => {
    const r = await real(u, o);
    if (String(u).includes('/api/helix/session') && (o?.method ?? 'GET') === 'POST' && window.__shortCap) {
      const j = await r.clone().json(); j.maxSeconds = 40; return new Response(JSON.stringify(j), { status: r.status, headers: { 'content-type': 'application/json' } });
    }
    return r;
  };
})();` });
const bubble = () => ev(`document.querySelector('.helix-nudge')?.innerText ?? null`);
const frames = () => ev(`window.__live.sent.filter((m) => m.realtimeInput?.audio).length`);
const ended = () => ev(`window.__live.sent.filter((m) => m.realtimeInput?.audioStreamEnd).length`);
const key = async (type) => send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: type === 'keyDown' ? ' ' : undefined });

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`${BASE}/leads`)}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === `${BASE}/leads`);
  await ev(`localStorage.setItem('helix-voice', 'off'); localStorage.removeItem('helix-nudged'); sessionStorage.removeItem('helix-resumed')`);
  await go(`${BASE}/leads`);

  // 1. The nudge.
  check(await waitFor(async () => /New lead · call now\?/.test((await bubble()) ?? '') && /Nadia Fresh/.test((await bubble()) ?? '')), 'a new uncalled lead shows one nudge beside Ask Helix');
  await send('Page.captureScreenshot', { format: 'png' }).then((s) => fs.writeFileSync(path.join(OUT, 'hf-nudge.png'), Buffer.from(s.result.data, 'base64')));
  await ev(`document.querySelector('.helix-nudge-main')?.click()`);
  check(await waitFor(async () => (await ev('location.pathname')) === `${BASE}/today`), 'tapping it opens Today (Call now)');
  await go(`${BASE}/leads`);
  await sleep(1500);
  check(!/Nadia Fresh/.test((await bubble()) ?? ''), 'once seen, that lead’s nudge stays gone on this device');

  // 2. Pick up where you left off (the nudge is gone, so it's the one message now).
  check(await waitFor(async () => /Pick up where you left off/.test((await bubble()) ?? '') && /Who should I call first\?/.test((await bubble()) ?? '')), 'a conversation from an hour ago offers “Pick up where you left off”');
  await ev(`document.querySelector('.helix-nudge-main')?.click()`); await sleep(600);
  check(/Start with Dana Ruiz/.test((await drawer()) ?? ''), 'tapping it opens Helix with that conversation');
  await go(`${BASE}/pipeline`); await sleep(1500);
  check((await bubble()) === null, 'it shows once per tab (not again after a reload)');

  // 3. Push-to-talk.
  await ev(`localStorage.setItem('helix-voice', 'on'); localStorage.setItem('helix-ptt', '1'); localStorage.setItem('helix-hands', '0')`);
  await go(`${BASE}/leads`);
  await ev(`document.querySelector('.helix-fab')?.click()`);
  await waitFor(async () => (await ev('window.__live.socks.length')) === 1);
  await emit({ setupComplete: {} });
  await sleep(1500);
  check(/Push-to-talk/.test((await drawer()) ?? '') && /Hold to talk/.test((await drawer()) ?? ''), 'push-to-talk shows a Hold to talk button');
  check((await frames()) === 0, 'with push-to-talk on, the microphone sends nothing until Space is held');
  await ev(`document.activeElement && document.activeElement.blur()`);
  await key('keyDown'); await sleep(1500);
  const held = await frames();
  check(held > 0, `holding Space sends the microphone (${held} audio frames)`);
  await key('keyUp'); await sleep(400);
  const afterUp = await frames(); await sleep(1200);
  check((await ended()) === 1 && (await frames()) === afterUp, 'letting go stops the microphone and tells Helix the person finished');
  await key('keyDown'); await sleep(800);
  await ev(`window.dispatchEvent(new Event('blur'))`); await sleep(300);
  const afterBlur = await frames(); await sleep(1200);
  check((await ended()) === 2 && (await frames()) === afterBlur, 'switching away from the window while holding closes the microphone');
  await key('keyUp');
  await ev(`(() => { const i = document.querySelector('.helix-drawer input[aria-label="Ask Helix"]'); i.focus(); })()`);
  const typedBefore = await frames();
  await key('keyDown'); await sleep(800); await key('keyUp');
  check((await frames()) === typedBefore, 'Space while typing in a box types a space; it doesn’t open the microphone');

  // 4. Hands-free at the session cap (cap shortened to 40 s for the test).
  await ev(`localStorage.setItem('helix-ptt', '0'); localStorage.setItem('helix-hands', '1'); window.__shortCap = true`);
  await go(`${BASE}/leads`);
  await ev(`window.__shortCap = true`);
  await ev(`document.querySelector('.helix-fab')?.click()`);
  await waitFor(async () => (await ev('window.__live.socks.length')) === 1);
  await emit({ setupComplete: {} });
  await emit({ serverContent: { inputTranscription: { text: 'Keep going with me' } } });
  await emit({ serverContent: { turnComplete: true } });
  check(await waitFor(async () => (await ev('window.__live.socks.length')) === 2, 60000), 'hands-free: at the cap, a person who spoke recently carries on in a fresh session');
  check(!(await ev(`window.__live.sent.some((m) => /Wrap up warmly/.test(m.realtimeInput?.text ?? ''))`)), 'with no wrap-up line in the middle of the work');
  await ev(`localStorage.setItem('helix-hands', '0')`);
  await go(`${BASE}/leads`);
  await ev(`window.__shortCap = true`);
  await ev(`document.querySelector('.helix-fab')?.click()`);
  await waitFor(async () => (await ev('window.__live.socks.length')) === 1);
  await emit({ setupComplete: {} });
  check(await waitFor(async () => await ev(`window.__live.sent.some((m) => /Wrap up warmly/.test(m.realtimeInput?.text ?? ''))`), 30000), 'hands-free off: Helix wraps up before the cap');
  check(await waitFor(async () => /Tap Talk to start again/.test((await drawer()) ?? ''), 30000) && (await ev('window.__live.socks.length')) === 1, 'and stops at the cap (no new session)');
} finally {
  must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'remove grants');
  must(await db.from('helix_threads').delete().eq('tenant_id', t.id), 'remove threads');
  must(await db.from('leads').delete().eq('tenant_id', t.id).like('ext_id', 'hf-%'), 'remove hf leads');
  if (parked.length) must(await db.from('leads').update({ status: 'new' }).in('id', parked.map((l) => l.id)), 'restore parked leads');
  await db.from('outbox').delete().eq('tenant_id', t.id).eq('template', 'lead_new');
  await db.from('helix_tour_sessions').delete().eq('tenant_id', t.id);
  ws.close(); chrome.kill(); mock.close();
  try { execSync(process.platform === 'win32' ? `taskkill /PID ${dev.pid} /T /F` : `kill ${dev.pid}`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
