// Verify StudioNext generation on the PREVIEW database against a stand-in Runway (no real credits are spent):
// identity lock from the official cast sheet, directed line reads, keyframes with tagged identity references,
// a Seedance take guided by the picked read, a designed voice used for reads, the score, Runway's final cost
// recorded, and the phone capture links. Cleans up every row and file it creates.
//   node --env-file=.env.local scripts/verify-studio-runway.mjs [outDir]
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
const ctl = { failTakes: 0, hang: false, cancelled: [] };
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
    if (t && seen.has(t[1])) { const s = seen.get(t[1]); s.polls++; if (s.cancelled) return send({ id: t[1], status: 'CANCELLED', cost: { credits: 0 } }); if (s.hang) return send({ id: t[1], status: 'RUNNING', progress: 0.4 }); if (s.fail && s.polls >= 2) return send({ id: t[1], status: 'FAILED', failure: 'Content moderation flagged the reference audio (test)', failureCode: 'SAFETY.INPUT.AUDIO', cost: { credits: 0 } }); return send(s.polls < 2 ? { id: t[1], status: 'RUNNING', progress: 0.5 } : { id: t[1], status: 'SUCCEEDED', output: [`http://localhost:${MOCK}/files/${t[1]}.${s.k[0]}`], cost: { credits: s.k[1] } }); }
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
const port = 9497, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'genovus-verify-'));
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

try {
  await go('/console/studio/gjk-h01');
  // 1. Identity: the official cast sheet goes on file, a person approves it, the lock shows.
  for (const c of cast) await ev(`fetch('/api/studio/runway', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'casting', character: '${c.id}' }) }).then((r) => r.status)`);
  const refs = must(await db.from('studio_refs').select('id, character_id, approved, blob_path').in('character_id', cast.map((c) => c.id)).eq('slot', 'CASTING').gte('created_at', startedAt), 'refs');
  created.refs.push(...refs);
  check(refs.length === 3 && refs.every((r) => !r.approved && /^studio\/casting\//.test(r.blob_path)), 'the official cast sheets are on file for all three, waiting for approval');
  await go('/console/studio/gjk-h01');
  console.log('approve buttons:', await ev(`(() => { const bs = [...document.querySelectorAll('.pb-cast button')].filter((b) => /Approve to lock/.test(b.textContent)); bs.forEach((b) => b.click()); return bs.length; })()`));
  await waitFor(async () => (await db.from('studio_refs').select('id').in('id', refs.map((r) => r.id)).eq('approved', true)).data?.length === 3, 15000);
  await go('/console/studio/gjk-h01');
  const approvedN = (await db.from('studio_refs').select('id').in('id', refs.map((r) => r.id)).eq('approved', true)).data?.length;
  check(/identity locked/i.test(await ev('document.body.innerText')) && await ev(`document.querySelectorAll('.pb-member-info > .bs-lock.casting').length`) === 3, `approving locks all three identities on the board (${approvedN} approved)`);

  // 2. Line reads on shot 110 (Tasha's fourth-wall line), each in her preset voice with the direction tags.
  const S110 = `document.querySelector('#shot-110')`;
  await click(S110, '/Read lines/');
  await waitFor(async () => ev(`!!document.querySelector('#shot-110 .bs-read audio')`));
  const tts = calls.filter((c) => c.path === '/text_to_speech');
  check(tts.length === 1 && tts[0].body.model === 'eleven_v4' && tts[0].body.voice.presetId === 'Kiana' && /\[warm, conspiratorial\]/.test(tts[0].body.promptText), 'the line read goes to ElevenLabs v4 in Tasha’s voice with her direction tags');
  const clip = must(await db.from('studio_voice_clips').select('id, status, cost_cents, blob_path, engine').eq('character_id', tasha.id).eq('kind', 'line').gte('created_at', startedAt).single(), 'clip');
  created.clips.push(clip.id);
  check(clip.status === 'ready' && clip.cost_cents === 4 && /^studio\/voice\//.test(clip.blob_path), 'the read is stored privately with Runway’s final cost (4 credits = $0.04)');
  const exp = must(await db.from('expenses').select('amount_cents').eq('vendor', 'Runway').gte('created_at', startedAt), 'expenses');
  check(exp.some((x) => x.amount_cents === 4), 'the cost lands in Growth & financials as a Runway expense');
  await click(S110, '/Use read/'); await sleep(1500);

  // 3. Keyframes: Gen-4 Image with Tasha's locked reference tagged in.
  await click(S110, '/Draw 2 keyframes/');
  await waitFor(async () => (await ev(`document.querySelectorAll('#shot-110 .bs-frame img').length`)) === 2);
  const img = calls.filter((c) => c.path === '/generate/image');
  check(img.length === 2 && img[0].body.configId === 'genovus-image-keyframe' && /^data:image\//.test(img[0].body.input.referenceImages?.[0]?.uri ?? '') && /Reference image 1 is Tasha/.test(img[0].body.input.promptText), 'keyframes go through genovus-image-keyframe with Tasha’s locked reference attached');
  await ev(`document.querySelector('#shot-110 .bs-frame').click()`); await sleep(2000);
  await go('/console/studio/gjk-h01');
  check(await ev(`!!document.querySelector('#shot-110 .bs-frame.on')`), 'a keyframe is picked as the start frame');

  // 4. The take: Seedance 2.5 from the picked frame, guided by the picked read.
  await click(S110, '/Render 5s take/');
  await waitFor(async () => ev(`!!document.querySelector('#shot-110 .bs-take video')`), 60000);
  const vid = calls.filter((c) => c.path === '/generate/video').at(-1);
  check(vid?.body.configId === 'genovus-video-hero' && vid.body.input.referenceImages?.[0]?.role === 'first' && vid.body.input.referenceAudio?.length === 1 && vid.body.input.duration === 5 && vid.body.input.resolution === '1080p' && vid.body.input.aspectRatio === '16:9', 'the hero take goes through genovus-video-hero from the start frame, 5 s at 1080p, performing to the picked read');
  const take = must(await db.from('studio_takes').select('id, status, cost_cents, model').eq('shot_id', must(await db.from('studio_shots').select('id, studio_episodes!inner(code)').eq('studio_episodes.code', 'gjk-h01').eq('n', 110).single(), 's110').id).gte('created_at', startedAt).maybeSingle(), 'take') ?? {};
  created.takes.push(take.id);
  check(take.status === 'ready' && take.cost_cents === 100 && take.model === 'runway:seedance2_5', 'the take records the model the router picked and its final cost ($1.00)');
  await click(S110, '/Use this take/'); await sleep(1500);

  // 5. A designed voice for Tasha; once picked, her reads use it (Seed Audio, tags stripped).
  await click(`[...document.querySelectorAll('.pb-member')].find((m) => /Tasha/.test(m.innerText))`, '/Design a voice/');
  const design = await waitFor(async () => (await db.from('studio_voice_clips').select('id, status, cost_cents').eq('character_id', tasha.id).eq('kind', 'design').eq('status', 'ready').gte('created_at', startedAt).maybeSingle()).data);
  if (design) created.clips.push(design.id);
  check(design?.status === 'ready' && design.cost_cents === 6 && calls.some((c) => c.path === '/voices/preview' && /Warm middle register/.test(c.body.prompt)), 'Tasha’s voice is designed from her bible description; its cost is measured from the credit balance');
  await go('/console/studio/gjk-h01');
  await click(`[...document.querySelectorAll('.pb-member')].find((m) => /Tasha/.test(m.innerText))`, '/^Use$/');
  await waitFor(async () => (await db.from('studio_characters').select('voice').eq('id', tasha.id).single()).data?.voice?.runway_engine === 'custom', 10000);
  await go('/console/studio/gjk-h01');
  await click(S110, '/Read lines/');
  await waitFor(async () => calls.filter((c) => c.path === '/text_to_speech').length === 2, 15000);
  const custom = calls.filter((c) => c.path === '/text_to_speech').at(-1);
  check(custom?.body.model === 'seed_audio' && custom.body.voice?.type === 'reference-audio' && !/\[/.test(custom.body.promptText), 'with the designed voice picked, reads use Seed Audio in that voice (tags stripped)');
  await sleep(6000);

  // 6. The original score.
  await click(`[...document.querySelectorAll('.pb-panel')].find((p) => /Original score/i.test(p.innerText))`, '/Compose a score draft/');
  await waitFor(async () => calls.some((c) => c.path === '/sound_effect'), 15000);
  const snd = calls.find((c) => c.path === '/sound_effect');
  check(snd?.body.model === 'seed_audio' && /Original instrumental trailer score/.test(snd.body.promptText), 'the score is composed by Seed Audio from the cue sheet');

  // 7. The product shot: links to the exact screens and a phone-friendly upload.
  const cap = await ev(`(() => { const c = document.querySelector('#shot-90 .bs-cap'); return c && { links: [...c.querySelectorAll('a')].map((a) => a.getAttribute('href')), upload: !!c.querySelector('input[type=file][accept*="image/png"]') }; })()`);
  check(cap?.links.includes('/console/prospects/calls') && cap.links.includes('/console') && cap.upload, 'the product shot links to its screens and takes a recording or screenshot from the phone');
  check(await ev(`!!document.querySelector('#shot-90 .bs-line')`), 'the product shot’s voice-over lines can be read too');
  await sleep(4000);
  await go('/console/studio/gjk-h01');
  await shot('studio-runway-board', 2200);
  await ev(`document.querySelector('#shot-110').scrollIntoView()`);
  await shot('studio-runway-shot110', 1100);
  check(calls.filter((c) => c.path === '/generate/video').length === 1, `exactly the takes a person asked for were generated (${calls.length} Runway calls in all)`);
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
  await db.from('studio_shots').update({ status: 'todo', take_url: null }).in('id', [...new Set(takes.map((t) => t.shot_id))]);
  await db.from('studio_refs').delete().in('id', refs.map((r) => r.id));
  await db.from('expenses').delete().eq('vendor', 'Runway').gte('created_at', startedAt);
  await db.from('studio_decisions').delete().gte('decided_at', startedAt);
  for (const c of cast) await db.from('studio_characters').update({ voice: priorVoice[c.id] }).eq('id', c.id);
  console.log(`cleaned up: ${clips.length} clips, ${art.length} frames, ${takes.length} takes, ${refs.length} casting refs, ${blobs.length} files`);
  console.log('screenshots in', OUT);
  try { await cdp('Browser.close'); } catch {}
  ws.close(); chrome.kill(); dev.kill(); mock.close();
  spawn('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`], { stdio: 'ignore' });
  setTimeout(() => process.exit(), 1500);
}
