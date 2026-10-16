// Verify Steps 3 and 7 on the PREVIEW database, with stand-ins for Google's token service and the Gemini Live socket
// (no real voice, no spend): the browser's voice socket is replaced by a scripted one this test drives.
//  1. voice Ask Helix gets the person's own pages and the moving-around rules (no full Ask Helix page, nothing they
//     can't open)
//  2. Helix's spoken greeting is not saved; a spoken exchange is saved to the thread (voice) and shows as Spoken
//  3. go_to opens a page and the same voice session carries on (one session, the drawer still listening)
//  4. open_lead finds a lead on the page and points at it (Ask Helix minimizes so the page shows); highlight points;
//     a page that isn't theirs is refused
//  5. typed Helix opens a page when asked ("go"), and Ctrl+K sends anything typed to Ask Helix
//  6. after a reload the spoken turns come back, and a new voice session starts with the conversation so far
//  7. two saves at once for someone with no thread continue one thread (0067)
// Uses the "test-launch" agency from verify-agency-dashboard.mjs; adds Helix for the run, then removes it.
//   node --env-file=.env.local scripts/verify-helix-voice-nav.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39559, SLUG = 'test-launch', BASE = `/app/${SLUG}`;
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
const REASON = 'Verify Helix voice nav';
must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'clear grants');
must(await db.from('module_grants').insert(['helix', 'pipeline', 'calendar'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 86_400_000).toISOString(), reason: REASON }))), 'grants');
must(await db.from('helix_threads').delete().eq('tenant_id', t.id), 'clear threads');
const leads = must(await db.from('leads').select('name, status').eq('tenant_id', t.id), 'leads');
const booked = leads.find((l) => l.status === 'booked')?.name ?? 'Dana Ruiz';

// Google stand-in: the token service records each voice setup; generateContent answers typed Helix.
const setups = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('auth_tokens')) { setups.push(j.bidiGenerateContentSetup ?? null); return res.end(JSON.stringify({ name: 'auth_tokens/verify' })); }
    const asked = JSON.stringify(j.contents?.at(-1) ?? '');
    const reply = /Take me to my calendar/.test(asked) ? { answer: 'Opening your Calendar.', go: 'Calendar', followUps: [], drafts: [] } : { answer: 'Verify typed answer.', followUps: [], drafts: [] };
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
  });
}).listen(MOCK);
const sys = (s) => s?.systemInstruction?.parts?.[0]?.text ?? '';
const toolNames = (s) => (s?.tools ?? []).flatMap((x) => x.functionDeclarations ?? []).map((f) => f.name);
const goEnum = (s) => (s?.tools ?? []).flatMap((x) => x.functionDeclarations ?? []).find((f) => f.name === 'go_to')?.parameters?.properties?.page?.enum ?? [];

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '', HELIX_STANDIN: '' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9494, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`${BASE}/leads`)}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === `${BASE}/leads`);
  await ev(`localStorage.setItem('helix-voice', 'on')`);
  await go(`${BASE}/leads`);

  // 1. Opening Ask Helix starts voice with this person's pages and the moving-around rules.
  await ev(`document.querySelector('.helix-fab')?.click()`);
  check(await waitFor(async () => setups.length === 1 && (await ev('window.__live.socks.length')) === 1), 'opening Ask Helix starts one voice session');
  await emit({ setupComplete: {} });
  const s1 = setups[0];
  check(toolNames(s1).includes('go_to') && toolNames(s1).includes('open_lead') && toolNames(s1).includes('highlight'), `voice Helix can go to pages, open leads and point (${toolNames(s1).join(', ')})`);
  check(goEnum(s1).includes('Pipeline') && goEnum(s1).includes('Calendar') && goEnum(s1).includes('Leads') && !goEnum(s1).includes('Ask Helix'), `its pages are this agency's own menu, without the full Ask Helix page (${goEnum(s1).join(', ')})`);
  const rail = await ev(`[...document.querySelectorAll('.rail a')].map((a) => a.textContent.trim())`);
  check(goEnum(s1).every((p) => rail.some((x) => x.includes(p))), `every page Helix offers is on this agency’s own menu (${goEnum(s1).filter((p) => !rail.some((x) => x.includes(p))).join(', ') || 'all on the menu'})`);
  check(/MOVING AROUND THE SCREEN/.test(sys(s1)) && /never mark, book, send or delete/.test(sys(s1)), 'the rules say opening and pointing never change anything');

  // 2. The greeting isn't saved; a spoken exchange is.
  await say('', 'Hi, what do you need?');
  check((await voiceMsgs()).length === 0, 'Helix’s greeting (nobody spoke) is not saved');
  await say('Who is booked this week?', `${booked} is booked for a consult.`);
  check(await waitFor(async () => (await voiceMsgs()).filter((m) => m.channel === 'voice').length === 2), 'the spoken exchange is saved to the thread as voice');
  const vm = await voiceMsgs();
  check(vm[0]?.role === 'user' && vm[0]?.page === 'Leads' && /booked this week/.test(vm[0]?.text), 'with what was said and the page it was said on');
  check(/spoken/i.test((await drawer()) ?? '') && /booked this week/.test((await drawer()) ?? ''), 'the chat shows the spoken turns, marked Spoken');

  // 3. go_to: a new page, the same voice session.
  const r1 = await tool('go_to', { page: 'Pipeline' });
  check(r1.ok === true && (await ev('location.pathname')) === `${BASE}/pipeline`, `go_to Pipeline opens Pipeline (${JSON.stringify(r1)})`);
  check(setups.length === 1 && (await ev('window.__live.socks.length')) === 1 && (await ev('window.__live.socks[0].readyState')) === 1, 'the same voice session carries on (no new session, socket still open)');
  check(/on Pipeline/.test((await drawer()) ?? '') && /booked this week/.test((await drawer()) ?? ''), 'the drawer stays open on Pipeline with the conversation');
  await say('Who is stalling here?', 'Nobody is stalling.');
  check(await waitFor(async () => (await voiceMsgs()).some((m) => m.text === 'Who is stalling here?' && m.page === 'Pipeline')), `a spoken turn after moving is saved with the new page (${(await voiceMsgs()).map((m) => m.page).join(',')})`);

  // 4. Pointing.
  const r2 = await tool('open_lead', { name: booked.split(' ')[0] });
  check(r2.ok === true && r2.matches >= 1 && (r2.names ?? []).includes(booked), `open_lead finds ${booked} on Pipeline (${JSON.stringify(r2)})`);
  await sleep(500);
  check(!!(await ev(`!!document.querySelector('.hx-spot')`)), 'Helix points at the lead on screen');
  check((await drawer()) === null && !!(await ev(`!!document.querySelector('.helix-pill')`)), 'Ask Helix minimizes so the page shows (and keeps listening)');
  await shot('voice-nav-open-lead');
  check(setups.length === 1 && (await ev('window.__live.socks[0].readyState')) === 1, 'still the same voice session while minimized');
  const r3 = await tool('highlight', { text: 'Booked' });
  check(r3.ok === true, `highlight points at “Booked” (${JSON.stringify(r3)})`);
  const r4 = await tool('go_to', { page: 'Ask Helix' });
  check(r4.ok === false && (await ev('location.pathname')) === `${BASE}/pipeline`, `a page that isn’t on the list is refused (${JSON.stringify(r4)} at ${await ev('location.pathname')})`);
  const r5 = await tool('open_lead', { name: 'Nobody Byname' });
  check(r5.ok === false, 'a name that matches no lead says so');

  // 5. Typed Helix opens a page when asked; Ctrl+K asks Helix.
  await ev(`document.querySelector('.helix-pill')?.click()`); await sleep(400);
  await ev(`(() => { const i = document.querySelector('.helix-drawer input[aria-label="Ask Helix"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Take me to my calendar'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`document.querySelector('.helix-drawer form button[type="submit"]')?.click()`);
  check(await waitFor(async () => (await ev('location.pathname')) === `${BASE}/calendar`), 'typed “Take me to my calendar” opens Calendar');
  check(/Opening your Calendar/.test((await drawer()) ?? ''), 'and Helix says so in the thread');
  await sleep(2500); // Helix shows the menu first, then the new page settles
  // A real Ctrl+K key press (the browser's own keyboard path).
  await ev('document.activeElement && document.activeElement.blur()');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75 });
  await sleep(600);
  const byKey = !!(await ev(`!!document.querySelector('.jump')`));
  console.log('palette by Ctrl+K:', byKey, '| Jump to button present:', await ev(`document.querySelectorAll('.jump-open').length`));
  if (!byKey) { await ev(`document.querySelector('.jump-open')?.click()`); await sleep(600); console.log('palette by button:', await ev(`!!document.querySelector('.jump')`)); }
  await ev(`(() => { const i = document.querySelector('.jump input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'who called today'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(500);
  const jt = (await ev(`document.querySelector('.jump')?.innerText`)) ?? '(palette not open)';
  check(/Ask Helix: “who called today”/.test(jt), `Ctrl+K offers to ask Helix what was typed (${jt.replace(/\s+/g, ' ').slice(0, 160)})`);
  await ev(`[...document.querySelectorAll('.jump-list li')].find((l) => /Ask Helix/.test(l.textContent))?.click()`);
  check(await waitFor(async () => /who called today/.test((await drawer()) ?? '') && /Verify typed answer/.test((await drawer()) ?? '')), 'choosing it asks Helix in the drawer');

  // 6. Reload: spoken turns come back; a new voice session gets the conversation so far.
  await go(`${BASE}/leads`);
  await ev(`document.querySelector('.helix-fab')?.click()`);
  check(await waitFor(async () => /spoken/i.test((await drawer()) ?? '') && /booked this week/.test((await drawer()) ?? '')), 'after a reload the spoken turns come back, marked Spoken');
  check(await waitFor(async () => setups.length === 2), 'reopening starts a new voice session');
  check(/CONVERSATION SO FAR/.test(sys(setups[1])) && /Person \(spoken\): Who is stalling here\?/.test(sys(setups[1])) && /Take me to my calendar/.test(sys(setups[1])), 'the new voice session starts with the conversation so far (spoken and typed)');
  await shot('voice-nav-restored');

  // 7. Two saves at once with no thread yet continue one thread.
  must(await db.from('helix_threads').delete().eq('tenant_id', t.id), 'clear');
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const l2 = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link2');
  must(await c.auth.verifyOtp({ token_hash: l2.properties.hashed_token, type: 'magiclink' }), 'session');
  const both = await Promise.all([1, 2, 3].map((n) => c.rpc('helix_append', { p_thread: null, p_tenant: t.id, p_surface: 'agency', p_page: 'Leads', p_turns: [{ role: 'user', text: `race ${n}` }] })));
  check(both.every((x) => !x.error) && new Set(both.map((x) => x.data)).size === 1, `three saves at once continue one thread (${new Set(both.map((x) => x.data)).size})`);
} finally {
  must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'remove grants');
  must(await db.from('helix_threads').delete().eq('tenant_id', t.id), 'remove threads');
  await db.from('helix_tour_sessions').delete().eq('tenant_id', t.id);
  ws.close(); chrome.kill(); mock.close();
  try { execSync(process.platform === 'win32' ? `taskkill /PID ${dev.pid} /T /F` : `kill ${dev.pid}`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
