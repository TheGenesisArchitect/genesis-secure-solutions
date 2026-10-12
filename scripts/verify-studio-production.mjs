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
const KIND = { '/text_to_speech': ['mp3', 4], '/sound_effect': ['mp3', 9], '/text_to_image': ['png', 8], '/image_to_video': ['mp4', 100] };
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
    const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const u = req.url.replace(/^\/v1/, '');
    if (u.startsWith('/files/')) { const ext = u.split('.').pop(); res.writeHead(200); return res.end(FILES[ext] ?? PNG); }
    if (req.method === 'GET' && u === '/organization') return send({ creditBalance: balance });
    if (req.method === 'POST' && u === '/voices/preview') { calls.push({ path: u, body: JSON.parse(body || '{}') }); balance -= 6; return send({ url: `http://localhost:${MOCK}/files/design.mp3`, durationSecs: 6 }); }
    if (req.method === 'POST' && KIND[u]) { const id = `task-${++n}`; seen.set(id, { k: KIND[u], polls: 0 }); calls.push({ path: u, body: JSON.parse(body || '{}') }); return send({ id }); }
    const t = u.match(/^\/tasks\/(.+)$/);
    if (t && seen.has(t[1])) { const s = seen.get(t[1]); s.polls++; return send(s.polls < 2 ? { id: t[1], status: 'RUNNING', progress: 0.5 } : { id: t[1], status: 'SUCCEEDED', output: [`http://localhost:${MOCK}/files/${t[1]}.${s.k[0]}`], cost: { credits: s.k[1] } }); }
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
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
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
  const shotsAll = must(await db.from('studio_shots').select('id, n, tool, produce, status, log').eq('episode_id', ep.id).order('n'), 'shots');
  priorShots.push(...shotsAll);
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
  check(lockedNow === 3 && (await stages())[11] !== 'blocked' && calls.some((c) => c.path === '/text_to_image') && calls.some((c) => c.path === '/text_to_speech'), `approving locks the cast and starts shot 11's keyframe and line read together (${lockedNow} locked)`);
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
  check(st[9] === 'capture' && !st[2] && !st[5], `the product shot gets its voice-over and waits for a phone capture; code cards cost nothing and stay out of the run (9:${st[9]} 2:${st[2] || '-'} 5:${st[5] || '-'})`);
  const vids = calls.filter((c) => c.path === '/image_to_video').length, imgs = calls.filter((c) => c.path === '/text_to_image').length;
  const by = {}; for (const c of calls.filter((c) => c.path === '/text_to_image' || c.path === '/text_to_speech')) { const k = c.path.slice(1, 8) + ' ' + (c.body.promptText ?? '').replace(/@w+ is w+; ?|@w+ is w+. ?/g, '').slice(0, 38); by[k] = (by[k] ?? 0) + 1; } console.log('CALLS', JSON.stringify(Object.entries(by).filter(([, n]) => n > 1)));
  check(vids === runwayBoards.length && imgs === runwayBoards.length, `single-flight: one keyframe and one take per shot (${imgs} keyframes, ${vids} takes for ${runwayBoards.length} shots)`);
  const reads = calls.filter((c) => c.path === '/text_to_speech').length;
  check(reads === 11, `each spoken line read exactly once (${reads} of 11)`);
  await go('/console/studio/gjk-h01');
  check(await ev(`document.querySelectorAll('.pb-card2.is-review').length`) >= 9 && /to review/.test(await ev(`document.querySelector('.pc-bar').innerText`)), 'the board highlights the shots waiting for review');
  check(await ev(`!!document.querySelector('.pb-hero')`) && /Play the cut so far · 9 scenes/i.test(await ev(`document.querySelector('.pb-hero').innerText`)), 'the board opens on a streaming-style hero with Play the cut so far');
  check(await ev(`document.querySelectorAll('.pb-card2 .sp-play').length`) === 9, 'every finished scene has a play button on its card');
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
  const before = calls.filter((c) => c.path === '/image_to_video').length;
  const redo = await api('review', { shot: 11, action: 'redo', note: 'a slower turn, eyes first' });
  for (let i = 0; i < 30 && (await stages())[11] !== 'review'; i++) { await advance(); await sleep(500); }
  const log11 = must(await db.from('studio_shots').select('log').eq('id', shotsAll.find((s) => s.n === 110).id).single(), 'log').log;
  check(redo.ok && (await stages())[11] === 'review' && calls.filter((c) => c.path === '/image_to_video').length === before + 1 && /slower turn/.test(log11.acting ?? ''), 'a redo with a note updates the direction and renders exactly one new take');

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
  const takes = must(await db.from('studio_takes').select('id, blob_path, shot_id').like('model', 'runway:%').gte('created_at', startedAt), 'takes');
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
  for (const s of priorShots) await db.from('studio_shots').update({ produce: s.produce ?? {}, status: s.status, log: s.log }).eq('id', s.id);
  for (const c of cast) await db.from('studio_characters').update({ voice: priorVoice[c.id] }).eq('id', c.id);
  console.log(`cleaned up: ${clips.length} clips, ${art.length} frames, ${takes.length} takes, ${refs.length} casting refs, ${blobs.length} files`);
  console.log('screenshots in', OUT);
  try { await cdp('Browser.close'); } catch {}
  ws.close(); chrome.kill(); dev.kill(); mock.close();
  spawn('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: 'ignore' });
  setTimeout(() => process.exit(), 1500);
}
