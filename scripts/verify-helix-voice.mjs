// Verify voice Ask Helix on the PREVIEW database with a stand-in for Google's token service (no real voice, no spend):
//  1. a signed-out request can't start Enterprise or agency voice
//  2. Enterprise voice gets the same brief and hard lines as typed Ask Helix (Finance only for money roles)
//  3. agency voice gets that agency's brief only
//  4. a note Helix takes by voice lands in Helix notes as Ask Helix, tagged with the account, waiting for review
//  5. the Talk button is on every Enterprise page (Prospects included) and in agency dashboards, and opens voice
// Cleans up its own sessions, notes, grant and temporary operator at the end.
//   node --env-file=.env.local scripts/verify-helix-voice.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39558;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);

const started = new Date().toISOString();
const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
const agency = must(await db.from('tenants').select('id').eq('slug', 'test-launch').single(), 'test agency');
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'an admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email;
const OPS = 'helix-voice-operator@example.com';
const clean = async () => {
  must(await db.from('helix_notes').delete().like('text', 'Verify voice%'), 'clear notes');
  must(await db.from('helix_tour_sessions').delete().in('context', ['enterprise', 'agency']).gte('started_at', started), 'clear sessions');
  must(await db.from('module_grants').delete().eq('reason', 'Verify voice'), 'clear grant');
  for (const x of ((await db.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? []).filter((x) => x.email === OPS)) await db.auth.admin.deleteUser(x.id);
};
await clean();
must(await db.from('module_grants').insert({ tenant_id: agency.id, module_key: 'helix', until: new Date(Date.now() + 86_400_000).toISOString(), reason: 'Verify voice' }), 'helix grant');
const ops = must(await db.auth.admin.createUser({ email: OPS, email_confirm: true }), 'operator').user;
must(await db.from('staff').insert({ user_id: ops.id, role: 'operator', display_name: 'Voice Operator' }), 'operator staff');

// Stand-in for Google's token service: records the locked setup (instructions + tools) each session asks for.
const setups = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    setups.push(j.bidiGenerateContentSetup ?? null);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ name: 'auth_tokens/verify' }));
  });
}).listen(MOCK);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}` };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

const post = (b) => fetch(`${ORIGIN}/api/helix/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
check((await post({ context: 'enterprise' })).status === 403, 'signed out: Enterprise voice is refused');
check((await post({ context: 'agency', slug: 'test-launch' })).status === 401, 'signed out: agency voice is refused');

const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9495, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await cdp('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const shot = async (name) => fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
const signIn = async (email, next) => {
  await cdp('Network.enable'); await cdp('Network.clearBrowserCookies');
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent(next)}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
  for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith(next); i++) await sleep(250);
};
const session = (b) => ev(`fetch('/api/helix/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(b)}) }).then(async (x) => ({ s: x.status, j: await x.json() }))`);
const sys = (s) => s?.systemInstruction?.parts?.[0]?.text ?? '';
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// Admin: Enterprise voice.
await signIn(adminEmail, '/console');
const e1 = await session({ context: 'enterprise' });
const es = setups.at(-1);
check(e1?.s === 200 && e1.j.token === 'auth_tokens/verify' && e1.j.context === 'enterprise', 'admin: Enterprise voice starts');
check(/FINANCE \(last 6 months/.test(sys(es)) && /SALES/.test(sys(es)) && /WHAT HELIX KNOWS/.test(sys(es)), 'Enterprise voice reads the same department brief, with Finance for an admin');
check(/Great question\. I'll make a note of that and send it to the team for review\./.test(sys(es)) && JSON.stringify(es?.tools ?? []).includes('take_note'), 'Enterprise voice has the gap rule and the take_note tool');
const row = must(await db.from('helix_tour_sessions').select('context, tenant_id, is_staff').eq('id', e1.j.sessionId).single(), 'session row');
check(row.context === 'enterprise' && row.tenant_id === house.id, 'the session is recorded as Enterprise Ask Helix');

// A note by voice.
const n = await ev(`fetch('/api/helix/notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: '${e1.j.sessionId}', kind: 'question', text: 'Verify voice: what is our NPS? · missing: NPS is not tracked' }) }).then(async (x) => ({ s: x.status, j: await x.json() }))`);
await sleep(1500);
const note = must(await db.from('helix_notes').select('chapter, tenant_id, status, kind').like('text', 'Verify voice: what is our NPS%').single(), 'voice note');
check(n?.s === 200 && note.chapter === 'ask-helix' && note.tenant_id === house.id && note.kind === 'question' && note.status === 'new', 'a voice note lands in Helix notes as Ask Helix, tagged Enterprise, waiting for review (not auto-handed off)');

// Agency voice (staff viewing the agency).
const a1 = await session({ context: 'agency', slug: 'test-launch' });
const as = setups.at(-1);
const arow = must(await db.from('helix_tour_sessions').select('context, tenant_id').eq('id', a1.j.sessionId).single(), 'agency session');
check(a1?.s === 200 && /LINES THIS AGENCY SELLS/.test(sys(as)) && !/FINANCE \(last 6 months/.test(sys(as)) && arow.tenant_id === agency.id, 'agency voice reads only that agency’s brief');

// The Talk button everywhere, and it opens voice.
for (const p of ['/console', '/console/prospects', '/console/prospects/calls', '/console/growth', '/console/clients/test-launch', '/console/helix/ask']) {
  await go(p);
  check(await ev(`!!document.querySelector('.helix-talk')`), `Talk button on ${p}`);
}
await go('/console/prospects');
const before = setups.length;
await ev(`document.querySelector('.helix-talk').click()`);
for (let i = 0; i < 40 && setups.length === before; i++) await sleep(250);
await sleep(800);
check(setups.length > before && await ev(`!!document.querySelector('.hx-dock')`), 'on Prospects, Talk starts a voice session and opens the voice dock');
await shot('voice-prospects');
await go('/app/test-launch');
check(await ev(`!!document.querySelector('.helix-talk')`), 'Talk button in the agency dashboard');
await ev(`document.querySelector('.helix-fab')?.click()`); await sleep(500);
check(await ev(`!!document.querySelector('.helix-drawer .helix-talk-inline')`), 'Talk is also inside the Ask Helix drawer');
await shot('voice-agency-drawer');

// Operator: no money in voice either.
await signIn(OPS, '/console');
const o1 = await session({ context: 'enterprise' });
check(o1?.s === 200 && /FINANCE: not available to this viewer/.test(sys(setups.at(-1))), 'an operator’s voice session has no Finance');

await clean();
console.log('screenshots in', OUT, '| sessions minted:', setups.length);
try { await cdp('Browser.close'); } catch {}
ws.close(); chrome.kill(); dev.kill(); mock.close();
spawn('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: 'ignore' });
setTimeout(() => process.exit(), 1500);
