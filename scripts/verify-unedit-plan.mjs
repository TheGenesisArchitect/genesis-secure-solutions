// Verify UnEdit's posting plan on the PREVIEW database, with a stand-in Metricool (nothing posts anywhere):
// the Approve card's three choices (Post now, Helix plan, My calendar) on desktop and phone; Post now sends every post;
// a planned campaign sends only what is due and keeps the rest on the calendar; one Approve takes every ready clip and
// keeps left-out clips out; a clip still being cut holds the Approve; the calendar on Recordings; moving a post makes
// it due and the sweep sends exactly it, once, even with two steps at the same time; cancel; a sent post is locked.
//   node --env-file=.env.local scripts/verify-unedit-plan.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify-unedit-plan');
const PORT = 3913, ORIGIN = `http://localhost:${PORT}`, MOCK = 3918;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy`);

// ---- Stand-in Metricool: records every scheduled post. ----
const mcPosts = [];
const mock = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const [p] = req.url.slice(3).split('?');
    if (req.method === 'POST' && p === '/v2/scheduler/posts') { const b = JSON.parse(Buffer.concat(chunks).toString() || '{}'); const id = 920000 + mcPosts.length; mcPosts.push({ id, body: b }); return send({ data: { id, ...b } }); }
    if (req.method === 'GET' && p === '/admin/simpleProfiles') return send([{ id: 7426930, label: 'Genovus Intelliware', facebook: 'g', instagram: 'g', youtube: 'g' }]);
    const m = p.match(/^\/v2\/scheduler\/posts\/(\d+)$/);
    if (m) return send({ data: { id: Number(m[1]), providers: [{ network: 'instagram', status: 'PENDING' }] } });
    if (req.method === 'GET' && p === '/v2/scheduler/posts') return send({ data: [] });
    send({ error: 'not found' }, 404);
  });
});
await new Promise((r) => mock.listen(MOCK, r));

// ---- Test campaigns, straight into review (no rendering needed to test posting). ----
const tenant = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'tenant').id;
const created = [];
async function seed(name, statuses) {
  const id = randomUUID();
  must(await db.from('unedit_vlogs').insert({
    id, tenant_id: tenant, title: `Verify plan ${name}`, file_name: 'verify.mp4', blob_path: `studio/vlogs/uploads/verify-plan-${id}.mp4`, blob_url: 'https://example.invalid/v.mp4', bytes: 1000,
    fingerprint: `1000:${randomBytes(32).toString('hex')}:${randomBytes(32).toString('hex')}`, stage: 'review', episode: { title: `Verify plan ${name}`, description: 'Posting plan test.' },
  }), `vlog ${name}`);
  created.push(id);
  must(await db.from('unedit_clips').insert(statuses.map((s, i) => ({
    tenant_id: tenant, vlog_id: id, n: i + 1, start_s: i * 20, end_s: i * 20 + 18, hook_start_s: i === 1 ? i * 20 : null, title: `Clip ${i + 1} ${name}`, caption: `Caption ${i + 1}`,
    copy: { instagram: `IG ${i + 1}`, facebook: `FB ${i + 1}`, youtube: `YT ${i + 1}` }, blob_path: `studio/vlogs/${id}/clip-${i + 1}.mp4`, secs: 18, status: s,
  }))), `clips ${name}`);
  return id;
}
const A = await seed('A', ['ready', 'ready', 'dropped']);          // Post now: 2 clips go, the left-out one stays out
const B = await seed('B', ['ready', 'approved', 'ready']);         // Helix plan: drip
const C = await seed('C', ['ready', 'rendering']);                 // a clip still being cut holds the Approve
const D = await seed('D', ['ready', 'ready', 'ready', 'ready']);   // the card UI

const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const email = must(await db.auth.admin.getUserById(admin.user_id), 'email').user.email;
const SECRET = process.env.CRON_SECRET || 'verify-unedit-plan-local';
const env = { ...process.env, CRON_SECRET: SECRET, HELIX_STANDIN: '1', ANTHROPIC_API_KEY: 'stand-in', METRICOOL_API_BASE: `http://localhost:${MOCK}/mc`, METRICOOL_GENOVUS_API_KEY: 'stand-in-metricool', METRICOOL_MODE: '', APP_ORIGIN: ORIGIN };
const devLog = process.env.DEV_LOG ? fs.openSync(process.env.DEV_LOG, 'w') : 'ignore';
spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: ['ignore', devLog, devLog], shell: true, env });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9498, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'unedit-plan-chrome-'));
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
on.set('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300)); });
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await cdp('Page.navigate', { url: ORIGIN + u }); await l; await sleep(2500); };
const size = (w, h, mobile = false) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
const shot = async (name, w = 1440, h = 1400, mobile = false) => { await size(w, h, mobile); await sleep(700); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
const waitFor = async (fn, ms = 60000) => { for (let i = 0; i < ms / 1000; i++) { const v = await fn(); if (v) return v; await sleep(1000); } return null; };
const api = (body) => ev(`fetch('/api/studio/unedit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }).then(async (r) => ({ status: r.status, ...(await r.json()) }))`);
const step = (id) => fetch(`${ORIGIN}/api/studio/unedit/${id}/step`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } }).then((r) => r.json());
const vlog = async (id) => must(await db.from('unedit_vlogs').select('*').eq('id', id).single(), 'vlog');
const postsOf = async (id) => must(await db.from('unedit_posts').select('*').eq('vlog_id', id).order('scheduled_at'), 'posts');
const clicky = (sel, text) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); b?.click(); return !!b; })()`);

await size(1440, 1000);
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console/studio/unedit')}`);
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith('/console'); i++) await sleep(250);

try {
  // ---- The card: three choices, Helix's plan by default ----
  await go(`/console/studio/unedit/${D}`);
  await waitFor(() => ev(`!!document.querySelector('.ue-days li')`), 20000);
  check(await ev(`[...document.querySelectorAll('.ue-seg button')].map((b) => b.textContent).join('|') === 'Post now|Helix plan|My calendar'`), 'the Approve offers Post now, Helix plan and My calendar');
  check(await ev(`document.querySelector('.ue-seg button.on')?.textContent === 'Helix plan'`), 'Helix plan is the default');
  const why = await ev(`document.querySelector('.ue-plan-why')?.innerText ?? ''`);
  check(/Steady/.test(why) && /isn’t tied to a news story/.test(why), `a recording with no story gets Steady with the reason (${why.split('\n').slice(0, 2).join(' / ')})`);
  const label = await ev(`document.querySelector('.ue-approve .btn.primary')?.textContent ?? ''`);
  check(/^Approve 13 posts · Steady · first /.test(label), `the button names the count, rhythm and first slot (${label})`);
  check(await ev(`document.querySelectorAll('.ue-bars i').length === 14`), 'the plan shows two weeks of posts per day');
  await clicky('.ue-rhythms button', 'Flood');
  const flood = await ev(`document.querySelector('.ue-approve .btn.primary')?.textContent ?? ''`);
  check(/· Flood ·/.test(flood), `one tap switches the rhythm (${flood})`);
  await ev(`document.querySelector('.ue-plan').scrollIntoView({ block: 'start' })`);
  await shot('plan-card-desktop', 1440, 1100);
  await shot('plan-card-phone', 390, 1500, true);
  await ev(`document.querySelector('.ue-plan').scrollIntoView({ block: 'start' })`);
  await shot('plan-card-phone-plan', 390, 1500, true);
  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'the plan has no sideways scroll on a phone');
  await size(1440, 1000);
  await clicky('.ue-seg button', 'My calendar');
  check(await ev(`document.querySelectorAll('.ue-cal-row input[type=datetime-local]').length === 5`), 'My calendar gives each clip and the full video a day and time');
  await ev(`document.querySelector('.ue-plan').scrollIntoView({ block: 'start' })`);
  await shot('plan-card-calendar', 1440, 1100);
  await clicky('.ue-seg button', 'Post now');
  check(/^Post 13 now$/.test(await ev(`document.querySelector('.ue-approve .btn.primary')?.textContent ?? ''`)), 'Post now says what it does');

  // ---- A clip still being cut holds the Approve ----
  const hc = await api({ id: C, tool: 'approve', mode: 'now' });
  check(hc.ok === false && /Clip 2 is still being cut/.test(hc.error ?? ''), `a clip still being cut holds the Approve (${hc.error})`);

  // ---- Post now: one Approve sends every ready clip and the full video; left-out stays out ----
  const ra = await api({ id: A, tool: 'approve', mode: 'now' });
  check(ra.ok && /7 posts going to Metricool as drafts now/.test(ra.say), `Post now approves 2 clips + the full video (${ra.say ?? ra.error})`);
  const clipsA = must(await db.from('unedit_clips').select('n, status').eq('vlog_id', A).order('n'), 'clipsA');
  check(clipsA.map((c) => c.status).join(',') === 'approved,approved,dropped', `ready clips became approved, the left-out clip stayed out (${clipsA.map((c) => c.status).join(',')})`);
  await waitFor(async () => (await vlog(A)).stage === 'published', 90000);
  const pa = await postsOf(A);
  const t0 = Date.now();
  check(pa.length === 7 && pa.every((p) => p.status === 'sent' && Date.parse(p.scheduled_at) < t0 + 45 * 60_000), `Post now: all 7 sent, each within the next minutes (${pa.map((p) => p.status).join(',')})`);
  check(mcPosts.length === 7 && mcPosts.every((x) => x.body.draft === true), `7 Metricool drafts (${mcPosts.length})`);
  check((await vlog(A)).post_plan?.mode === 'now', 'the campaign records how it was approved');

  // ---- Helix plan (drip): only what is due goes; the rest waits on the calendar ----
  const before = mcPosts.length;
  const rb = await api({ id: B, tool: 'approve', mode: 'plan', rhythm: 'drip' });
  check(rb.ok && /10 posts on the calendar \(drip\)/.test(rb.say), `the plan approves 3 clips + the full video onto the calendar (${rb.say ?? rb.error})`);
  await waitFor(async () => (await vlog(B)).stage === 'published', 90000);
  let pb = await postsOf(B);
  const tB = Date.now();
  const dueB = pb.filter((p) => Date.parse(p.scheduled_at) <= tB + 45 * 60_000);
  check(pb.length === 10 && pb.every((p) => Date.parse(p.scheduled_at) >= tB - 60_000 + 15 * 60_000), 'every planned post is at least the lead time out');
  check(pb.filter((p) => p.status === 'sent').length === dueB.length && pb.filter((p) => p.status === 'queued').length === 10 - dueB.length && mcPosts.length - before === dueB.length, `only due posts were sent (${dueB.length} due, ${pb.filter((p) => p.status === 'queued').length} waiting)`);
  const days = new Set(pb.map((p) => new Date(p.scheduled_at).toLocaleDateString('en-US', { timeZone: 'America/New_York' })));
  check(days.size === 3 && (Date.parse([...pb].pop().scheduled_at) - Date.parse(pb[0].scheduled_at)) >= 3.5 * 86_400_000, `drip puts each clip on its own day, every other day (${days.size} days: ${[...days].join(', ')})`);
  check((await vlog(B)).post_plan?.rhythm === 'drip', 'the campaign records its rhythm');

  // ---- The calendar on Recordings ----
  await go('/console/studio/unedit');
  const calN = await ev(`document.querySelectorAll('.ue-calendar ul li').length`);
  check(calN >= 17, `the calendar lists the campaigns' posts (${calN})`);
  check(await ev(`[...document.querySelectorAll('.ue-calendar ul li')].some((li) => /Move/.test(li.innerText) && /Cancel/.test(li.innerText))`), 'waiting posts can be moved or cancelled');
  check(await ev(`[...document.querySelectorAll('.ue-list .chip')].some((c) => c.textContent === 'Scheduled')`), 'a campaign with posts waiting shows as Scheduled');
  await shot('calendar-desktop', 1440, 1500);
  await shot('calendar-phone', 390, 1500, true);
  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'the calendar has no sideways scroll on a phone');
  await size(1440, 1000);

  // ---- Move makes a post due; the sweep sends exactly it, once, with two steps at the same time ----
  pb = await postsOf(B);
  const far = pb.filter((p) => p.status === 'queued');
  const [m1, m2] = [far[far.length - 1], far[far.length - 2]];
  const tooSoon = await api({ id: B, tool: 'move_post', post: m1.id, at: new Date(Date.now() + 5 * 60_000).toISOString() });
  check(tooSoon.ok === false && /at least 20 minutes/.test(tooSoon.error ?? ''), 'a move too close to now is refused');
  const mv = await api({ id: B, tool: 'move_post', post: m1.id, at: new Date(Date.now() + 25 * 60_000).toISOString() });
  check(mv.ok && /^Moved to /.test(mv.say), `a waiting post moves (${mv.say ?? mv.error})`);
  const cx = await api({ id: B, tool: 'cancel_post', post: m2.id });
  check(cx.ok && (await db.from('unedit_posts').select('status').eq('id', m2.id).single()).data.status === 'cancelled', 'a waiting post can be taken off the calendar');
  const sweep = execFileSync('npx', ['tsx', '--conditions=react-server', '--env-file=.env.local', 'scripts/unedit-sweep-once.mts'], { shell: true, encoding: 'utf8' }).trim();
  check(/^swept [1-9]/.test(sweep.split('\n').pop()) && (await vlog(B)).stage === 'publishing', `the sweep brings the recording back to send (${sweep.split('\n').pop()})`);
  const n0 = mcPosts.length;
  await Promise.all([step(B), step(B)]);
  await waitFor(async () => (await vlog(B)).stage === 'published', 90000);
  const moved = (await db.from('unedit_posts').select('status').eq('id', m1.id).single()).data;
  check(moved.status === 'sent' && mcPosts.length - n0 === 1, `the moved post was sent exactly once (${mcPosts.length - n0} sent)`);
  const sent = (await postsOf(B)).find((p) => p.status === 'sent');
  const locked = await api({ id: B, tool: 'move_post', post: sent.id, at: new Date(Date.now() + 3 * 86_400_000).toISOString() });
  check(locked.ok === false && /already went to Metricool/.test(locked.error ?? ''), 'a post already sent is locked');
  const notCancelled = (await postsOf(B)).filter((p) => p.id === m2.id && p.status !== 'cancelled');
  check(!notCancelled.length && !mcPosts.some((x) => x.body.text === (pb.find((p) => p.id === m2.id)?.body)), 'the cancelled post never went to Metricool');

  check(!errors.length, `no browser errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  for (const id of created) await db.from('unedit_vlogs').delete().eq('id', id);
  ws.close(); chrome.kill(); mock.close();
  if (process.platform === 'win32') { try { const pid = execFileSync('cmd', ['/c', `netstat -ano | findstr :${PORT} | findstr LISTENING`]).toString().trim().split(/\s+/).pop(); if (pid) execFileSync('taskkill', ['/PID', pid, '/T', '/F']); } catch {} }
  console.log(`screens in ${OUT}`);
}
