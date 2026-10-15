// Verify Step 8a, Helix's confirm lane, on the PREVIEW database with stand-ins for Gemini (typed and the Live
// socket) (no real AI, no spend):
//  1. typed: Helix proposes "mark Priya Shah called"; nothing changes until the person taps Yes; then the lead is
//     Contacted, the thread says Done, and Undo (ten seconds) puts it back exactly (status and first contact)
//  2. a name that matches several leads asks which one; nothing changes
//  3. voice: propose_action shows the card (Ask Helix opens), confirm_action books the consult, undo_last undoes it;
//     confirm with nothing waiting is refused
//  4. a tap on Yes while voice is live tells Helix what happened
//  5. a follow-up Helix adds can be undone; a forged or someone else's token is refused
//  6. every change and undo is in the audit log
// Uses the "test-launch" agency from verify-agency-dashboard.mjs; adds Helix for the run, then removes it.
//   node --env-file=.env.local scripts/verify-helix-act.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39560, SLUG = 'test-launch', BASE = `/app/${SLUG}`;
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
const REASON = 'Verify Helix act';
must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'clear grants');
must(await db.from('module_grants').insert(['helix', 'pipeline', 'calendar'].map((k) => ({ tenant_id: t.id, module_key: k, until: new Date(Date.now() + 86_400_000).toISOString(), reason: REASON }))), 'grants');
must(await db.from('helix_threads').delete().eq('tenant_id', t.id), 'clear threads');
// Two leads for the run: Priya (new) and a second "Priya" so a vague name has to ask.
must(await db.from('leads').delete().eq('tenant_id', t.id).like('ext_id', 'act-%'), 'clear act leads');
const consent = 'I agree that Test Agency may contact me about this request.';
const [priya, priya2] = must(await db.from('leads').insert([
  { tenant_id: t.id, ext_id: 'act-1', name: 'Priya Okafor', phone: '(706) 555-0101', topic: 'Renters', source: 'website', consent_text: consent, consent_at: new Date().toISOString(), status: 'new', channel: 'form' },
  { tenant_id: t.id, ext_id: 'act-2', name: 'Priya Lindqvist', phone: '(706) 555-0102', topic: 'Auto', source: 'website', consent_text: consent, consent_at: new Date().toISOString(), status: 'new', channel: 'form' },
]).select('id, name'), 'act leads');
const lead = async (id) => must(await db.from('leads').select('status, booked_for, first_contact_at').eq('id', id).single(), 'lead');
const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// Gemini stand-in: typed Helix proposes what the question asks; the token service accepts voice sessions.
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('auth_tokens')) return res.end(JSON.stringify({ name: 'auth_tokens/verify' }));
    const asked = JSON.stringify(j.contents?.at(-1) ?? '');
    const reply = /mark Priya Okafor called/.test(asked) ? { answer: 'Mark Priya Okafor called? Shall I?', propose: { action: 'mark_lead', lead: 'Priya Okafor', status: 'contacted' }, followUps: [], drafts: [] }
      : /mark Priya called/.test(asked) ? { answer: 'Which Priya? Shall I?', propose: { action: 'mark_lead', lead: 'Priya', status: 'contacted' }, followUps: [], drafts: [] }
      : /follow up with Priya/.test(asked) ? { answer: 'Add a follow-up? Shall I?', propose: { action: 'add_follow_up', who: 'Priya Okafor', day: tomorrow, time: '10:00', reason: 'Verify act follow-up' }, followUps: [], drafts: [] }
      : { answer: 'Verify typed answer.', followUps: [], drafts: [] };
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
  });
}).listen(MOCK);

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '', HELIX_STANDIN: '', HELIX_ACT_SECRET: 'verify-act-' + Date.now() };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9495, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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
const card = () => ev(`document.querySelector('.helix-card.act')?.innerText ?? null`);
const tap = (re) => ev(`(() => { const b = [...document.querySelectorAll('.helix-card.act button, .helix-undo button')].find((x) => ${re}.test(x.textContent)); b && b.click(); return !!b; })()`);
const started = new Date().toISOString();
const audit = async (action) => (await db.from('audit_events').select('id').eq('tenant_id', t.id).eq('action', action).gte('at', started)).data?.length ?? 0;

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(`${BASE}/leads`)}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === `${BASE}/leads`);
  await ev(`localStorage.setItem('helix-voice', 'off')`);
  await go(`${BASE}/leads`);
  await ev(`document.querySelector('.helix-fab')?.click()`); await sleep(600);

  // 1. Typed: propose, nothing changes, tap Yes, Done, Undo.
  await typeAsk('Please mark Priya Okafor called');
  check(await waitFor(async () => /Mark Priya Okafor called \(Contacted\)\?/.test((await card()) ?? '')), 'Helix proposes “Mark Priya Okafor called (Contacted)?” on a card');
  check(/needs your yes/i.test((await card()) ?? ''), 'the card says it changes data and needs a yes');
  await sleep(1500);
  check((await lead(priya.id)).status === 'new', 'nothing changes before the yes');
  await shot('act-card');
  await tap(/Yes, do it/);
  check(await waitFor(async () => (await lead(priya.id)).status === 'contacted'), 'after the tap Priya Okafor is Contacted');
  check(await waitFor(async () => /Done: Priya Okafor marked called/.test((await drawer()) ?? '')), 'the thread says Done');
  check(/Undo/.test((await ev(`document.querySelector('.helix-undo')?.innerText`)) ?? ''), 'a Done · Undo bar shows');
  await shot('act-undo');
  await tap(/^Undo$/);
  const back = await waitFor(async () => (await lead(priya.id)).status === 'new');
  const after = await lead(priya.id);
  check(back && after.first_contact_at === null, `Undo puts it back exactly (status ${after.status}, first contact ${after.first_contact_at})`);
  check(await waitFor(async () => /Undone: back to new/.test((await drawer()) ?? '')), 'the thread says it was undone');
  check(await waitFor(async () => (await audit('lead.contacted')) === 1 && (await audit('lead.undo')) === 1), 'the change and the undo are both in the audit log');

  // 2. A vague name asks which one.
  await typeAsk('Please mark Priya called');
  check(await waitFor(async () => /More than one lead matches/.test((await card()) ?? '') && /Priya Okafor/.test((await card()) ?? '') && /Priya Lindqvist/.test((await card()) ?? '')), 'a name matching two leads asks which one (and names both)');
  check((await lead(priya.id)).status === 'new' && (await lead(priya2.id)).status === 'new', 'nothing changes');
  await tap(/OK/);

  // 5a. A follow-up, undone.
  await typeAsk('Please follow up with Priya tomorrow');
  check(await waitFor(async () => /Add a follow-up with Priya Okafor/.test((await card()) ?? '')), 'Helix proposes the follow-up');
  await tap(/Yes, do it/);
  const fuMade = await waitFor(async () => ((await db.from('follow_ups').select('id').eq('tenant_id', t.id).eq('reason', 'Verify act follow-up')).data ?? []).length === 1);
  check(fuMade, 'after the tap the follow-up exists');
  await tap(/^Undo$/);
  check(await waitFor(async () => ((await db.from('follow_ups').select('id').eq('tenant_id', t.id).eq('reason', 'Verify act follow-up')).data ?? []).length === 0), 'Undo removes it');

  // 5b. Forged tokens are refused (the server signs exactly what was shown, for this person, for five minutes).
  const forged = await ev(`fetch('/api/helix/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: '${SLUG}', step: 'confirm', token: 'eyJhIjoibWFya19sZWFkIn0.bad' }) }).then((r) => r.json())`);
  check(forged?.ok === false && (await lead(priya.id)).status === 'new', 'a forged proposal is refused');
  const p = await ev(`fetch('/api/helix/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: '${SLUG}', step: 'propose', action: 'mark_lead', args: { lead: 'Priya Okafor', status: 'won' } }) }).then((r) => r.json())`);
  const [body, mac] = String(p?.token ?? '').split('.');
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), args: { id: priya2.id, name: 'Priya Lindqvist', status: 'won' } })).toString('base64url') + '.' + mac;
  const tampered = await ev(`fetch('/api/helix/act', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: '${SLUG}', step: 'confirm', token: ${JSON.stringify(edited)} }) }).then((r) => r.json())`);
  check(p?.ok === true && tampered?.ok === false && (await lead(priya2.id)).status === 'new', 'a proposal edited to change a different lead is refused');

  // 3/4. Voice: propose, confirm after yes, undo; a tap on Yes is told to Helix.
  await ev(`localStorage.setItem('helix-voice', 'on')`);
  await go(`${BASE}/leads`);
  await ev(`document.querySelector('.helix-fab')?.click()`);
  await waitFor(async () => (await ev('window.__live.socks.length')) === 1);
  await emit({ setupComplete: {} });
  const none = await tool('confirm_action', {});
  check(none.ok === false, 'confirm_action with nothing waiting is refused');
  await ev(`document.querySelector('.helix-drawer button[aria-label^="Minimize"]')?.click()`); await sleep(300);
  const v1 = await tool('propose_action', { action: 'book_lead', lead: 'Priya Okafor', day: tomorrow, time: '14:00' });
  check(v1.ok === true && /Book Priya Okafor for a consult/.test(v1.summary ?? ''), `voice propose_action returns the summary to read out (${v1.summary ?? v1.error})`);
  check(!!(await drawer()) && /Book Priya Okafor/.test((await card()) ?? ''), 'the card shows and Ask Helix opens for it');
  check((await lead(priya.id)).status === 'new', 'nothing changes until the yes');
  const v2 = await tool('confirm_action', {});
  const bk = await lead(priya.id);
  const bkTime = bk.booked_for ? new Date(bk.booked_for).toLocaleString('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }) : '';
  const [mm, dd, yy] = tomorrow.split('-').slice(1).concat(tomorrow.slice(0, 4));
  check(v2.ok === true && bk.status === 'booked' && bkTime.startsWith(`${mm}/${dd}/${yy}`) && /2:00 PM/.test(bkTime), `after the spoken yes Priya is booked for tomorrow 2:00 PM office time (${bkTime})`);
  const v3 = await tool('undo_last', {});
  const ub = await lead(priya.id);
  check(v3.ok === true && ub.status === 'new' && ub.booked_for === null && ub.first_contact_at === null, 'undo_last puts the lead back exactly');
  await tool('propose_action', { action: 'mark_lead', lead: 'Priya Lindqvist', status: 'lost' });
  const before = await ev('window.__live.sent.length');
  await tap(/Yes, do it/);
  check(await waitFor(async () => (await ev(`window.__live.sent.slice(${before}).some((m) => /The person tapped Yes/.test(m.realtimeInput?.text ?? ''))`))), 'a tap on Yes while voice is live tells Helix what happened');
  check((await lead(priya2.id)).status === 'lost', 'and the change is made');
  check((await audit('lead.booked')) === 1 && (await audit('lead.lost')) === 1 && (await audit('lead.undo')) === 2, 'voice changes and undo are in the audit log too');
  await shot('act-voice');
} finally {
  must(await db.from('module_grants').delete().eq('tenant_id', t.id).eq('reason', REASON), 'remove grants');
  must(await db.from('helix_threads').delete().eq('tenant_id', t.id), 'remove threads');
  must(await db.from('follow_ups').delete().eq('tenant_id', t.id).eq('reason', 'Verify act follow-up'), 'remove follow-ups');
  must(await db.from('leads').delete().eq('tenant_id', t.id).like('ext_id', 'act-%'), 'remove act leads');
  await db.from('outbox').delete().eq('tenant_id', t.id).eq('template', 'lead_new');
  await db.from('helix_tour_sessions').delete().eq('tenant_id', t.id);
  ws.close(); chrome.kill(); mock.close();
  try { execSync(process.platform === 'win32' ? `taskkill /PID ${dev.pid} /T /F` : `kill ${dev.pid}`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
