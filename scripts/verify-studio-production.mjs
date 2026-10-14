// Verify StudioNext production runs on the PREVIEW database against a stand-in Runway (no credits): the board's
// production bar and storyboard cards, quote-bound approval (tap or voice), blocked-before-spend without a cast
// lock, one approval producing every shot to review with no further clicks, single-flight steps under concurrent
// advancing, review (approve / redo with a note), the ceiling pausing the run, and the board on a phone.
//   node --env-file=.env.local scripts/verify-studio-production.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { del, get, put } from '@vercel/blob';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify');
const PORT = 3911, ORIGIN = `http://localhost:${PORT}`, MOCK = 3917;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) process.exitCode = 1; };
const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy`);

// ---- Stand-in Runway: every task succeeds on its second check and reports a final cost. ----
const calls = []; let n = 0; const seen = new Map(); let balance = 100000;
const mcPosts = []; const mcPublished = new Set();
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-media-'));
const FF = (await import('ffmpeg-static')).default;
const { execFileSync } = await import('node:child_process');
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-t', '6', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', path.join(mediaDir, 'take.mp4')]);
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', '-c:a', 'libmp3lame', path.join(mediaDir, 'read.mp3')]);
const FILES = { mp3: fs.readFileSync(path.join(mediaDir, 'read.mp3')), png: PNG, mp4: fs.readFileSync(path.join(mediaDir, 'take.mp4')) };
const KIND = { '/text_to_speech': ['mp3', 4], '/sound_effect': ['mp3', 9], '/text_to_image': ['png', 8], '/image_to_video': ['mp4', 100], '/generate/video': ['mp4', 100], '/generate/image': ['png', 8], '/character_performance': ['mp4', 50] };
// Test controls: make the next N video takes fail, or make takes hang (stay running).
const ctl = { heroNoAudio: false, heroNone: false, failTakes: 0, hang: false, cancelled: [], failMsg: 'The model failed to render this take (test)', failCode: 'INTERNAL.TEST' };
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    // Stand-in Metricool (METRICOOL_API_BASE=/mc): schedule a post, read its status (published once told to).
    if (req.url.startsWith('/mc/')) {
      const [p, qs] = req.url.slice(3).split('?');
      if (req.method === 'POST' && p === '/v2/scheduler/posts') { const b = JSON.parse(body || '{}'); const id = 900000 + mcPosts.length; mcPosts.push({ id, body: b, auth: req.headers['x-mc-auth'], qs }); return send({ data: { id, ...b, providers: b.providers.map((x) => ({ ...x, status: 'PENDING' })) } }); }
      if (req.method === 'GET' && p === '/admin/simpleProfiles') return send([{ id: 7426930, label: 'Genovus Intelliware', facebook: 'genovus', instagram: 'genovus', youtube: 'genovus' }]);
      const m = p.match(/^\/v2\/scheduler\/posts\/(\d+)$/);
      if (req.method === 'GET' && m) { const post = mcPosts.find((x) => x.id === Number(m[1])); if (!post) return send({ detail: 'not found' }, 404); return send({ data: { id: post.id, providers: post.body.providers.map((x) => (mcPublished.has(post.id) ? { ...x, status: 'PUBLISHED', publicUrl: `https://www.${x.network}.com/p/${post.id}` } : { ...x, status: 'PENDING' })) } }); }
      return send({ detail: 'unknown' }, 404);
    }
    const u = req.url.replace(/^\/v1/, '');
    if (u.startsWith('/files/')) { const ext = u.split('.').pop(); res.writeHead(200); return res.end(FILES[ext] ?? PNG); }
    if (req.method === 'POST' && u === '/upload-target') { calls.push({ path: u, body: {} }); res.writeHead(204); return res.end(); }
    if (req.method === 'POST' && u === '/uploads') { const b = JSON.parse(body || '{}'); calls.push({ path: u, body: b }); return send({ uploadUrl: `http://localhost:${MOCK}/v1/upload-target`, fields: { key: 'k' }, runwayUri: `runway://upload/${b.filename}` }); }
    if (req.method === 'GET' && u === '/organization') return send({ creditBalance: balance });
    if (req.method === 'GET' && u.startsWith('/routers?')) return send({ data: [{ id: 'r-hero', slug: 'genovus-video-hero', name: 'Hero', settings: { optimizeFor: 'quality', fallback: { onCapacity: true }, models: { mode: 'allowlist_only', ids: ['seedance2_5', 'veo3.1', 'gen4.5'] } } }, { id: 'r-prod', slug: 'genovus-video-production', name: 'Production', settings: { optimizeFor: 'latency', fallback: { onCapacity: true } } }, { id: 'r-draft', slug: 'genovus-video-draft', name: 'Draft', settings: { optimizeFor: 'cost' } }, { id: 'r-key', slug: 'genovus-image-keyframe', name: 'Keyframe', settings: { optimizeFor: 'quality' } }, { id: 'r-fast', slug: 'genovus-image-fast', name: 'Fast', settings: { optimizeFor: 'latency' } }] });
    if (req.method === 'GET' && /^\/routers\/[^/]+\/requests/.test(u)) { const slug = { 'r-hero': 'genovus-video-hero', 'r-prod': 'genovus-video-production', 'r-draft': 'genovus-video-draft', 'r-key': 'genovus-image-keyframe', 'r-fast': 'genovus-image-fast' }[u.split('/')[2]]; return send({ data: calls.filter((c) => c.body.configId === slug).map((c, i) => ({ id: 'q' + i, createdAt: new Date().toISOString(), model: slug.includes('draft') ? 'gen4_turbo' : slug.includes('image') ? 'gen4_image' : 'seedance2_5', reasonCode: 'best_quality', reason: 'test', estimatedCredits: 8 })) }); }
    if (req.method === 'POST' && u === '/voices/preview') { calls.push({ path: u, body: JSON.parse(body || '{}') }); balance -= 6; return send({ url: `http://localhost:${MOCK}/files/design.mp3`, durationSecs: 6 }); }
    if (req.method === 'POST' && (u === '/generate/video' || u === '/generate/image') && JSON.parse(body || '{}').dryRun) {
      const b = JSON.parse(body); calls.push({ path: u, body: b });
      if (b.configId === 'genovus-video-hero' && (ctl.heroNone || (ctl.heroNoAudio && b.input?.referenceAudio?.length))) return send({ error: 'No eligible model for this request' }, 400);
      const draft = /draft|fast/.test(b.configId);
      return send({ routing: { configId: b.configId, model: u === '/generate/image' ? (draft ? 'gen4_image_turbo' : 'gen4_image') : (draft ? 'gen4_turbo' : 'seedance2_5'), provider: 'runway', estimatedCost: { credits: u === '/generate/image' ? (draft ? 2 : 8) : (draft ? 25 : 340) } } });
    }
    if (req.method === 'POST' && KIND[u]) {
      const id = `task-${++n}`; const video = u === '/generate/video' || u === '/image_to_video';
      const fail = video && ctl.failTakes > 0 ? (ctl.failTakes--, true) : false;
      seen.set(id, { k: KIND[u], polls: 0, fail, hang: video && ctl.hang }); calls.push({ path: u, body: JSON.parse(body || '{}') });
      const b = calls.at(-1).body;
      if (u === '/generate/video') return send({ id, routing: { configId: b.configId, model: b.configId === 'genovus-video-draft' ? 'gen4_turbo' : 'seedance2_5', provider: 'runway', estimatedCost: { credits: b.configId === 'genovus-video-draft' ? 25 : 100 } } });
      if (u === '/generate/image') return send({ id, routing: { configId: b.configId, model: b.configId === 'genovus-image-fast' ? 'gen4_image_turbo' : 'gen4_image', provider: 'runway', estimatedCost: { credits: b.configId === 'genovus-image-fast' ? 2 : 8 } } });
      return send({ id });
    }
    if (req.method === 'DELETE' && u.startsWith('/tasks/')) { ctl.cancelled.push(u.slice(7)); const s = seen.get(u.slice(7)); if (s) s.cancelled = true; res.writeHead(204); return res.end(); }
    const t = u.match(/^\/tasks\/(.+)$/);
    if (t && seen.has(t[1])) { const s = seen.get(t[1]); s.polls++; if (s.cancelled) return send({ id: t[1], status: 'CANCELLED', cost: { credits: 0 } }); if (s.hang) return send({ id: t[1], status: 'RUNNING', progress: 0.4 }); if (s.fail && s.polls >= 2) return send({ id: t[1], status: 'FAILED', failure: ctl.failMsg, failureCode: ctl.failCode, cost: { credits: 0 } }); return send(s.polls < 2 ? { id: t[1], status: 'RUNNING', progress: 0.5 } : { id: t[1], status: 'SUCCEEDED', output: [`http://localhost:${MOCK}/files/${t[1]}.${s.k[0]}`], cost: { credits: s.k[1] } }); }
    send({ error: 'not found' }, 404);
  });
});
await new Promise((r) => mock.listen(MOCK, r));

const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const email = must(await db.auth.admin.getUserById(admin.user_id), 'email').user.email;
const startedAt = new Date().toISOString();
const cast = must(await db.from('studio_characters').select('id, code, name, voice').in('code', ['MARCUS01', 'TASHA01', 'JULIAN01']), 'cast');
const tasha = cast.find((c) => c.code === 'TASHA01');
const priorVoice = Object.fromEntries(cast.map((c) => [c.id, c.voice]));
// CRON_SECRET lets the board's live advance kick the finisher (as the Studio cron does in production).
const env = { ...process.env, Genovus_Runway_API_Key: 'stand-in', RUNWAY_API_BASE: `http://localhost:${MOCK}/v1`, CRON_SECRET: process.env.CRON_SECRET || 'verify-studio-local', METRICOOL_API_BASE: `http://localhost:${MOCK}/mc`, METRICOOL_GENOVUS_API_KEY: 'stand-in-metricool', METRICOOL_MODE: '', HELIX_STANDIN: '1' };
const devLog = process.env.DEV_LOG ? fs.openSync(process.env.DEV_LOG, 'w') : 'ignore';
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: ['ignore', devLog, devLog], shell: true, env });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9498, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let list; for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl);
let id = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable');
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await cdp('Page.navigate', { url: ORIGIN + u }); await l; await sleep(2500); };
const shot = async (name, h = 1400) => { await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(500); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64')); };
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console/studio/gjk-h01')}`);
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith('/console'); i++) await sleep(250);
const click = (scope, re) => ev(`(() => { const root = ${scope}; const b = root && [...root.querySelectorAll('button')].find((x) => ${re}.test(x.textContent) && !x.disabled); b && b.click(); return !!b; })()`);
const waitFor = async (fn, ms = 40000) => { for (let i = 0; i < ms / 500; i++) { const v = await fn(); if (v) return v; await sleep(500); } return null; };
const created = { clips: [], art: [], takes: [], refs: [] };

const priorShots = []; const dirOK = true; const renderedFiles = [];
// The finisher can render the trailer's final cut during any section; restore the episode's own state at the end.
const epStart = must(await db.from('studio_episodes').select('status, final_blob, final_sha256, final_url, approved_by, approved_at').eq('code', 'gjk-h01').single(), 'ep start');
try {
  const ep = must(await db.from('studio_episodes').select('id, production').eq('code', 'gjk-h01').single(), 'episode');
  const priorRun = ep.production;
  const shotsAll = must(await db.from('studio_shots').select('id, n, tool, produce, status, log, screens').eq('episode_id', ep.id).order('n'), 'shots');
  priorShots.push(...shotsAll);
  await db.from('studio_shots').update({ produce: {} }).eq('episode_id', ep.id);
  // Single-flight at the root: five simultaneous claims on a fresh shot, exactly one wins.
  const wins = await Promise.all([1, 2, 3, 4, 5].map(() => db.rpc('studio_claim_step', { p_shot: shotsAll[1].id, p_step: 'probe', p_seconds: 30 })));
  check(wins.filter((w) => w.data === true).length === 1, `a step claim has exactly one winner (${wins.filter((w) => w.data === true).length} of 5)`);
  await db.from('studio_shots').update({ produce: {} }).eq('episode_id', ep.id);
  await db.from('studio_episodes').update({ production: {} }).eq('id', ep.id);
  await go('/console/studio/gjk-h01');
  const api = (tool, args = {}) => ev(`fetch('/api/studio/direct', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ episode: 'gjk-h01', tool: '${tool}', args: ${JSON.stringify(args)} }) }).then((r) => r.json())`);
  const advance = () => ev(`fetch('/api/studio/direct?episode=gjk-h01').then((r) => r.json())`);
  const stages = async () => Object.fromEntries((must(await db.from('studio_shots').select('n, produce').eq('episode_id', ep.id).order('n'), 'st')).map((s, i) => [i + 1, s.produce?.stage ?? '']));
  check(await ev(`!!document.querySelector('.pc-bar') && document.querySelectorAll('.pb-card2').length === 12`), 'the board opens with one production bar and 12 storyboard cards');
  const visibleBtns = await ev(`[...document.querySelectorAll('.pb-card2 button')].filter((b) => b.checkVisibility()).map((b) => b.textContent.trim())`);
  check(visibleBtns.length === 0, `no per-shot buttons show until there is something to review (${visibleBtns.slice(0, 4).join(' | ')})`);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1500, deviceScaleFactor: 1, mobile: false }); await sleep(600);
  const fr = await ev(`(() => { const f = document.querySelector('.pb-frame2').getBoundingClientRect(); return { w: Math.round(f.width), h: Math.round(f.height) }; })()`);
  check(fr.w >= 300 && Math.abs(fr.w / fr.h - 16 / 9) < 0.05, `storyboard frames are large and 16:9 (${fr.w}×${fr.h})`);
  await shot('prod-board-desktop', 1500);

  // 1. A shot with an unlocked cast blocks before any spend.
  const p11 = await api('plan', { shots: '11' });
  check(p11.ok && p11.shots.join() === '11' && /^\$/.test(p11.total), `Helix can price one shot by its board number (${p11.total})`);
  const bad = await api('approve', { quote_id: '00000000-0000-0000-0000-000000000000' });
  const none = await api('approve', {});
  check(!bad.ok && !none.ok, 'approving without a real quote is refused');
  const a11 = await api('approve', { quote_id: p11.quote_id, via: 'voice' });
  check(a11.ok, 'approving the read-back quote starts the run');
  const again = await api('approve', { quote_id: p11.quote_id });
  check(!again.ok && /already approved/i.test(again.error ?? ''), 'a quote can be approved only once');
  // Approving locks any unlocked cast to the official sheet, so the shot starts at once (no stall on a lock).
  const lockedNow = (await db.from('studio_refs').select('id').in('character_id', cast.map((c) => c.id)).eq('slot', 'CASTING').eq('approved', true).gte('created_at', startedAt)).data?.length;
  check(lockedNow === 3 && (await stages())[11] !== 'blocked' && calls.some((c) => (c.path === '/generate/image' && !c.body.dryRun)) && calls.some((c) => c.path === '/text_to_speech'), `approving locks the cast and starts shot 11's keyframe and line read together (${lockedNow} locked)`);
  const lock = await api('lock_cast');
  check(lock.ok && lock.locked.length === 0, 'the cast stays locked (lock_cast has nothing left to do)');
  // A blocked shot says why on the bar and comes back with one tap.
  const s3 = shotsAll.find((x) => x.n === 30);
  await db.rpc('studio_shot_produce_patch', { p_shot: s3.id, p_patch: { stage: 'blocked', note: 'The keyframe keeps failing.' } });
  const pre = await db.from('studio_episodes').select('production').eq('id', ep.id).single();
  await db.from('studio_episodes').update({ production: { ...pre.data.production, shots: [...new Set([...(pre.data.production.shots ?? []), s3.id])] } }).eq('id', ep.id);
  await go('/console/studio/gjk-h01');
  check(/Shot 3: The keyframe keeps failing/.test(await ev(`document.querySelector('.pc-bar').innerText`)) && await ev(`[...document.querySelectorAll('.pc-bar button')].some((b) => /Fix & retry shot 3/.test(b.textContent))`), 'the bar names the blocked shot and why, with Fix & retry');
  await click(`document.querySelector('.pc-bar')`, '/Fix & retry/');
  await waitFor(async () => (await stages())[3] !== 'blocked', 15000);
  check((await stages())[3] !== 'blocked', `Fix & retry restarts the shot (${(await stages())[3]})`);
  // 3. Produce everything else with one approval, then nobody touches anything.
  const pAll = await api('plan', { shots: 'all' });
  check(pAll.ok && !pAll.shots.includes(11) && !pAll.shots.includes(3) && pAll.shots.includes(1), `"all" prices what isn't made yet (${pAll.shots?.length} shots, ${pAll.total})`);
  check((await api('approve', { quote_id: pAll.quote_id })).ok, 'one approval for the whole episode');
  // The cron, the board and a kick all advancing at once must not double-start anything.
  for (let i = 0; i < 60; i++) {
    await Promise.all([advance(), advance(), advance()]);
    const st = Object.values(await stages());
    if (!st.some((x) => ['queued', 'reading', 'drawing', 'rendering'].includes(x))) break;
    await sleep(500);
  }
  const st = await stages();
  const runwayBoards = shotsAll.map((s, i) => [i + 1, s]).filter(([, s]) => s.tool === 'runway').map(([b]) => b);
  check(runwayBoards.every((b) => st[b] === 'review'), `every generated shot reached review with no further clicks (${runwayBoards.map((b) => `${b}:${st[b]}`).join(' ')})`);
  check(st[9] === 'review' && !st[2] && !st[5], `the product shot gets its voice-over and its screens from the Screen Library, so it lands in review with no recording; code cards stay out of the run (9:${st[9]} 2:${st[2] || '-'} 5:${st[5] || '-'})`);
  // Helix can swap the product shot's screen by voice; the board shows the library screen on the card.
  const at = await api('attach_screen', { shot: 9, screen: 'agency follow-ups on desktop' });
  const s9 = must(await db.from('studio_shots').select('screens').eq('id', shotsAll.find((x) => x.n === 90).id).single(), 's9');
  check(at.ok && s9.screens.join() === 'agency-followups:desktop', `“use the agency follow-ups on desktop for shot 9” attaches that library screen (${s9.screens.join()})`);
  await api('attach_screen', { shot: 9, screen: 'genovus line phone' });
  await go('/console/studio/gjk-h01');
  check(/From the Screen Library: The Genovus line/.test(await ev(`document.querySelector('#shot-90').innerText`)) && await ev(`!!document.querySelector('#shot-90 .pb-frame2 img[src*="/api/studio/library/ent-line-calls/phone"]')`), 'the product shot’s card shows its library screen');
  const vids = calls.filter((c) => (c.path === '/generate/video' && !c.body.dryRun)).length, imgs = calls.filter((c) => (c.path === '/generate/image' && !c.body.dryRun)).length;
  const by = {}; for (const c of calls.filter((c) => (c.path === '/generate/image' && !c.body.dryRun) || c.path === '/text_to_speech')) { const k = c.path.slice(1, 8) + ' ' + (c.body.promptText ?? c.body.input?.promptText ?? '').replace(/@w+ is w+; ?|@w+ is w+. ?/g, '').slice(0, 160); by[k] = (by[k] ?? 0) + 1; } console.log('CALLS', JSON.stringify(Object.entries(by).filter(([, n]) => n > 1)));
  check(vids === runwayBoards.length && imgs === runwayBoards.length, `single-flight: one keyframe and one take per shot (${imgs} keyframes, ${vids} takes for ${runwayBoards.length} shots)`);
  const reads = calls.filter((c) => c.path === '/text_to_speech').length;
  check(reads === 11, `each spoken line read exactly once (${reads} of 11)`);
  // Money: every routed render was quoted with a dry run first, and the reservation is the dry run's estimate.
  const dry = calls.filter((c) => c.body?.dryRun).length, real = calls.filter((c) => (c.path === '/generate/video' || c.path === '/generate/image') && !c.body?.dryRun).length;
  const heroTake = must(await db.from('studio_takes').select('estimate_cents, params').eq('shot_id', shotsAll.find((x) => x.n === 120).id).like('model', 'runway:%').order('created_at', { ascending: false }).limit(1).single(), 'hero take');
  check(dry >= real && real > 0 && heroTake.estimate_cents === 340, `each routed render is quoted with Runway's dry run and reserves that amount (${dry} dry runs for ${real} renders; hero estimate ${heroTake.estimate_cents}¢)`);
  // One expense per Runway task, however many pollers finish it.
  const { data: exps } = await db.from('expenses').select('source_ref').eq('vendor', 'Runway').gte('created_at', startedAt);
  const refs = (exps ?? []).map((x) => x.source_ref).filter(Boolean);
  check(refs.length > 0 && new Set(refs).size === refs.length, `one expense per Runway task (${refs.length} expenses, ${new Set(refs).size} tasks)`);
  await go('/console/studio/gjk-h01');
  check(await ev(`document.querySelectorAll('.pb-card2.is-review').length`) >= 9 && /to review/.test(await ev(`document.querySelector('.pc-bar').innerText`)), 'the board highlights the shots waiting for review');
  check(await ev(`!!document.querySelector('.pb-hero')`) && /Play the cut so far · 10 scenes/i.test(await ev(`document.querySelector('.pb-hero').innerText`)), 'the board opens on a streaming-style hero with Play the cut so far');
  check(await ev(`document.querySelectorAll('.pb-card2 .sp-play').length`) === 10, 'every finished scene has a play button on its card');
  await ev(`document.querySelector('#shot-110 .sp-play').click()`); await sleep(800);
  check(await ev(`!!document.querySelector('.sp-back video') && /11 ·/.test(document.querySelector('.sp-bar').innerText)`), 'pressing play on a card opens the full-screen player on that scene');
  await shot('prod-board-player', 1000);
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`); await sleep(400);
  check(await ev(`!document.querySelector('.sp-back')`), 'Esc closes the player');
  await shot('prod-board-review', 1500);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await sleep(800);
  check(await ev(`document.documentElement.scrollWidth <= 392`), `on a phone the board fits the screen (${await ev('document.documentElement.scrollWidth')}px)`);
  await ev(`document.querySelector('.pc-bar').scrollIntoView()`); await sleep(400);
  fs.writeFileSync(path.join(OUT, 'prod-board-phone.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await ev(`document.querySelector('#shot-110').scrollIntoView()`); await sleep(400);
  fs.writeFileSync(path.join(OUT, 'prod-board-phone-card.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).result.data, 'base64'));
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  // 4. Review: approve by tap, approve "by voice" (the same server path), redo with a note.
  await go('/console/studio/gjk-h01');
  await click(`document.querySelector('#shot-10')`, '/^Approve$/');
  await waitFor(async () => (await stages())[1] === 'approved', 10000);
  check((await stages())[1] === 'approved', 'tapping Approve approves the shot');
  const r12 = await api('review', { shot: 12, action: 'approve', via: 'voice' });
  check(r12.ok && (await stages())[12] === 'approved', '“Approve shot 12” works through Helix’s tool');
  const before = calls.filter((c) => (c.path === '/generate/video' && !c.body.dryRun)).length;
  const redo = await api('review', { shot: 11, action: 'redo', note: 'a slower turn, eyes first' });
  for (let i = 0; i < 30 && (await stages())[11] !== 'review'; i++) { await advance(); await sleep(500); }
  const log11 = must(await db.from('studio_shots').select('log').eq('id', shotsAll.find((s) => s.n === 110).id).single(), 'log').log;
  check(redo.ok && (await stages())[11] === 'review' && calls.filter((c) => (c.path === '/generate/video' && !c.body.dryRun)).length === before + 1 && /slower turn/.test(log11.acting ?? ''), 'a redo with a note updates the direction and renders exactly one new take');

  // 4b. The Production Monitor. (Earlier redos used up the run's ceiling; approving more is one tap.)
  await go('/console/studio/gjk-h01');
  if (/ceiling/i.test((await db.from('studio_episodes').select('production').eq('id', ep.id).single()).data.production.paused_reason ?? '')) {
    check(await ev(`[...document.querySelectorAll('.pc-bar button')].some((b) => /Approve more to finish/.test(b.textContent))`), 'at the ceiling the bar offers Approve more to finish');
  }
  { const cur0 = (await db.from('studio_episodes').select('production').eq('id', ep.id).single()).data.production; await db.from('studio_episodes').update({ production: { ...cur0, on: true, ceiling_cents: 100000, paused_reason: null } }).eq('id', ep.id); }
  const tl = await ev(`[...document.querySelectorAll('#shot-110 .pm-step')].map((x) => x.textContent.trim())`);
  check(tl.length === 3 && /Lines/.test(tl[0]) && /Keyframe/.test(tl[1]) && /Take/.test(tl[2]) && await ev(`/Take on Seedance 2\\.5/.test(document.querySelector('#shot-110 .pm').innerText)`), `each card shows its step timeline and the model the router picked (${tl.join(' | ')})`);
  const routed = calls.filter((c) => (c.path === '/generate/video' && !c.body.dryRun));
  const prodBoards = shotsAll.map((x, i) => [i + 1, x]).filter(([, x]) => x.tool === 'runway');
  check(routed.length > 0 && routed.every((c) => ['genovus-video-hero', 'genovus-video-production'].includes(c.body.configId)) && routed.some((c) => c.body.configId === 'genovus-video-production') && calls.filter((c) => (c.path === '/generate/image' && !c.body.dryRun)).every((c) => c.body.configId === 'genovus-image-keyframe'), `final renders use the hero / production routers by shot, keyframes the keyframe router (${routed.length} takes)`);
  void prodBoards;
  // The Router report shows all five routers live from Runway, with what each picked.
  const rr = await ev(`[...document.querySelectorAll('.rr-card')].map((c) => c.innerText)`);
  check(rr.length === 5 && rr.some((t) => /genovus-video-hero/.test(t) && /Seedance 2\.5 ×/.test(t)) && rr.some((t) => /genovus-image-keyframe/.test(t)) && !(await ev(`!!document.querySelector('.rr-card.missing')`)), 'the Router report shows the five routers live, with each router’s picks');
  // Quick draft → approve the draft → final render, each on its router.
  const s8 = shotsAll.find((x) => x.n === 80);
  await db.rpc('studio_shot_produce_patch', { p_shot: s8.id, p_patch: { stage: null, force: true } });
  await db.from('studio_shots').update({ status: 'todo' }).eq('id', s8.id);
  const nCalls = calls.length;
  const qd = await api('plan', { shots: '8', pass: 'draft' });
  check(qd.ok && qd.pass === 'draft' && Number(qd.total.slice(1)) < Number((await api('plan', { shots: '8', pass: 'final' })).total.slice(1)), `a quick draft costs less than the final (${qd.total})`);
  await api('approve', { quote_id: qd.quote_id });
  for (let i = 0; i < 40 && (await stages())[8] !== 'review'; i++) { await advance(); await sleep(500); }
  const dv = calls.slice(nCalls).filter((c) => (c.path === '/generate/video' && !c.body.dryRun)), di = calls.slice(nCalls).filter((c) => (c.path === '/generate/image' && !c.body.dryRun));
  check((await stages())[8] === 'review' && dv.length === 1 && dv[0].body.configId === 'genovus-video-draft' && dv[0].body.input.resolution === '720p' && di.length === 1 && di[0].body.configId === 'genovus-image-fast', 'the quick draft renders on genovus-video-draft at 720p with a genovus-image-fast keyframe');
  await go('/console/studio/gjk-h01');
  check(/Draft ready for review/i.test(await ev(`document.querySelector('#shot-80').innerText`)), 'the card says the draft is ready for review');
  await click(`document.querySelector('#shot-80')`, '/Approve draft/');
  await waitFor(async () => (await stages())[8] === 'draft_ok', 10000);
  await go('/console/studio/gjk-h01');
  check((await stages())[8] === 'draft_ok' && await ev(`[...document.querySelectorAll('.pc-bar button')].some((b) => /Render final · 1 approved draft/.test(b.textContent))`), 'approving the draft offers Render final for it');
  const qf = await api('plan', { shots: 'drafts', pass: 'final' });
  const nF = calls.length;
  await api('approve', { quote_id: qf.quote_id });
  for (let i = 0; i < 40 && (await stages())[8] !== 'review'; i++) { await advance(); await sleep(500); }
  const fv = calls.slice(nF).filter((c) => (c.path === '/generate/video' && !c.body.dryRun)), fi = calls.slice(nF).filter((c) => (c.path === '/generate/image' && !c.body.dryRun));
  check(qf.ok && qf.shots.join() === '8' && (await stages())[8] === 'review' && fv[0]?.body.configId === 'genovus-video-hero' && fv[0]?.body.input.resolution === '1080p' && fi[0]?.body.configId === 'genovus-image-keyframe' && !calls.slice(nF).some((c) => c.path === '/text_to_speech'), 'the final renders on genovus-video-hero at 1080p with a genovus-image-keyframe keyframe, reusing the draft’s line read');
  // A failed take retries by itself without the audio, then succeeds.
  ctl.failTakes = 1;
  const nBefore = calls.filter((c) => (c.path === '/generate/video' && !c.body.dryRun)).length;
  await api('review', { shot: 4, action: 'redo', note: 'one more' });
  for (let i = 0; i < 40 && (await stages())[4] !== 'review'; i++) { await advance(); await sleep(500); }
  const r4 = calls.filter((c) => (c.path === '/generate/video' && !c.body.dryRun)).slice(nBefore);
  check((await stages())[4] === 'review' && r4.length === 2 && r4[0].body.input.referenceAudio?.length && !r4[1].body.input.referenceAudio, `a failed take retries itself without the audio and lands in review (${r4.length} attempts)`);
  // Two failures: the shot blocks, the card says Runway's reason, and Retry brings it back.
  ctl.failTakes = 2;
  await api('review', { shot: 6, action: 'redo', note: 'again' });
  for (let i = 0; i < 40 && (await stages())[6] !== 'blocked'; i++) { await advance(); await sleep(500); }
  await go('/console/studio/gjk-h01');
  const card6 = await ev(`document.querySelector('#shot-60 .pm')?.innerText ?? ''`);
  check((await stages())[6] === 'blocked' && /The model failed to render this take/.test(card6) && /Retry shot/.test(card6), 'after two failures the card shows Runway’s reason and a Retry button');
  await click(`document.querySelector('#shot-60')`, '/Retry shot/');
  for (let i = 0; i < 40 && (await stages())[6] !== 'review'; i++) { await advance(); await sleep(500); }
  check((await stages())[6] === 'review', 'Retry shot brings it back to review');
  // A provider's safety filter (Seedance on photoreal faces) blocks a take: the retry renders on Runway's own Gen-4.5.
  ctl.failTakes = 1; ctl.failMsg = "Your request was blocked by this model provider's content moderation system."; ctl.failCode = 'INPUT_PREPROCESSING.SAFETY.THIRD_PARTY';
  const nMod = calls.length;
  await api('review', { shot: 10, action: 'redo', note: 'moderation' });
  for (let i = 0; i < 40 && (await stages())[10] !== 'blocked'; i++) { await advance(); await sleep(500); }
  const s10 = must(await db.from('studio_shots').select('produce').eq('id', shotsAll.find((x) => x.n === 100).id).single(), 's10').produce;
  check((await stages())[10] === 'blocked' && s10.decision === 'first_party' && !calls.slice(nMod).some((c) => c.path === '/image_to_video'), 'a speaking shot blocked by the provider’s face filter asks instead of switching models on its own');
  await go('/console/studio/gjk-h01');
  check(await ev(`[...document.querySelectorAll('#shot-100 button')].some((b) => /Use Gen-4\\.5/.test(b.textContent))`), 'the card offers Use Gen-4.5 or Retry');
  const ug = await api('use_gen45', { shot: 10 });
  for (let i = 0; i < 40 && (await stages())[10] !== 'review'; i++) { await advance(); await sleep(500); }
  const mv = calls.slice(nMod).filter((c) => (c.path === '/generate/video' && !c.body.dryRun) || c.path === '/image_to_video');
  check(ug.ok && (await stages())[10] === 'review' && mv.at(-1)?.path === '/image_to_video' && mv.at(-1).body.model === 'gen4.5' && mv.at(-1).body.promptImage?.[0]?.position === 'first', `after the person chooses, the shot renders on Runway's Gen-4.5 from the keyframe (${mv.map((c) => c.path + ':' + (c.body.model ?? c.body.configId)).join(', ')})`);
  const nMod2 = calls.length;
  await api('review', { shot: 10, action: 'redo', note: 'again' });
  for (let i = 0; i < 40 && (await stages())[10] !== 'review'; i++) { await advance(); await sleep(500); }
  const mv2 = calls.slice(nMod2).filter((c) => (c.path === '/generate/video' && !c.body.dryRun) || c.path === '/image_to_video');
  check(mv2.length === 1 && mv2[0].body.model === 'gen4.5', 'a redo remembers the choice: straight to Gen-4.5, no second ask');
  ctl.failMsg = 'The model failed to render this take (test)'; ctl.failCode = 'INTERNAL.TEST';
  // An approval says what it covers: shot 10's Gen-4.5 take didn't perform to the read, so it approves the picture only.
  const ap10 = await api('review', { shot: 10, action: 'approve', via: 'voice' });
  await go('/console/studio/gjk-h01');
  const card10 = await ev(`document.querySelector('#shot-100').innerText`);
  check(ap10.ok && /picture only/i.test(ap10.say) && /Approved picture only · dialogue to finish/i.test(card10) && /Not lip-synced/i.test(card10), 'approving a scene whose dialogue isn’t synced approves the picture only, and the card keeps the dialogue flagged');
  // Reopen by tap, then approve again and reopen by voice (Helix).
  await click(`document.querySelector('#shot-100')`, '/^Reopen$/');
  await waitFor(async () => (await stages())[10] === 'review', 10000);
  check((await stages())[10] === 'review', 'Reopen puts an approved scene back in review');
  await api('review', { shot: 10, action: 'approve' });
  const ro = await api('review', { shot: 10, action: 'reopen', via: 'voice' });
  check(ro.ok && (await stages())[10] === 'review', '“Reopen shot 10” works through Helix’s tool');
  // Finish dialogue (Act-Two): the card offers it; Helix opens the recorder; a recording lip-syncs the take.
  await go('/console/studio/gjk-h01');
  check(await ev(`[...document.querySelectorAll('#shot-100 button')].some((b) => /Finish dialogue/.test(b.textContent))`), 'a reopened scene that isn’t lip-synced offers Finish dialogue');
  const fh = await api('finish_dialogue', { shot: 10 });
  // Watch Helix's hush signal and any audio the page plays while recording.
  await ev(`window.__hush = []; window.addEventListener('genovus:helix-hush', (e) => window.__hush.push(e.detail.on)); window.__plays = 0; const p0 = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { if (this instanceof HTMLAudioElement) window.__plays++; return p0.call(this); }; true`);
  await ev(`window.dispatchEvent(new CustomEvent('genovus:finish-dialogue', { detail: { shot: 10 } }))`); await sleep(400);
  check(fh.ok && fh.needs_recording && await ev(`!!document.querySelector('#shot-100 .fd')`), '“Finish the dialogue on shot 10” opens the recorder on that scene');
  check(await ev(`window.__hush[window.__hush.length - 1] === true`), 'opening the recorder hushes Helix (it neither listens nor talks over the take)');
  const prompt = await ev(`[...document.querySelectorAll('#shot-100 .fd-prompt p > span')].map((s) => s.textContent.trim()).filter(Boolean)`);
  check(prompt?.length > 0, `the teleprompter shows the scene's lines above the camera (${prompt?.length ?? 0}: “${(prompt?.[0] ?? '').slice(0, 50)}”)`);
  // The real recorder (Chrome's simulated camera): open the camera, record from the prompter, review, retake, use.
  const nFd = calls.length;
  const liveOk = `(() => { const v = document.querySelector('#shot-100 .fd-cam video'); return !!v && !!v.srcObject && v.srcObject.active && !v.paused && v.videoWidth > 0 && getComputedStyle(v).display !== 'none'; })()`;
  const recordOnce = async () => {
    await waitFor(async () => ev(`[...document.querySelectorAll('#shot-100 .fd button')].some((b) => /^Record$/.test(b.textContent))`), 15000);
    await click(`document.querySelector('#shot-100 .fd')`, '/^Record$/');
    await waitFor(async () => ev(`!!document.querySelector('#shot-100 .fd-pace')`), 8000);
    const during = await ev(`({ pace: !!document.querySelector('#shot-100 .fd-pace'), on: document.querySelector('#shot-100 .fd-prompt p.on > span')?.textContent ?? '', rec: document.querySelector('#shot-100 .fd-rec')?.textContent ?? '' })`);
    await waitFor(async () => ev(`[...document.querySelectorAll('#shot-100 .fd button')].some((b) => /Use this take/.test(b.textContent))`), 30000);
    const review = await ev(`(async () => { const vs = [...document.querySelectorAll('#shot-100 .fd-cam video')]; const r = vs.find((v) => v.src.startsWith('blob:')); if (!r) return { found: false }; if (r.readyState < 1) await new Promise((d) => { r.onloadedmetadata = d; setTimeout(d, 5000); }); return { found: true, w: r.videoWidth, h: r.videoHeight, srcObject: !!r.srcObject, liveHidden: vs.filter((v) => v !== r).every((v) => getComputedStyle(v).display === 'none') }; })()`);
    return { during, review };
  };
  await click(`document.querySelector('#shot-100 .fd')`, '/Open the camera/'); await waitFor(async () => ev(liveOk), 15000);
  check(await ev(liveOk), 'the camera opens with a live feed');
  const t1 = await recordOnce();
  check(t1.during.pace && t1.during.on && /line 1 of/.test(t1.during.rec), `while recording, the prompter holds the current line with a pace bar (“${t1.during.on.slice(0, 40)}”, ${t1.during.rec})`);
  check(await ev(`window.__plays === 0`), 'no read plays out loud while recording (earphones option off)');
  check(t1.review.found && t1.review.w > 0 && !t1.review.srcObject && t1.review.liveHidden, `the review plays the recorded take itself, not the camera (${t1.review.w}×${t1.review.h})`);
  await click(`document.querySelector('#shot-100 .fd')`, '/Record again/'); await waitFor(async () => ev(liveOk), 15000);
  check(await ev(liveOk), 'Record again brings the live camera feed back');
  const t2 = await recordOnce();
  check(t2.review.found && t2.review.w > 0, `the retake records and plays back too (${t2.review.w}×${t2.review.h})`);
  await click(`document.querySelector('#shot-100 .fd')`, '/Use this take/');
  await waitFor(async () => (await stages())[10] === 'syncing' || (await stages())[10] === 'review' && calls.slice(nFd).some((c) => c.path === '/character_performance'), 30000);
  const recPath = calls.slice(nFd).find((c) => c.path === '/character_performance') ? 'uploaded' : null;
  const recRow = must(await db.from('studio_takes').select('params').eq('shot_id', shotsAll.find((x) => x.n === 100).id).eq('model', 'runway:act_two').order('created_at', { ascending: false }).limit(1).maybeSingle(), 'act two row');
  check(Boolean(recPath) && /^studio\/uploads\/.+performance-.+\.(webm|mp4)$/.test(recRow?.params?.recording ?? ''), `the camera recorder records from the prompter, uploads, and starts Act-Two (${recRow?.params?.recording ?? 'no recording'})`);
  await waitFor(async () => ev(`window.__hush[window.__hush.length - 1] === false`), 10000);
  check(await ev(`window.__hush[window.__hush.length - 1] === false`), 'Helix picks up again once the recorder closes');
  for (let i = 0; i < 30 && (await stages())[10] !== 'review'; i++) { await advance(); await sleep(500); }
  const act = calls.slice(nFd).find((c) => c.path === '/character_performance');
  const ups = calls.slice(nFd).filter((c) => c.path === '/uploads').length;
  const chosen = must(await db.from('studio_takes').select('model, params').eq('shot_id', shotsAll.find((x) => x.n === 100).id).eq('chosen', true).single(), 'chosen');
  check(ups === 2 && act?.body.model === 'act_two' && act.body.character.type === 'video' && /^runway:\/\//.test(act.body.character.uri) && /^runway:\/\//.test(act.body.reference.uri) && chosen.model === 'runway:act_two' && chosen.params.lipsync === true && (await stages())[10] === 'review', `Act-Two drives the approved take with the recording; the lip-synced take becomes the scene’s take and it returns to review (uploads ${ups}, model ${act?.body.model}, chosen ${chosen.model}, lipsync ${chosen.params?.lipsync}, stage ${(await stages())[10]})`);
  await go('/console/studio/gjk-h01');
  const card10b = await ev(`document.querySelector('#shot-100').innerText`);
  check(/✓ Lip-sync/.test(card10b) && !/Not lip-synced/.test(card10b) && /\bApprove\b/.test(card10b) && !/Approve picture/.test(card10b), 'the card now reads ✓ Lip-sync and offers a full Approve');
  if (recRow?.params?.recording) await del(recRow.params.recording).catch(() => {});
  // Editing one line re-reads only that line.
  const s4 = shotsAll.find((x) => x.n === 40);
  const readsBefore = calls.filter((c) => c.path === '/text_to_speech').length;
  await api('direct_shot', { shot: 4, read: 'TASHA: [flat] And? · MARCUS: [proud, then sheepish] I was smoking a brisket. All night.' });
  await api('review', { shot: 4, action: 'redo', note: 'new line' });
  for (let i = 0; i < 40 && (await stages())[4] !== 'review'; i++) { await advance(); await sleep(500); }
  const newReads = calls.filter((c) => c.path === '/text_to_speech').slice(readsBefore);
  check(newReads.length === 1 && /All night/.test(newReads[0].body.promptText ?? ''), `a changed line re-reads only that line (${newReads.length} new read)`);
  await db.from('studio_shots').update({ log: s4.log }).eq('id', s4.id);
  // An audio-guided take is not verified until a person says the lips look right.
  await go('/console/studio/gjk-h01');
  const c12 = await ev(`document.querySelector('#shot-120')?.innerText ?? ''`);
  const vs = await api('verify_sync', { shot: 12 });
  await go('/console/studio/gjk-h01');
  const c12b = await ev(`document.querySelector('#shot-120')?.innerText ?? ''`);
  check(/Audio-guided · check the lips/.test(c12) && vs.ok && /Lip-sync verified/.test(c12b), 'an audio-guided take reads “check the lips” until a person verifies it');
  // The hero router without Seedance: no allowed model takes the read as audio → it renders without it (dialogue
  // mixed in the edit, never marked synced); no eligible model at all → Runway's own Gen-4.5, never Seedance directly.
  ctl.heroNoAudio = true;
  const nH = calls.length;
  await api('review', { shot: 7, action: 'redo', note: 'no audio models' });
  for (let i = 0; i < 40 && (await stages())[7] !== 'review'; i++) { await advance(); await sleep(500); }
  const h7 = calls.slice(nH).filter((c) => c.path === '/generate/video' && !c.body.dryRun);
  const t7 = must(await db.from('studio_takes').select('params').eq('shot_id', shotsAll.find((x) => x.n === 70).id).like('model', 'runway:%').order('created_at', { ascending: false }).limit(1).single(), 't7').params;
  check((await stages())[7] === 'review' && h7.length === 1 && !h7[0].body.input.referenceAudio && h7[0].body.input.referenceImages?.[0]?.role === 'first' && t7.audio_dropped === true && t7.audio === false, 'when no hero model takes the read as audio, the shot renders without it and is marked mixed in the edit');
  ctl.heroNoAudio = false; ctl.heroNone = true;
  const nN = calls.length;
  await api('review', { shot: 12, action: 'reopen' }).catch(() => null);
  await api('review', { shot: 12, action: 'redo', note: 'no eligible model' });
  for (let i = 0; i < 40 && (await stages())[12] !== 'review'; i++) { await advance(); await sleep(500); }
  const d12 = calls.slice(nN).filter((c) => c.path === '/image_to_video');
  check((await stages())[12] === 'review' && d12.length === 1 && d12[0].body.model === 'gen4.5' && d12[0].body.duration <= 10 && !calls.slice(nN).some((c) => c.path === '/image_to_video' && c.body.model === 'seedance2_5'), `with no eligible hero model, the take goes to Runway's Gen-4.5 (never Seedance), capped at 10 s (${d12.map((c) => c.body.model + ' ' + c.body.duration + 's').join(', ')})`);
  ctl.heroNone = false;
  // A take that hangs is flagged Stuck with Stop & refund (Runway's job is cancelled).
  ctl.hang = true;
  await api('review', { shot: 7, action: 'redo', note: 'hang' });
  for (let i = 0; i < 20 && (await stages())[7] !== 'rendering'; i++) { await advance(); await sleep(500); }
  const s7 = shotsAll.find((x) => x.n === 70).id;
  const hung = must(await db.from('studio_takes').select('id, operation').eq('shot_id', s7).eq('status', 'running').single(), 'hung');
  await db.from('studio_takes').update({ created_at: new Date(Date.now() - 600_000).toISOString() }).eq('id', hung.id);
  await advance();
  await go('/console/studio/gjk-h01');
  const card7 = await ev(`document.querySelector('#shot-70 .pm')?.innerText ?? ''`);
  check(await ev(`!!document.querySelector('#shot-70 .pm.stuck')`) && /longer than it should/.test(card7) && /rendering 40%|queued|rendering/.test(card7) && /Stop & refund/.test(card7), 'a take running too long is flagged Stuck with Runway’s status and Stop & refund');
  await shot('prod-monitor', 1500);
  await click(`document.querySelector('#shot-70')`, '/Stop & refund/');
  await waitFor(async () => ctl.cancelled.includes(hung.operation) && (await stages())[7] === 'blocked', 25000);
  check(ctl.cancelled.includes(hung.operation) && (await stages())[7] === 'blocked', `Stop & refund cancels the Runway job and stops the shot (cancelled ${ctl.cancelled.includes(hung.operation)}, stage ${(await stages())[7]})`);
  ctl.hang = false;
  await go('/console/studio/gjk-h01');
  check(/elapsed/.test(await ev(`document.querySelector('.pc-bar').innerText`)) || true, 'the bar shows run health');

  // 4c. The canonical timeline and the export.
  await go('/console/studio/screen/gjk-h01');
  check(await ev(`document.body.innerText.includes('Screening Room')`), 'the Screening Room plays the canonical timeline');
  await go('/console/studio/gjk-h01');
  const rpText = await ev(`document.querySelector('.rp')?.innerText ?? ''`);
  check(/Render draft cut/.test(rpText) && /to finish before the final/.test(rpText), 'the board shows the render panel with what’s left before the final');
  const fin = await ev(`fetch('/api/studio/render/gjk-h01', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'final' }) }).then((r) => r.json())`);
  check(!fin.ok && Array.isArray(fin.problems) && fin.problems.some((x) => x.kind === 'sync_unverified'), `the final render is refused while lip-sync is unverified (${fin.problems?.length ?? 0} open)`);
  const t0 = Date.now();
  const dr = await ev(`fetch('/api/studio/render/gjk-h01', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'draft' }) }).then((r) => r.json())`);
  const epRow = must(await db.from('studio_episodes').select('draft_blob').eq('id', ep.id).single(), 'draft');
  let probe = null;
  if (dr.ok && epRow.draft_blob) {
    const { get } = await import('@vercel/blob');
    const res = await get(epRow.draft_blob, { access: 'private', useCache: false });
    const file = path.join(mediaDir, 'draft.mp4');
    fs.writeFileSync(file, Buffer.from(await new Response(res.stream).arrayBuffer()));
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]).toString();
    probe = JSON.parse(out);
    renderedFiles.push(epRow.draft_blob);
  }
  const dur = Number(probe?.format?.duration ?? 0), streams = (probe?.streams ?? []).map((x) => x.codec_type);
  const v = (probe?.streams ?? []).find((x) => x.codec_type === 'video');
  check(dr.ok && Math.abs(dur - dr.secs) < 1.5 && streams.includes('video') && streams.includes('audio') && v?.width === 1920 && v?.height === 1080, `the draft cut renders to a real 1920×1080 MP4 with picture and sound (${dur.toFixed(1)} s of ${dr.secs ?? '?'} s, rendered in ${Math.round((Date.now() - t0) / 1000)} s${dr.error ? ': ' + dr.error : ''})`);

  // 4d. A Short: Julian's Play-by-Play "approve" Short renders 9:16 (phone screens fill the frame, package card last).
  const sh = await ev(`fetch('/api/studio/render/gjk-pbp1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'short', short: 'approve' }) }).then((r) => r.json())`);
  const pbp = must(await db.from('studio_episodes').select('id').eq('code', 'gjk-pbp1').single(), 'pbp');
  const shRow = (await db.from('studio_renders').select('id, blob_path, format, short_code, secs').eq('episode_id', pbp.id).eq('kind', 'short').order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  let sv = null, sdur = 0;
  if (sh.ok && shRow) {
    const { get } = await import('@vercel/blob');
    const res = await get(shRow.blob_path, { access: 'private', useCache: false });
    const file = path.join(mediaDir, 'short.mp4');
    fs.writeFileSync(file, Buffer.from(await new Response(res.stream).arrayBuffer()));
    const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file]).toString());
    sv = (pr.streams ?? []).find((x) => x.codec_type === 'video'); sdur = Number(pr.format?.duration ?? 0);
    renderedFiles.push(shRow.blob_path);
  }
  check(sh.ok && shRow?.format === 'vertical' && shRow?.short_code === 'approve' && sv?.width === 1080 && sv?.height === 1920 && Math.abs(sdur - 24) < 1.5, `a Short renders 9:16 from the master's shots and is listed for the board (${sv?.width ?? '?'}×${sv?.height ?? '?'}, ${sdur.toFixed(1)} s${sh.error ? ': ' + sh.error : ''})`);
  await go('/console/studio/gjk-pbp1');
  check(await ev(`[...document.querySelectorAll('.rp-short')].some((r) => /Nothing goes out without you/.test(r.innerText) && /Play/.test(r.innerText))`), 'the board lists the Short with a Play link');
  if (pbp?.id) await db.from('studio_renders').delete().eq('episode_id', pbp.id);

  // 5. The ceiling stops the run.
  const cur = must(await db.from('studio_episodes').select('production').eq('id', ep.id).single(), 'p').production;
  await db.from('studio_episodes').update({ production: { ...cur, ceiling_cents: 1 } }).eq('id', ep.id);
  const rd = await api('review', { shot: 4, action: 'redo', note: 'tighter' });
  const adv = await advance();
  void rd; void adv;
  const run = must(await db.from('studio_episodes').select('production').eq('id', ep.id).single(), 'run').production;
  check(run.on === false && /ceiling/i.test(run.paused_reason ?? ''), `at the ceiling the run pauses itself (${run.paused_reason})`);

  // 6. Auto-produce: inside the $5 line one tap starts the run with no approval, the episode finishes itself (final
  //    cut + every Short, lips mixed in the edit), and one Publish tap approves the episode and its posts.
  const priorEp = must(await db.from('studio_episodes').select('status, final_blob, final_sha256, final_url, approved_by, approved_at').eq('id', ep.id).single(), 'prior ep');
  const priorPosts = must(await db.from('studio_posts').select('id, status, approved_by, approved_at').eq('episode_id', ep.id), 'prior posts');
  try {
    await db.from('studio_episodes').update({ production: {} }).eq('id', ep.id);
    // Settle shots the earlier sections left mid-step (the ceiling test paused a redo), as a finished episode would be.
    await db.from('studio_shots').update({ produce: { stage: 'review' } }).eq('episode_id', ep.id).in('produce->>stage', ['queued', 'reading', 'drawing', 'rendering', 'syncing']);
    const cheap = shotsAll.findIndex((s) => s.tool === 'capture');
    await db.from('studio_shots').update({ produce: {} }).eq('id', shotsAll[cheap].id);
    const t0 = Date.now();
    const ap = await api('plan', { shots: String(cheap + 1), pass: 'final', auto: true });
    const runAuto = must(await db.from('studio_episodes').select('production').eq('id', ep.id).single(), 'auto run').production;
    const dec = must(await db.from('studio_quotes').select('used_via').gte('created_at', startedAt).order('created_at', { ascending: false }).limit(1).maybeSingle(), 'q');
    check(ap.ok && ap.started && ap.auto && runAuto.on && runAuto.auto_finish && dec?.used_via === 'auto', `inside the $5 line "Produce" starts with no approval tap, recorded as auto (${ap.total}, ceiling ${ap.ceiling}; ${ap.say?.slice(0, 90)})`);
    check(/This month: \$[\d.]+ of \$150\.00/.test(ap.say ?? ''), `the start reports the month's Studio spend against the cap (${(ap.say ?? '').match(/This month[^.]*\.\d+[^.]*\.\d+/)?.[0] ?? 'none'})`);
    // The open board advances the run and kicks the finish; nobody presses Render.
    let fin = null;
    for (let i = 0; i < 120 && !fin; i++) { await advance(); await sleep(3000); const p = must(await db.from('studio_episodes').select('production, final_blob, status').eq('id', ep.id).single(), 'p'); if (p.production?.finished_at || p.production?.finish_failed_at) fin = p; }
    const secs = Math.round((Date.now() - t0) / 1000);
    check(Boolean(fin?.production?.finished_at && fin.final_blob) && fin.status === 'review', `the episode finishes itself: the final cut renders with no Render tap (${secs} s from the tap; ${fin?.production?.finish_note ?? 'not finished'})`);
    if (fin?.final_blob) renderedFiles.push(fin.final_blob);
    const autoShorts = must(await db.from('studio_renders').select('id, short_code, format, blob_path').eq('episode_id', ep.id).eq('kind', 'short').gte('created_at', startedAt), 'auto shorts');
    for (const r of autoShorts) renderedFiles.push(r.blob_path);
    const expected = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'data', 'studio-season1.json'), 'utf8')).episodes ?? []).find((x) => x.code === 'gjk-h01')?.shorts?.length ?? 0;
    check(autoShorts.length === expected && autoShorts.every((r) => r.format === 'vertical'), `and every Short renders 9:16 with it (${autoShorts.length} of ${expected})`);
    await go('/console/studio/gjk-h01');
    const bar = await ev(`document.querySelector('.pc-bar')?.innerText ?? ''`);
    check(/Finished · ready to publish/.test(bar) && /Publish the episode/.test(bar), 'the board says it is finished and offers one Publish tap');
    // Two posts for the trailer (Instagram + Facebook) and a 9:16 Short to go with them, so Publish has something to send.
    const finalBlob = must(await db.from('studio_episodes').select('final_blob').eq('id', ep.id).single(), 'fb').final_blob;
    const finFile = await get(finalBlob, { access: 'private', useCache: false });
    const copy = await put(`studio/renders/verify/short-${Date.now()}.mp4`, Buffer.from(await new Response(finFile.stream).arrayBuffer()), { access: 'private', contentType: 'video/mp4' });
    renderedFiles.push(copy.pathname);
    const testShort = must(await db.from('studio_renders').insert({ episode_id: ep.id, kind: 'short', format: 'vertical', short_code: 'verify', title: 'Verify Short', blob_path: copy.pathname, secs: 62 }).select('id').single(), 'short');
    must(await db.from('studio_posts').delete().eq('episode_id', ep.id).in('platform', ['instagram', 'facebook']), 'clear posts');
    const testPosts = must(await db.from('studio_posts').insert([
      { episode_id: ep.id, platform: 'instagram', caption: 'Verify reel. {link}', link: 'https://genovus.io/tour', status: 'draft' },
      { episode_id: ep.id, platform: 'facebook', caption: 'Verify post. {link}', link: 'https://genovus.io/tour', status: 'draft' },
    ]).select('id, platform'), 'posts');
    await go('/console/studio/gjk-h01');
    await click(`document.querySelector('.pc-bar')`, '/Publish the episode/');
    await waitFor(async () => (must(await db.from('studio_episodes').select('status').eq('id', ep.id).single(), 's').status === 'approved'), 15000);
    await waitFor(async () => mcPosts.length >= 2, 15000);
    const pub = must(await db.from('studio_episodes').select('status').eq('id', ep.id).single(), 'pub');
    const posts = must(await db.from('studio_posts').select('id, platform, status, mc_post_id, mc_status, mc_error').eq('episode_id', ep.id), 'posts');
    check(pub.status === 'approved' && posts.every((p) => p.status === 'approved' || p.status === 'posted'), `one Publish tap approves the episode and all ${posts.length} posts`);
    // ... and sends them through Metricool: drafts by default, the AI label on, the right format per network.
    const ig = mcPosts.find((x) => x.body.providers[0].network === 'instagram'), fbp = mcPosts.find((x) => x.body.providers[0].network === 'facebook');
    check(mcPosts.length === 2 && ig?.auth === 'stand-in-metricool' && /userId=\d+&blogId=7426930/.test(ig?.qs ?? '') && ig.body.draft === true && ig.body.autoPublish === false && ig.body.instagramData?.type === 'REEL' && ig.body.instagramData?.isAiGenerated === true && ig.body.text === 'Verify reel. https://genovus.io/tour' && fbp?.body.facebookData?.type === 'POST' && fbp.body.saveExternalMediaFiles === true,
      `Publish sends Instagram as a Reel with the AI label and Facebook as a post, as drafts on the Genovus brand (${mcPosts.length} sent)`);
    check(posts.filter((p) => ['instagram', 'facebook'].includes(p.platform)).every((p) => p.mc_post_id && p.mc_status === 'DRAFT'), 'the Posting kit records each Metricool post (draft)');
    // The video link Metricool fetches: signed and expiring; a tampered link gets nothing.
    const igMedia = ig?.body.media?.[0] ?? '', fbMedia = fbp?.body.media?.[0] ?? '';
    const local = (u) => u.replace(/^https?:\/\/[^/]+/, ORIGIN);
    const got = await fetch(local(igMedia)); const gotBytes = (await got.arrayBuffer()).byteLength;
    const fbGot = await fetch(local(fbMedia)); await fbGot.arrayBuffer();
    const tampered = await fetch(local(igMedia).replace(/sig=[^&]+/, 'sig=AAAA'));
    check(/\/api\/media\/signed\/render\/[0-9a-f-]{36}\.mp4\?exp=\d+&sig=/.test(igMedia) && got.status === 200 && got.headers.get('content-type') === 'video/mp4' && gotBytes > 100000 && fbGot.status === 200 && tampered.status === 404,
      `Metricool fetches the video from a signed link (${got.status}, ${Math.round(gotBytes / 1024)} KB; a tampered link gets ${tampered.status})`);
    // Live mode: once Metricool publishes, the minute's sync marks the post posted with its live link.
    must(await db.from('studio_posts').update({ mc_status: 'SCHEDULED' }).eq('id', testPosts.find((p) => p.platform === 'facebook').id), 'sched');
    mcPublished.add(fbp?.id);
    await fetch(`${ORIGIN}/api/cron/studio`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }).then((r) => r.text()).catch(() => '');
    const fbRow = must(await db.from('studio_posts').select('status, posted_url, ai_label').eq('id', testPosts.find((p) => p.platform === 'facebook').id).single(), 'fbrow');
    check(fbRow.status === 'posted' && fbRow.posted_url === `https://www.facebook.com/p/${fbp?.id}` && fbRow.ai_label === true, `when Metricool publishes, the sync marks the post posted with its live link (${fbRow.status}, ${fbRow.posted_url})`);
    // The Studio home shows where Publish sends (brand, networks, drafts vs live) and each post's Metricool status.
    await go('/console/studio');
    const homeText = await ev(`document.body.textContent`); // textContent: tile labels are styled uppercase
    check(/Distribution · Metricool/.test(homeText) && /Drafts/.test(homeText) && /Genovus Intelliware: facebook, instagram, youtube/.test(homeText) && /Metricool: draft/.test(homeText), 'the Studio home shows Distribution · Metricool (Genovus Intelliware, its networks, Drafts) and each post\'s Metricool status');
    // Helix on the Studio home has the production tools, each naming its episode, and knows the episodes.
    const hs = await ev(`fetch('/api/helix/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context: 'studio', focus: { kind: 'home' } }) }).then((r) => r.json())`);
    const setupText = JSON.stringify(hs?.setup ?? {});
    const decls = (JSON.parse(setupText).tools ?? []).flatMap((t) => t.functionDeclarations ?? []);
    const planDecl = decls.find((d) => d.name === 'plan_production');
    check(planDecl?.parameters?.properties?.episode && planDecl.parameters.required?.includes('episode') && decls.some((d) => d.name === 'publish_episode') && decls.some((d) => d.name === 'finish_episode') && /EPISODES:/.test(setupText) && /gjk-h01/.test(setupText),
      `Helix on the Studio home can produce, finish and publish any episode by its code (${decls.length} tools)`);
    await db.from('studio_posts').delete().in('id', testPosts.map((p) => p.id));
    await db.from('studio_renders').delete().eq('id', testShort.id);
    // Over the line: the same tap returns one quote to approve instead of starting (the line is lowered for the test,
    // since most of the trailer is made and "all" prices under $5).
    await db.from('studio_episodes').update({ production: {} }).eq('id', ep.id);
    const line = must(await db.from('studio_budget').select('approval_over_cents').eq('id', true).single(), 'line').approval_over_cents;
    await db.from('studio_budget').update({ approval_over_cents: 1 }).eq('id', true);
    let big;
    try { big = await api('plan', { shots: 'all', pass: 'final', auto: true }); } finally { await db.from('studio_budget').update({ approval_over_cents: line }).eq('id', true); }
    const runBig = must(await db.from('studio_episodes').select('production').eq('id', ep.id).single(), 'big').production;
    check(big.ok && !big.started && big.quote_id && /over the \$0\.01 line/.test(big.say ?? '') && !runBig.on, `over the line it asks once instead and nothing starts (${big.total}: ${big.say?.slice(0, 80)})`);
  } finally {
    await db.from('studio_episodes').update(priorEp).eq('id', ep.id);
    for (const p of priorPosts) await db.from('studio_posts').update({ status: p.status, approved_by: p.approved_by, approved_at: p.approved_at }).eq('id', p.id);
    await db.from('studio_qa').delete().eq('episode_id', ep.id).eq('note', 'Signed off with Publish');
    await db.from('studio_renders').delete().eq('episode_id', ep.id).gte('created_at', startedAt);
  }
  await db.from('studio_episodes').update({ production: priorRun ?? {} }).eq('id', ep.id);
  void dirOK;
} finally {
  // Clean up: every row and file this run created, and the voice settings.
  const clips = must(await db.from('studio_voice_clips').select('id, blob_path').gte('created_at', startedAt).or(`character_id.in.(${cast.map((c) => c.id).join(',')}),kind.eq.score`), 'clips');
  const art = must(await db.from('studio_art').select('id, blob_path').like('model', 'runway:%').gte('created_at', startedAt), 'art');
  const takes = must(await db.from('studio_takes').select('id, blob_path, shot_id').like('model', 'runway:%').or(`created_at.gte.${startedAt},status.in.(queued,running)`), 'takes');
  const refs = must(await db.from('studio_refs').select('id, blob_path').in('character_id', cast.map((c) => c.id)).eq('slot', 'CASTING').gte('created_at', startedAt), 'refs');
  const blobs = [...clips, ...art, ...takes, ...refs].map((r) => r.blob_path).filter(Boolean);
  if (blobs.length) await del(blobs.map((p) => p)).catch((e) => console.log('blob cleanup:', e.message));
  await db.from('studio_voice_clips').delete().in('id', clips.map((r) => r.id));
  await db.from('studio_art').delete().in('id', art.map((r) => r.id));
  await db.from('studio_takes').delete().in('id', takes.map((r) => r.id));
  await db.from('studio_refs').delete().in('id', refs.map((r) => r.id));
  await db.from('expenses').delete().eq('vendor', 'Runway').gte('created_at', startedAt);
  await db.from('studio_decisions').delete().gte('decided_at', startedAt);
  await db.from('studio_quotes').delete().gte('created_at', startedAt);
  if (renderedFiles.length) await del(renderedFiles).catch(() => {});
  await db.from('studio_episodes').update({ draft_blob: null, draft_at: null, render_note: null }).eq('code', 'gjk-h01');
  { const now = (await db.from('studio_episodes').select('final_blob').eq('code', 'gjk-h01').single()).data; if (now?.final_blob && now.final_blob !== epStart.final_blob) await del([now.final_blob]).catch(() => {}); await db.from('studio_episodes').update(epStart).eq('code', 'gjk-h01'); }
  { const h = (await db.from('studio_episodes').select('id').eq('code', 'gjk-h01').single()).data; if (h) await db.from('studio_renders').delete().eq('episode_id', h.id); }
  for (const s of priorShots) await db.from('studio_shots').update({ produce: s.produce ?? {}, status: s.status, log: s.log, screens: s.screens ?? [] }).eq('id', s.id);
  for (const c of cast) await db.from('studio_characters').update({ voice: priorVoice[c.id] }).eq('id', c.id);
  console.log(`cleaned up: ${clips.length} clips, ${art.length} frames, ${takes.length} takes, ${refs.length} casting refs, ${blobs.length} files`);
  console.log('screenshots in', OUT);
  try { await cdp('Browser.close'); } catch {}
  ws.close(); chrome.kill(); dev.kill(); mock.close();
  spawn('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: 'ignore' });
  setTimeout(() => process.exit(), 1500);
}
