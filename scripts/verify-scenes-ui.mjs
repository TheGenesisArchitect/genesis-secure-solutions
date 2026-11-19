// Verify the scene plan in the real app on the PREVIEW database, with a stand-in for Claude (no spend): a throwaway
// newsroom story and package, the Scenes tab, pasting the article (openai.com refuses servers), Draft, the checked
// proposals on desktop and phone, Add to the sheet, and the sheet carrying the scene lines. Cleans up after itself.
//   node --env-file=.env.local scripts/verify-scenes-ui.mjs <article.txt> [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const ARTICLE = fs.readFileSync(process.argv[2], 'utf8');
const OUT = process.argv[3] || path.join(os.tmpdir(), 'genovus-verify-scenes');
fs.mkdirSync(OUT, { recursive: true });
const PORT = 3913, ORIGIN = `http://localhost:${PORT}`, MOCK = 3933;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };

// The stand-in Claude reply: three proposals that pass, one built on chart-only numbers that must not.
const reply = { scenes: [
  { type: 'assembly', title: 'A mechanical system, part by part', facts: [], source: 'OpenAI', why: 'Mechanical design and assembly', say: 'model a mechanical system part by part',
    passage: 'GPT-6.2 Astra can model a mechanical system part by part, giving engineers a way to show how it goes together and test how design changes affect its behavior.' },
  { type: 'cad', title: 'Down to individual parts in CAD', facts: [], source: 'OpenAI', why: 'Computer use in CAD and simulation tools', say: 'down to individual parts in CAD',
    passage: 'GPT‑6.2 Astra’s more precise computer use lets it work down to individual parts and connections in CAD and simulation tools.' },
  { type: 'model', title: 'GPT-6.2 Astra — the professional flagship', facts: ['Input, per million tokens: $8', 'Cached input, per million tokens: $0.40', 'Output, per million tokens: $40'], source: 'OpenAI', why: 'API pricing', say: 'priced at eight dollars per million',
    passage: 'In the API, GPT‑6.2 Astra’s input and output token prices are 20% lower than GPT‑6 Astra’s, with a 60% discount on cached input ($8 for input, $0.40 for cached input, and $40 for output, all per million tokens).' },
  { type: 'bench', title: 'GPT-6.2 Astra vs GPT-6 Astra', facts: ['BenchCAD 2.1 Core: 62.6% → 82.5%', 'AutomationBench: 41.4% → 52.4%'], source: 'OpenAI-reported', why: 'benchmarks', say: 'OpenAI just dropped GPT',
    passage: 'GPT‑6.2 Astra’s more precise computer use lets it work down to individual parts and connections in CAD and simulation tools.' },
] };
let calls = 0;
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.endsWith('/v1/messages')) { calls++; return res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }], stop_reason: 'end_turn', usage: { input_tokens: 9000, output_tokens: 1200 } })); }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => mock.listen(MOCK, r));

// A throwaway story and package on the house desk.
const tenant = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'tenant').id;
const script = [
  { part: 'Hook', lines: [{ say: 'OpenAI just dropped GPT 6.2 Astra and Sol.', source: '' }, { say: 'Astra is priced at eight dollars per million input tokens.', source: '' }] },
  { part: 'What it does', lines: [{ say: 'It can work down to individual parts in CAD and simulation tools.', source: '' }, { say: 'It can model a mechanical system part by part and show how it goes together.', source: '' }] },
];
const story = must(await db.from('newsroom_stories').insert({ tenant_id: tenant, beat: 'ai', headline: 'GPT-6.2 Astra and Sol (scene plan check)', source: 'openai.com', url: `https://openai.com/index/introducing-gpt-6-2-astra-sol/?verify=${Date.now()}`, status: 'drafting' }).select('id, url').single(), 'story');
const prod = must(await db.from('newsroom_productions').insert({ tenant_id: tenant, story_id: story.id, angle: 'What Astra builds', formats: ['long'], outputs: { script, teleprompter: script.flatMap((p) => p.lines.map((l) => l.say)).join('\n'), sheet: 'source | OpenAI just dropped GPT | openai.com · Nov 2026' } }).select('id').single(), 'production');

const env = { ...process.env, ANTHROPIC_API_KEY: 'stand-in', ANTHROPIC_API_BASE: `http://localhost:${MOCK}`, HELIX_STANDIN: '1' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9497, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scenes-chrome-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find((x) => x.type === 'page').webSocketDebuggerUrl);
let cid = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const cdp = (method, params = {}) => new Promise((r) => { const i = ++cid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable'); await cdp('Runtime.enable');
const errors = [];
on.set('Runtime.exceptionThrown', (p) => errors.push(String(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text).slice(0, 300)));
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await cdp('Page.navigate', { url: ORIGIN + u }); await l; await sleep(2500); };
const size = (w, h, mobile = false) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
const shot = async (name, w, h, mobile = false) => { await size(w, h, mobile); await sleep(800); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).result.data, 'base64')); };
const waitFor = async (fn, ms = 60000) => { for (let i = 0; i < ms / 500; i++) { const v = await fn(); if (v) return v; await sleep(500); } return null; };
let vlogId = null;
const click = (re) => ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => ${re}.test(x.textContent) && !x.disabled); b && b.click(); return !!b; })()`);

try {
  await size(1440, 1000);
  const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
  const email = must(await db.auth.admin.getUserById(admin.user_id), 'email').user.email;
  const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
  await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console/studio/unedit/newsroom')}`);
  await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
  for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith('/console'); i++) await sleep(250);

  await go(`/console/studio/unedit/newsroom?story=${story.id}`);
  check(await waitFor(() => click('/^Scenes$/')), 'the package has a Scenes tab');
  check(await waitFor(() => ev(`/Draft the scene plan/.test(document.body.innerText)`)), 'the tab offers to draft the plan from the article');
  check(await ev(`document.querySelector('#sp-url')?.value === ${JSON.stringify(story.url)}`), 'the story’s own link is filled in');
  // openai.com refuses servers: paste the article (a controlled textarea needs the native setter and an input event).
  await ev(`(() => { const d = document.querySelector('.sp-form details'); d.open = true; const t = document.querySelector('#sp-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(ARTICLE)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await shot('scenes-0-draft', 1440, 1000);
  check(await click('/Draft the scene plan/'), 'Draft is pressed with the pasted article');
  check(await waitFor(() => ev(`document.querySelectorAll('.sp-scene').length === 3`), 90000), 'three checked scenes appear (the chart-number one is left out)');
  check(calls === 1, 'one Claude call');
  check(await ev(`/1 didn’t pass the checks/.test(document.body.innerText)`), 'the card says one proposal didn’t pass');
  check(await ev(`document.querySelectorAll('.sp-scene.on').length === 3 && /Add 3 scenes to the sheet/.test(document.body.innerText)`), 'all three placeable scenes are picked');
  check(await ev(`/3D assembly/i.test(document.body.innerText) && /\\$0\\.40/.test(document.body.innerText)`), 'the type and the article’s numbers show');
  await ev(`document.querySelector('.sp')?.scrollIntoView({ block: 'start' })`);
  await shot('scenes-1-plan-desktop', 1440, 1100);
  await size(390, 844, true); await sleep(500); await ev(`document.querySelector('.sp')?.scrollIntoView({ block: 'start' })`);
  await shot('scenes-2-plan-phone', 390, 844, true);
  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'no sideways scroll on a phone');
  await size(1440, 1000);
  const run = must(await db.from('newsroom_runs').select('kind, cost_cents, stories').eq('story_id', story.id).eq('kind', 'scenes'), 'runs');
  check(run.length === 1 && run[0].cost_cents > 0 && run[0].stories === 3, 'the run is recorded and costed against the Studio budget');

  check(await click('/Add 3 scenes to the sheet/'), 'Add is pressed');
  const sheet = await waitFor(async () => { const p = must(await db.from('newsroom_productions').select('outputs').eq('id', prod.id).single(), 'prod'); return /scene \|/.test(p.outputs.sheet ?? '') ? p.outputs : null; }, 30000);
  check(sheet && sheet.sheet.split('\n').filter((l) => l.startsWith('scene |')).length === 3 && sheet.sheet.startsWith('source |'), 'the sheet carries three scene lines and keeps its source line');
  check(sheet?.scenePlan?.approved?.keep?.length === 3, 'the plan records what was approved');
  await go(`/console/studio/unedit/newsroom?story=${story.id}`);
  await waitFor(() => click('/^Sources sheet$/'));
  check(await waitFor(() => ev(`/scene \\| model a mechanical system part by part \\| assembly/.test(document.body.innerText)`)), 'the Sources sheet tab shows the scene lines');
  await shot('scenes-3-sheet', 1440, 1000);
  // ---- After recording: the same plan on a recording's card, spoken words from its transcript ----
  const { put } = await import('@vercel/blob');
  const said = script.flatMap((p) => p.lines.map((l) => l.say)).join(' ');
  let t = 0; const words = said.split(/\s+/).map((w) => ({ w: w.replace(/[.,]/g, ''), s: +(t += 0.38).toFixed(2) - 0.38, e: +t.toFixed(2) }));
  const tpath = `studio/vlogs/verify-scenes-${Date.now()}/transcript.json`;
  await put(tpath, JSON.stringify({ provider: 'deepgram', words }), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
  const hex = (n) => [...Array(64)].map(() => '0123456789abcdef'[(Math.random() * 16) | 0]).join('');
  vlogId = must(await db.from('unedit_vlogs').insert({ tenant_id: tenant, title: 'GPT-6.2 Astra (scene plan check)', file_name: 'check.mp4', blob_path: `studio/vlogs/verify-scenes-${Date.now()}/take.mp4`, blob_url: 'https://example.invalid/take.mp4', bytes: 1, fingerprint: `1:${hex()}:${hex()}`, stage: 'review', transcript_blob: tpath, words: words.length, duration_s: t }).select('id').single(), 'vlog').id;
  await go(`/console/studio/unedit/${vlogId}`);
  check(await waitFor(() => ev(`/Draft the scene plan/.test(document.body.innerText)`)), 'the recording card has the scene plan panel');
  await ev(`(() => { document.querySelector('.sp-form details').open = true; const t = document.querySelector('#sp-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(ARTICLE)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  check(await click('/Draft the scene plan/'), 'Draft is pressed on the card');
  check(await waitFor(() => ev(`document.querySelectorAll('.sp-scene').length === 3`), 90000), 'three scenes on the card, placed against the transcript');
  check(await ev(`!/Spoken words not found/.test(document.querySelector('.sp')?.innerText ?? '')`), 'every scene’s words are found in the recording');
  await ev(`document.querySelector('.sp')?.scrollIntoView({ block: 'start' })`);
  await shot('scenes-4-card', 1440, 1100);
  check(await click('/Add 3 scenes to the sheet/'), 'Add is pressed on the card');
  const v = await waitFor(async () => { const r = must(await db.from('unedit_vlogs').select('sources, scene_plan').eq('id', vlogId).single(), 'vlog'); return (r.sources ?? []).filter((e) => e.kind === 'scene').length === 3 && r.scene_plan?.approved ? r : null; }, 30000);
  check(v && v.scene_plan?.approved?.keep?.length === 3, 'the recording’s sheet has the three scenes and the plan records the approval');
  if (!v) console.log('      card says:', await ev(`[...document.querySelectorAll('[role=status], .toast, [class*=toast]')].map((x) => x.innerText).join(' | ').slice(0, 400)`), '| db:', JSON.stringify(must(await db.from('unedit_vlogs').select('sources, scene_plan').eq('id', vlogId).single(), 'v').sources)?.slice(0, 300));

  check(!errors.length, `no page errors${errors.length ? `: ${errors[0]}` : ''}`);
} finally {
  if (vlogId) await db.from('unedit_vlogs').delete().eq('id', vlogId);
  await db.from('newsroom_runs').delete().eq('story_id', story.id);
  await db.from('newsroom_productions').delete().eq('id', prod.id);
  await db.from('newsroom_stories').delete().eq('id', story.id);
  ws.close(); chrome.kill(); mock.close();
  // Stop the dev server by its port's PID only.
  try { const { execFileSync } = await import('node:child_process'); const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' }); const pid = out.split('\n').find((l) => l.includes(`:${PORT} `) && /LISTENING/.test(l))?.trim().split(/\s+/).pop(); if (pid) execFileSync('taskkill', ['/PID', pid, '/T', '/F']); } catch {}
  dev.kill();
  console.log(`screens in ${OUT}`);
}
