// Verify Helix onboarding a prospect (migration 0078, lib/helix-prospects.ts) on the PREVIEW database, with stand-ins
// for Gemini (typed and the Live socket) and Google Places. The operator's meeting, replayed:
//  1. typed Helix finds "Tyson Barrett" among the prospects (one Google search matched to our own list) and answers
//     with the office's live details and its page; nothing of Google's is stored
//  2. an agency member can't use the prospect lookups or read prospects
//  3. voice: prospect_card finds him; on his page Helix reads the "Start onboarding" form, fills it live, and saves it
//     only after the yes: the client exists in Consult with its draft record and the seven launch gates, the prospect
//     is linked and in Consult, and the new client opens
//  4. only an admin or account lead can start onboarding
//   node --env-file=.env.local scripts/verify-helix-onboarding.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39631;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const db = createClient(URL_, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'an admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email;
// Each run its own client address: clients can't be deleted (the audit trail keeps them), so test clients are
// marked as samples afterwards, out of every real list.
const PLACE = 'verify-onb-tyson', SLUG = `verify-barrett-${Date.now().toString(36)}`, OPS = 'verify-onb-ops@genovus.example';
const users = async () => (await db.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? [];
const saved = must(await db.from('app_settings').select('key, value').eq('key', 'scan_budget_usd'), 'budget');
const clean = async () => {
  await db.from('tenants').update({ is_sample: true, name: 'Verify onboarding (test)' }).like('slug', 'verify-barrett-%');
  await db.from('module_grants').update({ revoked_at: new Date().toISOString() }).in('tenant_id', ((await db.from('tenants').select('id').like('slug', 'verify-barrett-%')).data ?? []).map((x) => x.id)).is('revoked_at', null);
  await db.from('prospects').delete().eq('place_id', PLACE);
  await db.from('helix_threads').delete().eq('user_id', admin.user_id);
  for (const x of (await users()).filter((x) => x.email === OPS)) { await db.from('staff').delete().eq('user_id', x.id); await db.auth.admin.deleteUser(x.id); }
};
await clean();
// Google lookups on for the run (restored after).
must(await db.from('app_settings').upsert({ key: 'scan_budget_usd', value: '100000', updated_at: new Date().toISOString() }), 'budget on');
const carrier = (await db.from('carriers').select('id, name').ilike('name', '%state farm%').limit(1).maybeSingle()).data;
const pr = must(await db.from('prospects').insert({ place_id: PLACE, segment: 'captive', state: 'GA', fit_score: 97, status: 'contacting', carrier_id: carrier?.id ?? null }).select('id, code').single(), 'prospect');
const ops = must(await db.auth.admin.createUser({ email: OPS, email_confirm: true }), 'operator').user;
must(await db.from('staff').insert({ user_id: ops.id, role: 'operator', display_name: 'Verify Onboarding Ops' }), 'ops staff');

// Stand-ins: Google Places (Tyson's office) and Gemini (typed Helix looks him up, then answers from the lookup).
let searches = 0;
const OFFICE = { displayName: { text: 'Tyson Barrett - State Farm Insurance Agent' }, formattedAddress: '1200 Broadway, Columbus, GA 31901, USA', nationalPhoneNumber: '(706) 555-0123', websiteUri: 'https://www.statefarm.com/agent/us/ga/columbus/tyson-barrett', businessStatus: 'OPERATIONAL' };
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/v1/places:searchText')) {
      searches++;
      const q = JSON.parse(body || '{}').textQuery ?? '';
      return res.end(JSON.stringify({ places: /tyson barrett/i.test(q) ? [{ id: 'verify-someone-else' }, { id: PLACE, displayName: OFFICE.displayName }] : [] }));
    }
    if (req.url.startsWith('/v1/places/')) return res.end(JSON.stringify(decodeURIComponent(req.url).includes(PLACE) ? OFFICE : {}));
    const j = JSON.parse(body || '{}');
    if (req.url.includes('auth_tokens')) return res.end(JSON.stringify({ name: 'auth_tokens/verify' }));
    const sys = j.systemInstruction?.parts?.[0]?.text ?? '';
    const asked = JSON.stringify(j.contents?.at(-1) ?? '');
    let reply = { answer: 'Verify typed answer.', followUps: [], drafts: [], remember: [] };
    if (/take me to tyson barrett/i.test(asked)) reply = { answer: 'Opening Tyson Barrett’s page.', open: { kind: 'prospect', name: 'Tyson Barrett' }, followUps: [], drafts: [], remember: [] };
    if (/who is tyson barrett/i.test(asked)) {
      const m = sys.match(/"name":"([^"]+)","address":"([^"]+)"/), open = sys.match(/"open":"([^"]+)"/);
      reply = /LOOKUP prospect_card/.test(sys) ? { answer: `${m?.[1]} at ${m?.[2]} (${open?.[1]})`, followUps: [], drafts: [], remember: [] } : { lookup: { tool: 'prospect_card', args: { name: 'Tyson Barrett' } }, answer: 'One moment.' };
    }
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
  });
}).listen(MOCK);

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '', HELIX_STANDIN: '', PLACES_API_BASE: `http://localhost:${MOCK}/v1`, GOOGLE_PLACES_API_KEY: 'test' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email: adminEmail }), 'link');
const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9561, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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
const waitFor = async (fn, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await fn()) return true; await sleep(250); } return false; };
const emit = (m) => ev(`window.__live.emit(${JSON.stringify(m)})`);
let callN = 0;
const tool = async (name, args) => {
  const callId = `v${++callN}`;
  await emit({ toolCall: { functionCalls: [{ id: callId, name, args }] } });
  let out = null;
  await waitFor(async () => { out = await ev(`(() => { const r = window.__live.sent.flatMap((m) => m.toolResponse?.functionResponses ?? []).find((f) => f.id === '${callId}'); return r ? r.response.result : null; })()`); return !!out; }, 20000);
  return out ?? {};
};
const shot = async (name) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(s.result.data, 'base64')); };
const seen = '["lead-alerts-2026-10-15","helix-confirm-2026-10-15","helix-ptt-2026-10-15","helix-moves-2026-10-15","helix-travels-2026-10-15"]';
const signedIn = async (email) => { const l = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link'); const c = createClient(URL_, ANON, { auth: { persistSession: false } }); must(await c.auth.verifyOtp({ token_hash: l.properties.hashed_token, type: 'magiclink' }), 'sign in'); return c; };

try {
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); })()`);
  await waitFor(async () => (await ev('location.pathname')) === '/console');
  await ev(`localStorage.setItem('helix-voice', 'off'); localStorage.setItem('genovus-whats-new', '${seen}')`);

  // 1. typed: "Who is Tyson Barrett?"
  const typed = await ev(`fetch('/api/helix/enterprise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Who is Tyson Barrett?' }) }).then((r) => r.json())`);
  check(/^Tyson Barrett - State Farm Insurance Agent at 1200 Broadway/.test(typed?.answer ?? '') && (typed?.answer ?? '').includes(`/console/prospects/${pr.code}`), `typed Helix finds Tyson among the prospects and answers with his office and its page (${typed?.answer ?? typed?.error})`);
  check(searches === 1 && !must(await db.from('prospects').select('known_name').eq('id', pr.id).single(), 'kn').known_name, `one Google search, matched to our own list; nothing of Google’s is stored (${searches} search)`);

  // 2. an agency member can't use them
  const owner = await signedIn('owner@test-launch.example');
  const ownerRows = (await owner.from('prospects').select('id').eq('id', pr.id)).data ?? [];
  const ownerConvert = await owner.rpc('convert_prospect', { p_id: pr.id, p_slug: 'verify-nope-agency', p_name: 'Nope' });
  check(ownerRows.length === 0 && !!ownerConvert.error, 'an agency member can’t read prospects or start onboarding');

  // 1b. typed: "Take me to Tyson Barrett" opens his page
  const typedOpen = await ev(`fetch('/api/helix/enterprise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Take me to Tyson Barrett' }) }).then((r) => r.json())`);
  check(typedOpen?.go?.href === `/console/prospects/${pr.code}`, `typed: “take me to Tyson Barrett” opens his page (${JSON.stringify(typedOpen?.go)})`);

  // 3. voice, starting on the full Ask Helix page: the same conversation all the way through
  await ev(`localStorage.setItem('helix-voice', 'on')`);
  await go('/console/helix/ask');
  check(await waitFor(async () => await ev(`!!document.querySelector('.helix-drawer.full:not([hidden])')`), 10000), 'the full Ask Helix page is the same drawer, open wide');
  await ev(`[...document.querySelectorAll('.helix-drawer button')].find((b) => /^(Talk|Start)$/.test(b.textContent.trim()))?.click()`);
  await waitFor(async () => (await ev('window.__live.socks.length')) === 1);
  await emit({ setupComplete: {} });
  await emit({ serverContent: { inputTranscription: { text: 'Who is Tyson Barrett?' } } }); await emit({ serverContent: { outputTranscription: { text: 'He is a State Farm agent in Columbus.' } } }); await emit({ serverContent: { turnComplete: true } }); await sleep(800);
  const oi = await tool('open_item', { kind: 'prospect', name: 'Tyson Barrett' });
  check(oi.ok === true && (await ev('location.pathname')) === `/console/prospects/${pr.code}` && (oi.onScreen?.forms ?? []).some((f) => /onboarding/i.test(f.key)), `voice: “take me to his onboarding” opens his page and sees the form (${oi.opened ?? oi.error})`);
  check((await ev('window.__live.socks.length')) === 1 && (await ev(`window.__live.socks[0].readyState`)) === 1, 'the same voice session carries on from the full Ask page to his page (no restart)');
  check(/State Farm agent in Columbus/.test((await ev(`document.querySelector('.helix-drawer')?.innerText`)) ?? ''), 'and the conversation so far is still on screen');
  const bad = await tool('open_item', { kind: 'client', name: 'Nobody At All Agency' });
  check(bad.ok === false && (await ev('location.pathname')) === `/console/prospects/${pr.code}`, `an unknown name opens nothing (${bad.error})`);
  const setup = await ev(`JSON.stringify(window.__live.sent.find((m) => m.setup)?.setup?.tools ?? [])`);
  check(/prospect_card/.test(setup ?? '') && /prospect_list/.test(setup ?? ''), 'voice Helix has the prospect tools');
  const pc = await tool('prospect_card', { name: 'Tyson Barrett' });
  check(pc.found === true && pc.code === pr.code && pc.phone === '(706) 555-0123' && !!pc.status, `voice: prospect_card finds him (${pc.name}, ${pc.carrier}, ${pc.status})`);
  const rp = await tool('read_page', {});
  const form = (rp.forms ?? []).find((f) => /onboarding/i.test(f.key));
  check(!!form && form.lane === 'internal' && ['name', 'slug', 'contact', 'email', 'phone', 'city', 'state'].every((n) => form.fields.some((f) => f.name === n)), `Helix sees the Start onboarding form (${(form?.fields ?? []).map((f) => f.name).join(', ')})`);
  const fr = await tool('fill_form', { form: form?.key ?? 'Start onboarding', fields: [{ name: 'name', value: 'Barrett Insurance Agency' }, { name: 'slug', value: SLUG }, { name: 'contact', value: 'Tyson Barrett' }, { name: 'email', value: 'tyson@example.com' }, { name: 'city', value: 'Columbus' }, { name: 'package', value: 'Growth' }, { name: 'note', value: 'Growth package; kickoff next week' }] });
  check(fr.ok === true && (fr.missing ?? []).length === 0, `fill_form fills it live (${JSON.stringify({ filled: fr.filled, missing: fr.missing, unknown: fr.unknown })})`);
  await shot('onboarding-filled');
  check(!(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle()).data, 'nothing is created before the yes');
  const sf = await tool('submit_form', { form: form?.key ?? 'Start onboarding' });
  check(sf.ok === true, 'submit_form puts up the confirm card');
  await tool('confirm_action', {});
  check(await waitFor(async () => !!(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle()).data, 20000), 'after the yes, the client is created');
  const t = (await db.from('tenants').select('id, name, stage').eq('slug', SLUG).maybeSingle()).data;
  if (t) {
    const rec = must(await db.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).single(), 'record');
    const gates = must(await db.from('gates').select('kind').eq('tenant_id', t.id), 'gates');
    const p2 = must(await db.from('prospects').select('status, tenant_id, contact_name').eq('id', pr.id).single(), 'prospect after');
    check(t.name === 'Barrett Insurance Agency' && t.stage === 'consult' && gates.length === 7, `in Consult with the seven launch gates (${t.name}, ${gates.length} gates)`);
    check(rec.data.agencyName === 'Barrett Insurance Agency' && rec.data.contactName === 'Tyson Barrett' && rec.data.email === 'tyson@example.com' && rec.data.phone === '(706) 555-0123' && rec.data.prospectCode === pr.code, `its draft record carries what was confirmed (${JSON.stringify(rec.data)})`);
    check(p2.status === 'consult' && p2.tenant_id === t.id && p2.contact_name === 'Tyson Barrett', 'the prospect is linked to the client and in Consult');
    check(await waitFor(async () => (await ev('location.pathname')) === `/console/clients/${SLUG}`, 15000), `and the new client opens (${await ev('location.pathname')})`);
    await shot('onboarding-client');
    // The package: its features as a 30-day trial, exactly Growth's; the plan and billing untouched.
    const { MODULES, includes } = await import('../lib/programs.ts').catch(() => ({}));
    const grants = must(await db.from('module_grants').select('module_key, until, reason').eq('tenant_id', t.id).is('revoked_at', null), 'grants');
    const want = MODULES ? MODULES.filter((m) => includes('growth', m) && !includes('launch', m)).map((m) => m.key).sort() : null;
    const days = grants[0] ? (Date.parse(grants[0].until) - Date.now()) / 86_400_000 : 0;
    check(want && JSON.stringify(grants.map((g) => g.module_key).sort()) === JSON.stringify(want) && days > 29 && days < 31 && /Onboarding: Growth/.test(grants[0].reason), `Growth’s features are on as a 30-day trial, exactly the package (${grants.length} modules)`);
    const tt = must(await db.from('tenants').select('plan, care_active').eq('id', t.id).single(), 'plan');
    const inv = (await db.from('invoices').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id)).count;
    check(tt.plan == null && !tt.care_active && !inv && rec.data.package === 'growth', 'the plan changes only when the invoice is paid: no plan set, no care billing, no invoice; the package is on the record');
    const cfgAsset = (await db.from('assets').select('location, audience').eq('tenant_id', t.id).eq('title', 'Website config (draft)').maybeSingle()).data;
    const task = (await db.from('care_requests').select('detail').eq('tenant_id', t.id).eq('title', 'Build the website').maybeSingle()).data;
    check(cfgAsset?.audience === 'internal' && cfgAsset.location === `/api/clients/${SLUG}/site-config` && /Growth package/.test(task?.detail ?? '') && /carrier/i.test(task?.detail ?? ''), 'the website starts with the record: a draft site config on the client and a “Build the website” task with the launch checklist');
    const cfgText = await ev(`fetch('/api/clients/${SLUG}/site-config').then((r) => r.text())`);
    check(/name: "Barrett Insurance Agency"/.test(cfgText) && cfgText.includes('phoneE164: "+17065550123"') && /Package: Growth/.test(cfgText) && /TODO/.test(cfgText), `the draft config is written from the record, with TODOs where it doesn’t know yet`);
    const ownerCfg = await fetch(`${ORIGIN}/api/clients/${SLUG}/site-config`);
    check(ownerCfg.status === 403, 'the draft config is Genovus-team only');
  }

  // 4. who can
  const asOps = await signedIn(OPS);
  const denied = await asOps.rpc('convert_prospect', { p_id: pr.id, p_slug: 'verify-nope-agency', p_name: 'Nope' });
  check(!!denied.error, `an operator can’t start onboarding (${denied.error?.message})`);
  check(!(await db.from('tenants').select('id').eq('slug', 'verify-nope-agency').maybeSingle()).data, 'and nothing was created');
} finally {
  await clean();
  for (const s of saved) await db.from('app_settings').update({ value: s.value }).eq('key', s.key);
  if (!saved.length) await db.from('app_settings').delete().eq('key', 'scan_budget_usd');
  await db.from('helix_tour_sessions').delete().eq('viewer_id', admin.user_id).gte('started_at', new Date(Date.now() - 3600_000).toISOString());
  ws.close(); chrome.kill(); mock.close();
  try { execSync(process.platform === 'win32' ? `taskkill /PID ${dev.pid} /T /F` : `kill ${dev.pid}`, { stdio: 'ignore' }); } catch {}
}
console.log(`screenshots in ${OUT} | ${failed ? `${failed} FAILED` : 'all passed'}`);
process.exit(failed ? 1 : 0);
