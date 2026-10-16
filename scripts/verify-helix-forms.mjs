// Verify Helix form filling (plan step 2) on the PREVIEW database, with stand-ins for Gemini (typed and the Live
// socket) (no real AI, no spend). The operator's exact miss, replayed: "take me to Campaigns and set it up".
//  1. voice go_to Campaigns returns the page's forms (fields, options, lanes); read_page sees them too
//  2. fill_form fills the campaign live (each field lights up); nothing is saved yet
//  3. submit_form puts the confirm card up; confirm_action (after the yes) saves it through the form's own action
//  4. a row form: "Riverside · Inquiry status" filled and saved changes that inquiry only
//  5. outward forms are never pressed: submit_form on an approval decision is refused
//  6. typed Helix sees the screen and fills the expense form; one tap saves it
//   node --env-file=.env.local scripts/verify-helix-forms.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39566;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'an admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email;
const SLUG = 'verify-ga-fall-push';
const clean = async () => {
  await db.from('campaigns').delete().eq('slug', SLUG);
  await db.from('inquiries').delete().like('org', 'Verify Forms%');
  await db.from('expenses').delete().eq('vendor', 'Verify Runway');
  await db.from('helix_threads').delete().eq('user_id', admin.user_id);
};
await clean();
const [riverside, other] = must(await db.from('inquiries').insert([
  { kind: 'agency', name: 'Rita River', email: 'rita@example.com', org: 'Verify Forms Riverside Agency', consent_text: 'I agree to be contacted.', status: 'new' },
  { kind: 'agency', name: 'Omar Other', email: 'omar@example.com', org: 'Verify Forms Other Agency', consent_text: 'I agree to be contacted.', status: 'new' },
]).select('id'), 'inquiries');

// Gemini stand-in: typed Helix fills the expense form when asked, using what it sees on screen.
const screens = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    res.setHeader('content-type', 'application/json');
    if (req.url.includes('auth_tokens')) return res.end(JSON.stringify({ name: 'auth_tokens/verify' }));
    const sysText = j.systemInstruction?.parts?.[0]?.text ?? '';
    screens.push(sysText);
    const asked = JSON.stringify(j.contents?.at(-1) ?? '');
    const reply = /log the runway expense/i.test(asked)
      ? { answer: 'I filled the expense: Verify Runway, $120, AI. Save it?', fill: { form: 'New expense', fields: [{ name: 'vendor', value: 'Verify Runway' }, { name: 'amount', value: '120' }, { name: 'category', value: 'ai' }] }, save: true, followUps: [], drafts: [], remember: [] }
      : { answer: 'Verify typed answer.', followUps: [], drafts: [], remember: [] };
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
  });
}).listen(MOCK);

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '', HELIX_STANDIN: '' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9501, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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

const seen = '["lead-alerts-2026-10-15","helix-confirm-2026-10-15","helix-ptt-2026-10-15","helix-moves-2026-10-15","helix-travels-2026-10-15"]';
const val = (name) => ev(`document.querySelector('form[data-helix-form="campaign"] [name="${name}"]')?.value ?? null`);
const card = () => ev(`document.querySelector('.helix-card.act')?.innerText ?? null`);

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console');
  await ev(`localStorage.setItem('helix-voice', 'on'); localStorage.setItem('genovus-whats-new', '${seen}'); localStorage.setItem('helix-menu-taught', '{"/console/campaigns":3,"/console/inquiries":3,"/console/growth":3,"/console/approvals":3}')`);
  await go('/console');
  await ev(`document.querySelector('.helix-fab')?.click()`);
  await waitFor(async () => (await ev('window.__live.socks.length')) === 1);
  await emit({ setupComplete: {} });

  // 1. "Take me to Campaigns": the page's forms come back with it.
  const g = await tool('go_to', { page: 'Campaigns' });
  const form = (g.onScreen?.forms ?? []).find((f) => f.key === 'New campaign');
  check(g.ok === true && (await ev('location.pathname')) === '/console/campaigns', 'go_to opens Campaigns');
  check(!!form && form.lane === 'internal' && ['slug', 'name', 'channel', 'segment', 'starts', 'budget'].every((n) => form.fields.some((f) => f.name === n)), `and Helix sees the New campaign form and its fields (${(form?.fields ?? []).map((f) => f.name).join(', ')})`);
  check((form?.fields.find((f) => f.name === 'segment')?.options ?? []).some((o) => /captive-agents/.test(o)), 'with the choices for each select');
  const rp = await tool('read_page', {});
  check(rp.page === 'Campaigns' && rp.forms.some((f) => f.key === 'New campaign'), 'read_page sees the same');

  // 2. Fill it live; nothing saved yet.
  const monday = new Date(Date.now() + ((8 - new Date().getDay()) % 7 || 7) * 86_400_000).toISOString().slice(0, 10);
  const fr = await tool('fill_form', { form: 'campaign', fields: [{ name: 'slug', value: SLUG }, { name: 'Name', value: 'Verify GA Fall Push' }, { name: 'channel', value: 'calls' }, { name: 'Audience', value: 'Captive / exclusive agents' }, { name: 'starts', value: monday }, { name: 'Budget (USD)', value: '500' }, { name: 'status', value: 'live' }] });
  check(fr.ok === true && fr.missing.length === 0 && fr.unknown.length === 0, `fill_form fills every field it was given (${JSON.stringify({ filled: fr.filled, unknown: fr.unknown, missing: fr.missing })})`);
  check((await val('slug')) === SLUG && (await val('name')) === 'Verify GA Fall Push' && (await val('segment')) === 'captive-agents' && (await val('starts')) === monday && (await val('budget')) === '500' && (await val('status')) === 'live', 'the form shows the values (labels and option text matched to the real fields)');
  check(!!(await ev(`!!document.querySelector('form[data-helix-form="campaign"] .helix-filled')`)), 'each field lights up as it lands');
  check((await ev(`(() => { const d = document.querySelector('.helix-drawer'); return d ? d.hidden : true; })()`)) === true, 'Ask Helix steps aside so the form is in view (voice keeps going)');
  await send('Page.captureScreenshot', { format: 'png' }).then((s) => fs.writeFileSync(path.join(OUT, 'forms-campaign-filled.png'), Buffer.from(s.result.data, 'base64')));
  check(!(await db.from('campaigns').select('id').eq('slug', SLUG).maybeSingle()).data, 'nothing is saved yet');

  // 3. Save only after the yes.
  const sf = await tool('submit_form', { form: 'campaign' });
  check(sf.ok === true && /Save New campaign\?/.test((await card()) ?? ''), `submit_form puts up the confirm card (“${((await card()) ?? '').split('\n').pop()}”)`);
  check(!(await db.from('campaigns').select('id').eq('slug', SLUG).maybeSingle()).data, 'still nothing saved before the yes');
  const cf = await tool('confirm_action', {});
  check(cf.ok === true && await waitFor(async () => !!(await db.from('campaigns').select('id').eq('slug', SLUG).maybeSingle()).data), 'after the yes, the campaign is saved through the form’s own action');
  const saved = must(await db.from('campaigns').select('name, segment, budget_cents, status, starts_on').eq('slug', SLUG).single(), 'saved');
  check(saved.name === 'Verify GA Fall Push' && saved.segment === 'captive-agents' && saved.budget_cents === 50000 && saved.status === 'live', `with exactly what Helix filled (${JSON.stringify(saved)})`);
  check(await waitFor(async () => /Done: New campaign saved/.test((await ev(`document.querySelector('.helix-drawer')?.innerText`)) ?? '')), 'the thread says Done');

  // 4. A row form: one inquiry's status.
  const gi = await tool('go_to', { page: 'Inquiries' });
  const rowForm = (gi.onScreen?.forms ?? []).find((f) => f.key === 'Verify Forms Riverside Agency · Inquiry status');
  check(!!rowForm, `row forms are named by their row (“Verify Forms Riverside Agency · Inquiry status”)`);
  await tool('fill_form', { form: 'Verify Forms Riverside Agency · Inquiry status', fields: [{ name: 'status', value: 'contacted' }] });
  await tool('submit_form', { form: 'Verify Forms Riverside Agency · Inquiry status' });
  await tool('confirm_action', {});
  check(await waitFor(async () => must(await db.from('inquiries').select('status').eq('id', riverside.id).single(), 'r').status === 'contacted'), 'filling and saving it changes Riverside’s status');
  check(must(await db.from('inquiries').select('status').eq('id', other.id).single(), 'o').status === 'new', 'and no other inquiry');

  // 5. Outward forms are never pressed (Run the scan now spends money).
  const gc = await tool('go_to', { page: 'Carriers & scanner' });
  const scan = (gc.onScreen?.forms ?? []).find((f) => f.key === 'Run the scan now');
  check(!!scan && scan.lane === 'outward', 'Helix sees “Run the scan now” as outward');
  const rs = await tool('submit_form', { form: 'Run the scan now' });
  check(rs.ok === false && /taps it themselves/.test(rs.error ?? '') && !(await card()), 'submit_form on it is refused (no card): the person taps it themselves');

  // 6. Typed: Helix sees the screen and fills the expense form; one tap saves.
  await ev(`localStorage.setItem('helix-voice', 'off')`);
  await go('/console/growth');
  await ev(`document.querySelector('.helix-fab')?.click()`); await sleep(600);
  await ev(`(() => { const i = document.querySelector('.helix-drawer input[aria-label="Ask Helix"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Log the Runway expense, 120 dollars, AI'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`document.querySelector('.helix-drawer form button[type="submit"]')?.click()`);
  check(await waitFor(async () => /Save New expense\?/.test((await card()) ?? ''), 40000), 'typed: Helix fills the expense form and asks to save it');
  check(/ON SCREEN NOW/.test(screens.at(-1) ?? '') && /New expense/.test(screens.at(-1) ?? ''), 'typed Helix was shown the forms on screen');
  check((await ev(`document.querySelector('form[data-helix-form="expense"] [name="vendor"]')?.value`)) === 'Verify Runway', 'the form shows Verify Runway');
  await ev(`[...document.querySelectorAll('.helix-card.act button')].find((b) => /Yes, do it/.test(b.textContent))?.click()`);
  check(await waitFor(async () => !!(await db.from('expenses').select('id').eq('vendor', 'Verify Runway').maybeSingle()).data), 'one tap on Yes saves the expense');
} finally {
  await clean();
  await db.from('helix_tour_sessions').delete().eq('viewer_id', admin.user_id).gte('started_at', new Date(Date.now() - 3600_000).toISOString());
  ws.close(); chrome.kill(); mock.close();
  try { execSync(process.platform === 'win32' ? `taskkill /PID ${dev.pid} /T /F` : `kill ${dev.pid}`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
