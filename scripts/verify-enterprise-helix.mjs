// Verify Enterprise Helix ("Helix Knows") on the PREVIEW database with a Gemini stand-in that records exactly what
// Helix is shown (no real AI calls, no spend):
//  1. AI & production spend now counts on Growth & financials
//  2. the overview opens with Helix's morning brief, and the CFO line for an admin
//  3. the drawer on every console page knows the page; an admin's brief carries Finance
//  4. "Remember this?" → Keep stores a memory (audited), Helix reads it next time; retire removes it
//  5. an operator's brief has no Finance; a signed-out request is refused
// Cleans up its own expense, memories, brief and temporary operator at the end.
//   node --env-file=.env.local scripts/verify-enterprise-helix.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 39557;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);

const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'an admin');
const adminEmail = must(await db.auth.admin.getUserById(admin.user_id), 'admin email').user.email;
const OPS = 'helix-verify-operator@example.com';
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const MEMO = 'Verify: Georgia captive agents reply best before 10 a.m.';
const clean = async () => {
  must(await db.from('expenses').delete().eq('vendor', 'Verify AI'), 'clear expense');
  must(await db.from('helix_memory').delete().eq('tenant_id', house.id).like('text', 'Verify:%'), 'clear memories');
  must(await db.from('helix_briefs').delete().eq('tenant_id', house.id).eq('day', today), 'clear brief');
  const list = (await db.auth.admin.listUsers({ perPage: 1000 })).data?.users ?? [];
  for (const x of list.filter((x) => x.email === OPS)) await db.auth.admin.deleteUser(x.id);
};
await clean();
must(await db.from('expenses').insert({ spent_on: today, category: 'ai', vendor: 'Verify AI', amount_cents: 1234, recurring: false }), 'ai expense');
const ops = must(await db.auth.admin.createUser({ email: OPS, email_confirm: true }), 'operator user').user;
must(await db.from('staff').insert({ user_id: ops.id, role: 'operator', display_name: 'Verify Operator' }), 'operator staff');

// Gemini stand-in: records each system prompt (the brief) and answers with a "Remember this?" suggestion.
const prompts = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => (body += d)); req.on('end', () => {
    const j = JSON.parse(body || '{}');
    prompts.push(j.systemInstruction?.parts?.[0]?.text ?? '');
    const reply = { answer: 'Verify answer: margin is healthy; call the two stuck clients first.', followUps: [], drafts: [], remember: [{ department: 'sales', kind: 'fact', text: MEMO }] };
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }));
  });
}).listen(MOCK);
const env = { ...process.env, GEMINI_API_KEY: 'test', GEMINI_API_BASE: `http://localhost:${MOCK}`, ANTHROPIC_API_KEY: '' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

const anon = await fetch(`${ORIGIN}/api/helix/enterprise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'hi' }) });
check(anon.status === 403, 'Enterprise Helix refuses a signed-out request');

const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9494, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await cdp('Page.navigate', { url: ORIGIN + u }); await l; await sleep(1500); };
const text = () => ev('document.body.innerText');
const waitFor = async (re, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (re.test(await text())) return true; await sleep(250); } return false; };
const shot = async (name, w = 1440, full = true) => {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: w < 600 ? 932 : 900, deviceScaleFactor: 1, mobile: w < 600 }); await sleep(400);
  if (full) { const fh = await ev('Math.min(document.documentElement.scrollHeight, 4200)'); await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: fh, deviceScaleFactor: 1, mobile: w < 600 }); await sleep(300); }
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
};
const signIn = async (email) => {
  await cdp('Network.enable'); await cdp('Network.clearBrowserCookies');
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
  for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith('/console'); i++) await sleep(250);
};
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// Admin.
await signIn(adminEmail);
await go('/console/growth');
let t = await text();
check(/AI & production/i.test(t) && /Owed to us/i.test(t) && /Runway/i.test(t), 'Growth & financials shows AI & production, money owed and runway');
check(/AI \$12/.test(t), 'the $12.34 AI expense now counts in spend');
await go('/console');
check(await waitFor(/Verify answer: margin is healthy/), 'overview opens with Helix’s morning brief');
check(/MRR \$/.test(await text()), 'admin sees the CFO line on the brief');
const briefPrompt = prompts.at(-1) ?? '';
check(/FINANCE: not available/.test(briefPrompt) && !/FINANCE \(last 6 months/.test(briefPrompt), 'the cached morning brief is written without Finance (safe for every role)');
check(!!(await db.from('helix_briefs').select('day').eq('tenant_id', house.id).eq('day', today).maybeSingle()).data, 'the morning brief is cached for the day');
await shot('helix-overview');

await go('/console/growth');
await ev(`document.querySelector('.helix-fab')?.click()`); await sleep(600);
check(/on Growth & financials/.test(await text()) && /Where is margin leaking/.test(await text()), 'the drawer knows the page (Growth) and suggests a money question');
await ev(`[...document.querySelectorAll('.helix-drawer button')].find((b) => /Where is margin leaking/.test(b.textContent))?.click()`);
check(await waitFor(/Remember this\?/), 'Helix answers with a "Remember this?" suggestion');
const adminPrompt = prompts.at(-1) ?? '';
check(/FINANCE \(last 6 months/.test(adminPrompt) && /AI & production \$12/.test(adminPrompt), 'an admin’s brief carries Finance, including AI spend');
check(['SALES', 'PIPELINE', 'CLIENTS & DELIVERY', 'STUDIO', 'SPEND METERS', 'WHAT HELIX KNOWS'].every((h) => adminPrompt.includes(h)), 'the brief covers every department');
await shot('helix-drawer', 1440, false);
await ev(`[...document.querySelectorAll('.helix-card.remember button')][0]?.click()`); await sleep(2000);
const mem = must(await db.from('helix_memory').select('id, status, source, department').eq('tenant_id', house.id).eq('text', MEMO).maybeSingle(), 'memory');
check(mem?.status === 'kept' && mem.source === 'conversation' && mem.department === 'sales', 'one tap on Keep stores the memory (sales, from a conversation)');
const aud = must(await db.from('audit_events').select('action').eq('tenant_id', house.id).eq('action', 'helix.memory.keep').order('id', { ascending: false }).limit(1), 'audit');
check(aud.length === 1, 'keeping a memory is in the audit log');
await ev(`[...document.querySelectorAll('.helix-drawer input')][0] && (() => { const i = document.querySelector('.helix-drawer input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'What do you know about us?'); i.dispatchEvent(new Event('input', { bubbles: true })); i.form.requestSubmit(); })()`);
await sleep(3000);
check((prompts.at(-1) ?? '').includes(MEMO), 'Helix reads the kept memory on the next question');

await go('/console/helix/knows');
check((await text()).includes(MEMO), '"What Helix knows" lists the memory');
await shot('helix-knows');
await ev(`[...document.querySelectorAll('.memory-list button')].find((b) => /Retire/.test(b.textContent))?.click()`); await sleep(2000);
check((await db.from('helix_memory').select('status').eq('id', mem?.id).single()).data?.status === 'retired', 'retire takes it out of what Helix uses');
await go('/console/helix/ask');
check(/Helix Knows/.test(await text()) && !(await ev(`!!document.querySelector('.helix-fab')`)), 'the full Ask view opens (no duplicate drawer button there)');
await shot('helix-ask-phone', 430);

// Operator: no money.
await signIn(OPS);
await go('/console');
await sleep(1500);
check(!/MRR \$/.test(await text()), 'an operator sees the brief without the CFO line');
const r = await ev(`fetch('/api/helix/enterprise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'What is our margin?' }) }).then((x) => x.status)`);
const opsPrompt = prompts.at(-1) ?? '';
check(r === 200 && /FINANCE: not available to this viewer/.test(opsPrompt) && !/FINANCE \(last 6 months/.test(opsPrompt), 'an operator’s brief has no Finance');

await clean();
console.log('screenshots in', OUT, '| prompts seen:', prompts.length);
try { await cdp('Browser.close'); } catch {}
ws.close(); chrome.kill(); dev.kill(); mock.close();
spawn('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: 'ignore' });
setTimeout(() => process.exit(), 1500);
