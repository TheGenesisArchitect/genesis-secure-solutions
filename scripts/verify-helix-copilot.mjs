// Verify the copilot quick fixes (plan step 1) on the PREVIEW database, with stand-ins for Gemini (typed and the
// Live socket) (no real AI, no spend). The operator's phone test, replayed:
//  1. Enterprise voice can open Helix notes (and Helix knows); the Studio, full Ask Helix and client pages stay out
//  2. voice "make a note" saves an action item to the team's Helix notes (not "a question"), tagged with who asked;
//     "take me to Helix notes" opens it and the note is there
//  3. typed "make a note" saves it too (Enterprise inbox; an agency's own notes) with an "Open" link that goes there
//  4. Helix is told the right page name on pages that used to say Home / Overview
//  5. moving pages by the menu tells voice Helix quietly (no reply asked); Helix's own moves aren't repeated
//   node --env-file=.env.local scripts/verify-helix-copilot.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39564, SLUG = 'test-launch', BASE = `/app/${SLUG}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'an admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email;
const t = must(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) throw new Error(`${SLUG} is missing: run verify-agency-dashboard.mjs first`);
const REASON = 'Verify copilot';
must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'clear grants');
must(await db.from('module_grants').insert(['helix', 'helix-notes', 'pipeline'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 86_400_000).toISOString(), reason: REASON }))), 'grants');
const clean = async () => {
  await db.from('helix_notes').delete().like('text', 'Verify copilot%');
  await db.from('helix_threads').delete().eq('user_id', admin.user_id);
  await db.from('helix_threads').delete().eq('tenant_id', t.id);
};
await clean();

// Gemini stand-in: typed Helix saves a note when asked; the token service records voice setups.
const setups = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('auth_tokens')) { setups.push(j.bidiGenerateContentSetup ?? null); return res.end(JSON.stringify({ name: 'auth_tokens/verify' })); }
    const asked = JSON.stringify(j.contents?.at(-1) ?? '');
    const m = asked.match(/make a note: ([^"\\]+)/i);
    const reply = m ? { answer: 'Noted. It’s in Helix notes. Want me to open it?', note: { kind: 'action_item', text: `Verify copilot typed ${m[1].trim()}` }, followUps: [], drafts: [], remember: [] } : { answer: 'Verify typed answer.', followUps: [], drafts: [], remember: [] };
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
  });
}).listen(MOCK);
const sys = (s) => s?.systemInstruction?.parts?.[0]?.text ?? '';
const goEnum = (s) => (s?.tools ?? []).flatMap((x) => x.functionDeclarations ?? []).find((f) => f.name === 'go_to')?.parameters?.properties?.page?.enum ?? [];

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '', HELIX_STANDIN: '' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9498, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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

const typeAsk = async (q) => {
  await ev(`(() => { const i = document.querySelector('.helix-drawer input[aria-label="Ask Helix"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${JSON.stringify(q)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`document.querySelector('.helix-drawer form button[type="submit"]')?.click()`);
};
const ctxSent = () => ev(`window.__live.sent.filter((m) => m.clientContent).map((m) => JSON.stringify(m.clientContent))`);
const seen = '["lead-alerts-2026-10-15","helix-confirm-2026-10-15","helix-ptt-2026-10-15","helix-moves-2026-10-15","helix-travels-2026-10-15"]';

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console/campaigns')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console/campaigns');
  await ev(`localStorage.setItem('helix-voice', 'on'); localStorage.setItem('genovus-whats-new', '${seen}')`);
  await go('/console/campaigns');

  // 1–2. Enterprise voice: pages, a note, and opening Helix notes.
  await ev(`document.querySelector('.helix-fab')?.click()`);
  await waitFor(async () => setups.length === 1 && (await ev('window.__live.socks.length')) === 1);
  await emit({ setupComplete: {} });
  const pages = goEnum(setups[0]);
  check(pages.includes('Helix notes') && pages.includes('Helix knows'), `Enterprise voice can open Helix notes and Helix knows (${pages.join(', ')})`);
  check(!pages.includes('Ask Helix') && !pages.includes('Studio'), 'the full Ask Helix page and the Studio stay out (they would end the voice session)');
  check(/HELIX NOTES: when someone says "make a note"/.test(sys(setups[0])), 'Enterprise voice knows to take a note when asked');
  check(/on Campaigns/.test((await drawer()) ?? ''), 'Helix knows it is on Campaigns');
  const n1 = await tool('take_note', { kind: 'action_item', text: 'Verify copilot voice: Helix should show new leads with one-tap actions' });
  const vnote = must(await db.from('helix_notes').select('chapter, kind, tenant_id, asked_by').like('text', 'Verify copilot voice%').maybeSingle(), 'voice note');
  check(!!vnote && vnote.chapter === 'helix' && vnote.kind === 'action_item' && vnote.tenant_id === house.id && vnote.asked_by === admin.user_id, `voice “make a note” saves the team’s own action item with who asked (${JSON.stringify(vnote)} ${JSON.stringify(n1).slice(0, 80)})`);
  const r = await tool('go_to', { page: 'Helix notes' });
  check(r.ok === true && (await ev('location.pathname')) === '/console/helix', `“take me to Helix notes” opens it (${JSON.stringify(r)})`);
  check(await waitFor(async () => /Helix should show new leads with one-tap actions/.test(await ev('document.body.innerText'))), 'and the note is there');
  check(!/couldn’t answer/.test((await ev(`[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /Helix should show new leads/.test(e.textContent))?.closest('li, article, .card, section')?.innerText ?? ''`)) ?? ''), 'it isn’t labelled as a question Helix couldn’t answer');
  await send('Page.captureScreenshot', { format: 'png' }).then((s) => fs.writeFileSync(path.join(OUT, 'copilot-notes.png'), Buffer.from(s.result.data, 'base64')));

  // 5. Silent page context: Helix's own move isn't repeated; a move by the menu is told quietly.
  await sleep(800);
  check(!(await ctxSent()).some((c) => /Helix notes page/.test(c)), 'Helix’s own move to Helix notes isn’t repeated to it');
  await ev(`[...document.querySelectorAll('.rail a')].find((a) => a.getAttribute('href') === '/console/pipeline')?.click()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console/pipeline');
  check(await waitFor(async () => (await ctxSent()).some((c) => /opened the Pipeline page themselves/.test(c) && /"turnComplete":false/.test(c))), 'moving to Pipeline by the menu tells voice Helix quietly (no reply asked)');
  check((await ev('window.__live.socks.length')) === 1, 'still the same voice session');

  // 3. Typed note (Enterprise), with an Open link.
  await ev(`localStorage.setItem('helix-voice', 'off')`);
  await go('/console/carriers');
  await ev(`document.querySelector('.helix-fab')?.click()`); await sleep(600);
  // 4. Page names that used to be wrong.
  check(/on Carriers/.test((await drawer()) ?? ''), `Carriers is Carriers, not Overview (${((await drawer()) ?? '').split('\n')[0]})`);
  await typeAsk('make a note: follow up with Riverside on Friday');
  check(await waitFor(async () => /In Helix notes · Open/i.test((await drawer()) ?? '')), 'typed “make a note” saves it, with an Open link');
  const tnote = must(await db.from('helix_notes').select('chapter, kind, asked_by').like('text', 'Verify copilot typed%').maybeSingle(), 'typed note');
  check(!!tnote && tnote.chapter === 'helix' && tnote.asked_by === admin.user_id, 'in the team’s Helix notes with who asked');
  await ev(`[...document.querySelectorAll('.helix-drawer a')].find((a) => /In Helix notes/.test(a.textContent))?.click()`);
  check(await waitFor(async () => (await ev('location.pathname')) === '/console/helix'), 'Open goes to Helix notes');
  for (const [p, name] of [['/console/assets', 'Asset library'], ['/console/audit', 'Audit log'], ['/console/setup', 'Domains']]) {
    await go(p); await ev(`document.querySelector('.helix-fab')?.click()`); await sleep(500);
    check(new RegExp(`on ${name}`).test((await drawer()) ?? ''), `${p} is “${name}”`);
  }

  // 3b. Agency: typed note into the office's own notes; agency pages named right.
  await go(`${BASE}/setup`);
  await ev(`document.querySelector('.helix-fab')?.click()`); await sleep(600);
  check(/on Setup/.test((await drawer()) ?? ''), 'agency Setup is Setup, not Home');
  await typeAsk('make a note: agency call the dealership on Monday');
  check(await waitFor(async () => /In Helix notes · Open/i.test((await drawer()) ?? '')), 'agency typed note saved with an Open link');
  const anote = must(await db.from('helix_notes').select('chapter, tenant_id').like('text', 'Verify copilot typed agency%').maybeSingle(), 'agency note');
  check(!!anote && anote.chapter === 'agency' && anote.tenant_id === t.id, 'in the agency’s own Helix notes');
  for (const [p, name] of [['approvals', 'Approvals'], ['team', 'Team'], ['program', 'Your program']]) {
    await go(`${BASE}/${p}`); await ev(`document.querySelector('.helix-fab')?.click()`); await sleep(500);
    check(new RegExp(`on ${name}`).test((await drawer()) ?? ''), `agency ${p} is “${name}”`);
  }
} finally {
  await clean();
  must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'remove grants');
  await db.from('helix_tour_sessions').delete().eq('viewer_id', admin.user_id).gte('started_at', new Date(Date.now() - 3600_000).toISOString());
  ws.close(); chrome.kill(); mock.close();
  try { execSync(process.platform === 'win32' ? `taskkill /PID ${dev.pid} /T /F` : `kill ${dev.pid}`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
