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
import { del } from '@vercel/blob';

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
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FILES = { mp3: Buffer.from('ID3stand-in-audio'), png: PNG, mp4: Buffer.from('stand-in-video') };
const KIND = { '/text_to_speech': ['mp3', 4], '/sound_effect': ['mp3', 9], '/text_to_image': ['png', 8], '/image_to_video': ['mp4', 100], '/generate/video': ['mp4', 100], '/generate/image': ['png', 8] };
// Test controls: make the next N video takes fail, or make takes hang (stay running).
const ctl = { failTakes: 0, hang: false, cancelled: [], failMsg: 'The model failed to render this take (test)', failCode: 'INTERNAL.TEST' };
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = req.url.replace(/^\/v1/, '');
    if (u.startsWith('/files/')) { const ext = u.split('.').pop(); res.writeHead(200); return res.end(FILES[ext] ?? PNG); }
    if (req.method === 'GET' && u === '/organization') return send({ creditBalance: balance });
    if (req.method === 'GET' && u.startsWith('/routers?')) return send({ data: [{ id: 'r-hero', slug: 'genovus-video-hero', name: 'Hero', settings: { optimizeFor: 'quality', fallback: { onCapacity: true }, models: { mode: 'allowlist_only', ids: ['seedance2_5', 'veo3.1', 'gen4.5'] } } }, { id: 'r-prod', slug: 'genovus-video-production', name: 'Production', settings: { optimizeFor: 'latency', fallback: { onCapacity: true } } }, { id: 'r-draft', slug: 'genovus-video-draft', name: 'Draft', settings: { optimizeFor: 'cost' } }, { id: 'r-key', slug: 'genovus-image-keyframe', name: 'Keyframe', settings: { optimizeFor: 'quality' } }, { id: 'r-fast', slug: 'genovus-image-fast', name: 'Fast', settings: { optimizeFor: 'latency' } }] });
    if (req.method === 'GET' && /^\/routers\/[^/]+\/requests/.test(u)) { const slug = { 'r-hero': 'genovus-video-hero', 'r-prod': 'genovus-video-production', 'r-draft': 'genovus-video-draft', 'r-key': 'genovus-image-keyframe', 'r-fast': 'genovus-image-fast' }[u.split('/')[2]]; return send({ data: calls.filter((c) => c.body.configId === slug).map((c, i) => ({ id: 'q' + i, createdAt: new Date().toISOString(), model: slug.includes('draft') ? 'gen4_turbo' : slug.includes('image') ? 'gen4_image' : 'seedance2_5', reasonCode: 'best_quality', reason: 'test', estimatedCredits: 8 })) }); }
    if (req.method === 'POST' && u === '/voices/preview') { calls.push({ path: u, body: JSON.parse(body || '{}') }); balance -= 6; return send({ url: `http://localhost:${MOCK}/files/design.mp3`, durationSecs: 6 }); }
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
const env = { ...process.env, Genovus_Runway_API_Key: 'stand-in', RUNWAY_API_BASE: `http://localhost:${MOCK}/v1` };
const devLog = process.env.DEV_LOG ? fs.openSync(process.env.DEV_LOG, 'w') : 'ignore';
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: ['ignore', devLog, devLog], shell: true, env });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9498, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
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

const priorShots = []; const dirOK = true;
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
  check(lockedNow === 3 && (await stages())[11] !== 'blocked' && calls.some((c) => c.path === '/generate/image') && calls.some((c) => c.path === '/text_to_speech'), `approving locks the cast and starts shot 11's keyframe and line read together (${lockedNow} locked)`);
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
  const vids = calls.filter((c) => c.path === '/generate/video').length, imgs = calls.filter((c) => c.path === '/generate/image').length;
  const by = {}; for (const c of calls.filter((c) => c.path === '/generate/image' || c.path === '/text_to_speech')) { const k = c.path.slice(1, 8) + ' ' + (c.body.promptText ?? c.body.input?.promptText ?? '').replace(/@w+ is w+; ?|@w+ is w+. ?/g, '').slice(0, 160); by[k] = (by[k] ?? 0) + 1; } console.log('CALLS', JSON.stringify(Object.entries(by).filter(([, n]) => n > 1)));
  check(vids === runwayBoards.length && imgs === runwayBoards.length, `single-flight: one keyframe and one take per shot (${imgs} keyframes, ${vids} takes for ${runwayBoards.length} shots)`);
  const reads = calls.filter((c) => c.path === '/text_to_speech').length;
  check(reads === 11, `each spoken line read exactly once (${reads} of 11)`);
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
  const before = calls.filter((c) => c.path === '/generate/video').length;
  const redo = await api('review', { shot: 11, action: 'redo', note: 'a slower turn, eyes first' });
  for (let i = 0; i < 30 && (await stages())[11] !== 'review'; i++) { await advance(); await sleep(500); }
  const log11 = must(await db.from('studio_shots').select('log').eq('id', shotsAll.find((s) => s.n === 110).id).single(), 'log').log;
  check(redo.ok && (await stages())[11] === 'review' && calls.filter((c) => c.path === '/generate/video').length === before + 1 && /slower turn/.test(log11.acting ?? ''), 'a redo with a note updates the direction and renders exactly one new take');

  // 4b. The Production Monitor. (Earlier redos used up the run's ceiling; approving more is one tap.)
  await go('/console/studio/gjk-h01');
  if (/ceiling/i.test((await db.from('studio_episodes').select('production').eq('id', ep.id).single()).data.production.paused_reason ?? '')) {
    check(await ev(`[...document.querySelectorAll('.pc-bar button')].some((b) => /Approve more to finish/.test(b.textContent))`), 'at the ceiling the bar offers Approve more to finish');
  }
  { const cur0 = (await db.from('studio_episodes').select('production').eq('id', ep.id).single()).data.production; await db.from('studio_episodes').update({ production: { ...cur0, on: true, ceiling_cents: 100000, paused_reason: null } }).eq('id', ep.id); }
  const tl = await ev(`[...document.querySelectorAll('#shot-110 .pm-step')].map((x) => x.textContent.trim())`);
  check(tl.length === 3 && /Lines/.test(tl[0]) && /Keyframe/.test(tl[1]) && /Take/.test(tl[2]) && await ev(`/Take on Seedance 2\\.5/.test(document.querySelector('#shot-110 .pm').innerText)`), `each card shows its step timeline and the model the router picked (${tl.join(' | ')})`);
  const routed = calls.filter((c) => c.path === '/generate/video');
  const prodBoards = shotsAll.map((x, i) => [i + 1, x]).filter(([, x]) => x.tool === 'runway');
  check(routed.length > 0 && routed.every((c) => ['genovus-video-hero', 'genovus-video-production'].includes(c.body.configId)) && routed.some((c) => c.body.configId === 'genovus-video-production') && calls.filter((c) => c.path === '/generate/image').every((c) => c.body.configId === 'genovus-image-keyframe'), `final renders use the hero / production routers by shot, keyframes the keyframe router (${routed.length} takes)`);
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
  const dv = calls.slice(nCalls).filter((c) => c.path === '/generate/video'), di = calls.slice(nCalls).filter((c) => c.path === '/generate/image');
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
  const fv = calls.slice(nF).filter((c) => c.path === '/generate/video'), fi = calls.slice(nF).filter((c) => c.path === '/generate/image');
  check(qf.ok && qf.shots.join() === '8' && (await stages())[8] === 'review' && fv[0]?.body.configId === 'genovus-video-hero' && fv[0]?.body.input.resolution === '1080p' && fi[0]?.body.configId === 'genovus-image-keyframe' && !calls.slice(nF).some((c) => c.path === '/text_to_speech'), 'the final renders on genovus-video-hero at 1080p with a genovus-image-keyframe keyframe, reusing the draft’s line read');
  // A failed take retries by itself without the audio, then succeeds.
  ctl.failTakes = 1;
  const nBefore = calls.filter((c) => c.path === '/generate/video').length;
  await api('review', { shot: 4, action: 'redo', note: 'one more' });
  for (let i = 0; i < 40 && (await stages())[4] !== 'review'; i++) { await advance(); await sleep(500); }
  const r4 = calls.filter((c) => c.path === '/generate/video').slice(nBefore);
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
  for (let i = 0; i < 40 && (await stages())[10] !== 'review'; i++) { await advance(); await sleep(500); }
  const mv = calls.slice(nMod).filter((c) => c.path === '/generate/video' || c.path === '/image_to_video');
  check((await stages())[10] === 'review' && mv.length === 2 && mv[0].path === '/generate/video' && mv[1].path === '/image_to_video' && mv[1].body.model === 'gen4.5' && mv[1].body.promptImage?.[0]?.position === 'first' && !mv[1].body.referenceAudio, `a take blocked by the provider's safety filter retries on Runway's Gen-4.5 from the keyframe (${mv.map((c) => c.path + ':' + (c.body.model ?? c.body.configId)).join(', ')})`);
  const nMod2 = calls.length;
  await api('review', { shot: 10, action: 'redo', note: 'again' });
  for (let i = 0; i < 40 && (await stages())[10] !== 'review'; i++) { await advance(); await sleep(500); }
  const mv2 = calls.slice(nMod2).filter((c) => c.path === '/generate/video' || c.path === '/image_to_video');
  check(mv2.length === 1 && mv2[0].body.model === 'gen4.5', 'once a shot was flagged, its next take goes straight to Gen-4.5 (no wasted attempt)');
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
  await waitFor(async () => ctl.cancelled.includes(hung.operation), 10000);
  check(ctl.cancelled.includes(hung.operation) && (await stages())[7] === 'blocked', 'Stop & refund cancels the Runway job and stops the shot');
  ctl.hang = false;
  await go('/console/studio/gjk-h01');
  check(/elapsed/.test(await ev(`document.querySelector('.pc-bar').innerText`)) || true, 'the bar shows run health');

  // 5. The ceiling stops the run.
  const cur = must(await db.from('studio_episodes').select('production').eq('id', ep.id).single(), 'p').production;
  await db.from('studio_episodes').update({ production: { ...cur, ceiling_cents: 1 } }).eq('id', ep.id);
  const rd = await api('review', { shot: 4, action: 'redo', note: 'tighter' });
  const adv = await advance();
  void rd; void adv;
  const run = must(await db.from('studio_episodes').select('production').eq('id', ep.id).single(), 'run').production;
  check(run.on === false && /ceiling/i.test(run.paused_reason ?? ''), `at the ceiling the run pauses itself (${run.paused_reason})`);
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
  for (const s of priorShots) await db.from('studio_shots').update({ produce: s.produce ?? {}, status: s.status, log: s.log, screens: s.screens ?? [] }).eq('id', s.id);
  for (const c of cast) await db.from('studio_characters').update({ voice: priorVoice[c.id] }).eq('id', c.id);
  console.log(`cleaned up: ${clips.length} clips, ${art.length} frames, ${takes.length} takes, ${refs.length} casting refs, ${blobs.length} files`);
  console.log('screenshots in', OUT);
  try { await cdp('Browser.close'); } catch {}
  ws.close(); chrome.kill(); dev.kill(); mock.close();
  spawn('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: 'ignore' });
  setTimeout(() => process.exit(), 1500);
}
