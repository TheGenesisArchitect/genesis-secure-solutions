// Verify the Command Brief and menu teaching on the PREVIEW database (Gemini stand-in, no spend):
//  1. agency Home opens with Helix's one move as the headline (full brief folds open), then action cards built from
//     real records: Call <new lead> (Call / What should I ask? / Mark called), today's consult, follow-ups due,
//     approvals; Helix's suggested calls as cards with Add to Today
//  2. the buttons work: Mark called puts Helix's confirm card up (nothing changes until yes); Do it with Helix asks
//     Helix about that card; checking a card off moves the progress
//  3. Enterprise Overview: cards grouped by department (Sales, Clients, ...)
//  4. Helix teaches the menu: before typed "go" opens a page, the page lights up in the menu, then Helix goes there
// Screenshots at desktop and phone width.
//   node --env-file=.env.local scripts/verify-command-brief.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39565, SLUG = 'test-launch', BASE = `/app/${SLUG}`;
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
const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'an admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email;
const REASON = 'Verify command brief';
must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'clear grants');
must(await db.from('module_grants').insert(['helix', 'pipeline', 'calendar'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 86_400_000).toISOString(), reason: REASON }))), 'grants');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const clean = async () => {
  await db.from('leads').delete().eq('tenant_id', t.id).like('ext_id', 'cb-%');
  await db.from('helix_briefs').delete().eq('tenant_id', t.id).eq('day', today);
  await db.from('helix_briefs').delete().eq('tenant_id', house.id).eq('day', today);
  await db.from('follow_ups').delete().eq('tenant_id', t.id).like('reason', 'Verify brief%');
  await db.from('helix_threads').delete().eq('tenant_id', t.id);
  await db.from('outbox').delete().eq('tenant_id', t.id).in('template', ['lead_new', 'lead_push']);
};
await clean();
const consent = 'I agree that Test Agency may contact me about this request.';
must(await db.from('leads').insert([
  { tenant_id: t.id, ext_id: 'cb-1', name: 'Rosa Brief', phone: '(706) 555-0161', topic: 'Auto', source: 'website', consent_text: consent, consent_at: new Date().toISOString(), status: 'new', channel: 'form' },
  { tenant_id: t.id, ext_id: 'cb-2', name: 'Theo Consult', phone: '(706) 555-0162', topic: 'Boat', source: 'google', consent_text: consent, consent_at: new Date().toISOString(), status: 'booked', channel: 'form', booked_for: new Date(`${today}T14:00:00-04:00`).toISOString(), first_contact_at: new Date().toISOString() },
]), 'brief leads');
must(await db.from('follow_ups').insert({ tenant_id: t.id, who: 'Marcus Lee', reason: 'Verify brief: homeowners quote', due_on: today, due_at: '10:30' }), 'follow-up');

const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('auth_tokens')) return res.end(JSON.stringify({ name: 'auth_tokens/verify' }));
    const asked = JSON.stringify(j.contents?.at(-1) ?? '');
    const reply = /morning brief/i.test(asked) ? { answer: 'Call Rosa Brief first: she asked about Auto an hour ago and nobody has called. Then prep for Theo’s 2 PM consult and clear the Marcus Lee follow-up.', followUps: [{ who: 'Rosa Brief', reason: 'New Auto lead', due: today, at: '09:15' }], drafts: [] }
      : /take me to pipeline/i.test(asked) ? { answer: 'Opening Pipeline.', go: 'Pipeline', followUps: [], drafts: [] }
      : { answer: 'Verify typed answer.', followUps: [], drafts: [], remember: [] };
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
  });
}).listen(MOCK);
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '', HELIX_STANDIN: '', HELIX_ACT_SECRET: 'verify-cb' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9500, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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

const shotAt = async (name, w, h, mobile) => {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await sleep(700);
  const full = await ev('Math.min(document.documentElement.scrollHeight, 2400)');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: full, deviceScaleFactor: 1, mobile });
  await sleep(400);
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64'));
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
};
const cb = () => ev(`document.querySelector('.cb')?.innerText ?? ''`);
const seen = '["lead-alerts-2026-10-15","helix-confirm-2026-10-15","helix-ptt-2026-10-15","helix-moves-2026-10-15","helix-travels-2026-10-15"]';

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(BASE)}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === BASE);
  await ev(`localStorage.setItem('helix-voice', 'off'); localStorage.setItem('genovus-whats-new', '${seen}'); localStorage.removeItem('helix-menu-taught'); Object.keys(localStorage).filter((k) => k.startsWith('brief-done-')).forEach((k) => localStorage.removeItem(k))`);
  await go(BASE);

  // 1. Headline, then cards from real records.
  check(await waitFor(async () => /Call Rosa Brief first/.test(await cb())), 'the headline is Helix’s one most important move');
  const text = await cb();
  check(!/Then prep for Theo/.test(text) && /Read Helix’s full brief/i.test(text), 'the rest of the written brief folds away under “Read Helix’s full brief”');
  check(/Call Rosa Brief/.test(text) && /New lead · Auto · via website/.test(text), 'a “Call Rosa Brief” card from the new lead');
  const rosa = `[...document.querySelectorAll('.cb-card')].find((c) => /^Call Rosa Brief/m.test(c.querySelector('.cb-title').textContent))`;
  check((await ev(`(${rosa})?.querySelector('a[href^="tel:"]')?.getAttribute('href')`)) === 'tel:7065550161', 'its Call button dials the lead');
  check(/What should I ask\?/.test(await ev(`(${rosa})?.innerText`)) && /Mark called/.test(await ev(`(${rosa})?.innerText`)), 'with What should I ask? and Mark called');
  check(/Consult with Theo Consult at 2:00 PM/.test(text), 'today’s consult is a card (Prep me)');
  check(/follow-up(s)? due/i.test(text) && /Marcus Lee/.test(text), 'follow-ups due are a card');
  check(/Rosa Brief · 09:15/.test(text) && /Add to Today/.test(text), 'Helix’s suggested call is a card with Add to Today');
  check(/0\/\d+/.test(text.replace(/\s/g, '')), 'progress starts at 0 done');
  await shotAt('brief-agency-desktop', 1440, 900, false);
  await shotAt('brief-agency-phone', 390, 844, true);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // 2. The buttons.
  await ev(`[...(${rosa}).querySelectorAll('button')].find((b) => /Mark called/.test(b.textContent))?.click()`);
  check(await waitFor(async () => /Mark Rosa Brief called \(Contacted\)\?/.test((await ev(`document.querySelector('.helix-card.act')?.innerText`)) ?? '')), 'Mark called puts up Helix’s confirm card');
  check(must(await db.from('leads').select('status').eq('tenant_id', t.id).eq('ext_id', 'cb-1').single(), 'l').status === 'new', 'nothing changes until the yes');
  await ev(`[...document.querySelectorAll('.helix-card.act button')].find((b) => /Not now/.test(b.textContent))?.click()`);
  await ev(`[...(${rosa}).querySelectorAll('.cb-helix')][0]?.click()`);
  check(await waitFor(async () => /Help me with this now: Call Rosa Brief/.test((await ev(`(() => { const d = document.querySelector('.helix-drawer'); return d && !d.hidden ? d.innerText : ''; })()`)) ?? '')), 'Do it with Helix asks Helix about that card');
  await ev(`document.querySelector('.helix-drawer button[aria-label^="Minimize"]')?.click()`); await sleep(300);
  await ev(`(${rosa})?.querySelector('.cb-check')?.click()`); await sleep(400);
  check(/1\/\d+/.test((await cb()).replace(/\s/g, '')) && !!(await ev(`(${rosa})?.classList.contains('done')`)), 'checking a card off moves the progress');

  // 4. Menu teaching on a typed "go".
  await ev(`document.querySelector('.helix-pill, .helix-fab')?.click()`); await sleep(400);
  await ev(`(() => { const i = document.querySelector('.helix-drawer input[aria-label="Ask Helix"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Take me to Pipeline'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`document.querySelector('.helix-drawer form button[type="submit"]')?.click()`);
  check(await waitFor(async () => !!(await ev(`document.querySelector('.rail a.menu-teach')?.getAttribute('href') === '${BASE}/pipeline'`)), 30000), 'before going, Pipeline lights up in the menu (“in your menu”)');
  await send('Page.captureScreenshot', { format: 'png' }).then((s) => fs.writeFileSync(path.join(OUT, 'menu-teach.png'), Buffer.from(s.result.data, 'base64')));
  check(await waitFor(async () => (await ev('location.pathname')) === `${BASE}/pipeline`), 'then Helix opens Pipeline');
  check(await waitFor(async () => !(await ev(`!!document.querySelector('.rail a.menu-teach')`))), 'and the menu lesson clears');

  // 3. Enterprise.
  await go('/auth/signout');
  const l2 = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'admin link');
  await go(`/auth/continue?t=${encodeURIComponent(l2.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console');
  await ev(`localStorage.setItem('genovus-whats-new', '${seen}')`);
  await go('/console');
  check(await waitFor(async () => /done today/i.test(await cb())), 'Enterprise Overview opens with the Command Brief');
  const lanes = await ev(`[...document.querySelectorAll('.cb-filter button')].map((b) => b.textContent)`);
  await ev(`[...document.querySelectorAll('.cb-filter button')].find((b) => /^Sales/.test(b.textContent))?.click()`); await sleep(300);
  const only = await ev(`[...document.querySelectorAll('.cb-card .cb-lane')].map((x) => x.textContent)`);
  check(only.length > 0 && only.every((x) => x === 'Sales'), `a department chip shows just that department (${only.length} Sales cards)`);
  await ev(`[...document.querySelectorAll('.cb-filter button')].find((b) => /^All/.test(b.textContent))?.click()`); await sleep(300);
  check(Array.isArray(lanes) && lanes.length >= 1, `cards grouped by department (${(lanes ?? []).join(', ')})`);
  await shotAt('brief-enterprise-desktop', 1440, 900, false);
  await shotAt('brief-enterprise-phone', 390, 844, true);
} finally {
  await clean();
  must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'remove grants');
  ws.close(); chrome.kill(); mock.close();
  try { execSync(process.platform === 'win32' ? `taskkill /PID ${dev.pid} /T /F` : `kill ${dev.pid}`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
