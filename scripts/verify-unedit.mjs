// Verify Unedit end to end on the PREVIEW database, with stand-ins for Deepgram, Claude and Metricool (no spend):
// the door on desktop and phone; a real browser upload (fingerprint, multipart, register); the steps running on
// their own (probe → audio → transcript → clip plan → 9:16 renders with word captions → thumbnails); the copy rules
// and length limits dropping bad picks; the same file opening the same job; a redo with a note; the campaign's
// Approve creating Metricool drafts with no AI label; a failed step showing its error with Retry; the budget refusal.
//   node --env-file=.env.local scripts/verify-unedit.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { del, list } from '@vercel/blob';

const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify-unedit');
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
const FF = (await import('ffmpeg-static')).default;

// ---- A test "vlog": 80 s of portrait video with a tone, and a transcript of 13 timed sentences. ----
const media = fs.mkdtempSync(path.join(os.tmpdir(), 'unedit-verify-'));
const vlogFile = path.join(media, `verify-vlog-${Date.now()}.mp4`);
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000', '-t', '80', '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '38', '-b:a', '48k', '-c:a', 'aac', vlogFile]);
const failFile = path.join(media, `verify-fail-${Date.now()}.mp4`);
execFileSync(FF, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=500:sample_rate=48000', '-t', '30', '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '38', '-b:a', '48k', '-c:a', 'aac', failFile]);
const SENT = [
  'Most agencies lose the lead in the first five minutes.', 'Here is what that looks like on a normal Tuesday morning.', 'A quote request comes in while you are on another call.',
  'By the time you call back they already bought from someone else.', 'So the fix is not more leads, it is faster answers.', 'Let me show you how we answer every lead in under a minute.',
  'First the website catches the request with the right details.', 'Then Helix texts back with consent and books the call.', 'Your team sees it on their phone before the coffee is cold.',
  'That one change doubled booked calls for an office I work with.', 'Now here is the part nobody talks about.', 'You have to follow up on the ones who go quiet.', 'Do that and the pipeline takes care of itself.',
];
const words = []; let t = 0.6;
for (const s of SENT) { for (const w of s.split(' ')) { words.push({ word: w.replace(/[.,]/g, '').toLowerCase(), punctuated_word: w, start: +t.toFixed(2), end: +(t + 0.32).toFixed(2), confidence: 0.98 }); t += 0.4; } t += 0.5; }

// ---- Stand-ins: Deepgram (/dg), Claude (/ai), Metricool (/mc). ----
const ctl = { dgFail: false, dgCalls: 0, aiCalls: [], mcPosts: [] };
const plan = {
  clips: [
    { from: 0, to: 4, hook: 3, hook_to: 3, title: 'The five minute rule', caption: 'Speed beats volume.', instagram: 'Answer fast or lose the lead. #insurance', facebook: 'Answer fast or lose the lead.', youtube: 'The five minute rule for agencies', hook_type: 'claim', topic: 'speed to lead', why: 'clear stakes',
      // Unedit Pro shot plan, with mistakes code must repair: a non-face opener, a filler accent, an invented screen, a figure never said.
      shots: [{ s: 3, layout: 'word', accent: 'someone' }, { s: 0, layout: 'word', accent: 'lose' }, { s: 1, layout: 'card', accent: 'the' }, { s: 2, layout: 'screen', accent: 'quote', screen: 'agency-leads' }, { s: 3, layout: 'number', accent: 'already', figure: '9000' }, { s: 4, layout: 'split', accent: 'faster', screen: 'made-up-screen' }] },
    { from: 5, to: 8, hook: null, title: 'Under a minute', caption: 'How we answer every lead.', instagram: 'Every lead answered in under a minute.', facebook: 'Every lead answered in under a minute.', youtube: 'Answer every lead in under a minute', hook_type: 'story', topic: 'the system', why: 'shows the how' },
    { from: 9, to: 9, title: 'Too short', caption: 'x', instagram: 'x', facebook: 'x', youtube: 'x' },
    { from: 9, to: 12, title: 'Guaranteed results', caption: 'Guaranteed to work.', instagram: 'Guaranteed!', facebook: 'x', youtube: 'x' },
  ],
  episode: { title: 'Why agencies lose leads in five minutes', description: 'Speed to lead, and the follow-up nobody talks about.', tags: ['insurance', 'leads'] },
  thumbs: ['FIVE MINUTES', 'ANSWER FAST', 'NOBODY TALKS ABOUT'],
};
const redo = { clips: [{ from: 9, to: 12, hook: 10, hook_to: 10, title: 'The follow-up', caption: 'Follow up on the quiet ones.', instagram: 'Follow up on the quiet ones.', facebook: 'Follow up on the quiet ones.', youtube: 'The follow-up nobody talks about', hook_type: 'contrast', topic: 'follow up', why: 'answers the note' }], episode: plan.episode, thumbs: plan.thumbs };
const mock = http.createServer((req, res) => {
  const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks);
    const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.startsWith('/dg/v1/listen')) {
      ctl.dgCalls++; ctl.dgBytes = body.length; ctl.dgType = req.headers['content-type']; ctl.dgAuth = req.headers.authorization;
      if (ctl.dgFail) return send({ err_msg: 'Deepgram is down (test)' }, 503);
      return send({ results: { channels: [{ alternatives: [{ words }] }] } });
    }
    if (req.url.startsWith('/ai/v1/messages')) {
      const b = JSON.parse(body.toString() || '{}');
      const content = b.messages?.[0]?.content;
      const vision = Array.isArray(content);
      const isRedo = !vision && /Redo ONE clip/.test(content);
      ctl.aiCalls.push(vision ? 'vision' : isRedo ? 'redo' : 'plan');
      const text = vision ? '{"order":[2,0,5]}' : JSON.stringify(isRedo ? redo : plan);
      return send({ content: [{ type: 'text', text }], usage: { input_tokens: 4000, output_tokens: 900 } });
    }
    if (req.url.startsWith('/mc/')) {
      const [p] = req.url.slice(3).split('?');
      if (req.method === 'POST' && p === '/v2/scheduler/posts') { const b = JSON.parse(body.toString() || '{}'); const id = 910000 + ctl.mcPosts.length; ctl.mcPosts.push({ id, body: b }); return send({ data: { id, ...b } }); }
      if (req.method === 'GET' && p === '/admin/simpleProfiles') return send([{ id: 7426930, label: 'Genovus Intelliware', facebook: 'g', instagram: 'g', youtube: 'g' }]);
      const m = p.match(/^\/v2\/scheduler\/posts\/(\d+)$/);
      if (m) return send({ data: { id: Number(m[1]), providers: [{ network: 'instagram', status: 'PENDING' }] } });
    }
    send({ error: 'not found' }, 404);
  });
});
await new Promise((r) => mock.listen(MOCK, r));

const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single(), 'admin');
const email = must(await db.auth.admin.getUserById(admin.user_id), 'email').user.email;
const env = {
  ...process.env, CRON_SECRET: process.env.CRON_SECRET || 'verify-unedit-local', HELIX_STANDIN: '1',
  DEEPGRAM_API_KEY: 'stand-in', DEEPGRAM_API_BASE: `http://localhost:${MOCK}/dg`, UNEDIT_STT: 'deepgram',
  ANTHROPIC_API_KEY: 'stand-in', ANTHROPIC_API_BASE: `http://localhost:${MOCK}/ai`,
  METRICOOL_API_BASE: `http://localhost:${MOCK}/mc`, METRICOOL_GENOVUS_API_KEY: 'stand-in-metricool', METRICOOL_MODE: '',
};
const devLog = process.env.DEV_LOG ? fs.openSync(process.env.DEV_LOG, 'w') : 'ignore';
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: ['ignore', devLog, devLog], shell: true, env });
for (let i = 0; i < 150 && !(await up()); i++) await sleep(1000);

const CH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9499, profile = fs.mkdtempSync(path.join(os.tmpdir(), 'unedit-chrome-'));
const chrome = spawn(CH, ['--headless=new', '--hide-scrollbars', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let tabs; for (let i = 0; i < 60; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (tabs.find((x) => x.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find((x) => x.type === 'page').webSocketDebuggerUrl);
let cid = 0; const pend = new Map(); const on = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) on.get(m.method)?.(m.params); };
await new Promise((r) => (ws.onopen = r));
const cdp = (method, params = {}) => new Promise((r) => { const i = ++cid; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => (await cdp('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp('Page.enable'); await cdp('DOM.enable'); await cdp('Runtime.enable');
const consoleLines = [];
on.set('Runtime.consoleAPICalled', (p) => consoleLines.push(`[${p.type}] ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`.slice(0, 400)));
on.set('Runtime.exceptionThrown', (p) => consoleLines.push(`[exception] ${p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text}`.slice(0, 400)));
const go = async (u) => { const l = new Promise((r) => on.set('Page.loadEventFired', r)); await cdp('Page.navigate', { url: ORIGIN + u }); await l; await sleep(2500); };
const size = (w, h, mobile = false) => cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
const shot = async (name, w = 1440, h = 1400, mobile = false) => { await size(w, h, mobile); await sleep(700); fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).result.data, 'base64')); };
const waitFor = async (fn, ms = 60000) => { for (let i = 0; i < ms / 1000; i++) { const v = await fn(); if (v) return v; await sleep(1000); } return null; };
const api = (body) => ev(`fetch('/api/studio/unedit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(${JSON.stringify(body)}) }).then(async (r) => ({ status: r.status, ...(await r.json()) }))`);
const vlogRow = async (id) => must(await db.from('unedit_vlogs').select('*').eq('id', id).single(), 'vlog');
const clipRows = async (id) => must(await db.from('unedit_clips').select('*').eq('vlog_id', id).order('n'), 'clips');
const uploadVia = async (file) => {
  const { result } = await cdp('DOM.getDocument', { depth: -1 });
  const q = await cdp('DOM.querySelector', { nodeId: result.root.nodeId, selector: 'input[type=file]:not([capture])' });
  await cdp('DOM.setFileInputFiles', { nodeId: q.result.nodeId, files: [file] });
};
const created = [];

await size(1440, 1000);
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
await go(`/auth/continue?t=${encodeURIComponent(link.properties.hashed_token)}&next=${encodeURIComponent('/console/studio/unedit')}`);
await ev(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)); b && b.click(); return !!b; })()`);
for (let i = 0; i < 40 && !(await ev('location.pathname')).startsWith('/console'); i++) await sleep(250);

try {
  // ---- The door ----
  await go('/console/studio');
  check(await ev(`!!document.querySelector('a.ue-entry[href="/console/studio/unedit"]')`), 'the Studio home leads with the Unedit entry');
  await go('/console/studio/unedit');
  check(await ev(`!!document.querySelector('.ue-rec') && /Choose a video/.test(document.body.innerText)`), 'the door shows the record button and Choose a video');
  check(await ev(`document.querySelector('input[capture]')?.getAttribute('accept') === 'video/*'`), 'the record button opens the camera (capture input)');
  await shot('unedit-door-desktop', 1440, 900);
  await shot('unedit-door-phone', 390, 844, true);
  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'the door has no sideways scroll on a phone');
  await size(1440, 1000);

  // ---- Upload through the browser ----
  await uploadVia(vlogFile);
  const id = await waitFor(async () => { const p = await ev('location.pathname'); return /^\/console\/studio\/unedit\/[0-9a-f-]{36}$/.test(p) ? p.split('/').pop() : null; }, 120000);
  check(Boolean(id), `the upload opens the recording's card (${id})`);
  if (!id) console.log('browser said:', await ev("document.querySelector('.toast, [role=status], [role=alert]')?.innerText ?? ''"), '\n' + consoleLines.slice(-8).join('\n'));
  if (!id) { console.log('door:', await ev("document.querySelector('.ue-door')?.innerText"), '| toasts:', await ev("[...document.querySelectorAll('[class*=toast]')].map((t) => t.innerText).join(' / ')")); await shot('upload-fail', 1440, 900); throw new Error('no card'); }
  created.push(id);
  let v = await vlogRow(id);
  check(/^studio\/vlogs\/uploads\//.test(v.blob_path) && v.bytes === fs.statSync(vlogFile).size && /^\d+:[0-9a-f]{64}:[0-9a-f]{64}$/.test(v.fingerprint), 'the recording is stored privately with its size and fingerprint');

  // ---- The steps run on their own ----
  await shot('unedit-card-working', 1440, 900);
  const reached = await waitFor(async () => { const r = await vlogRow(id); return r.stage === 'review' || r.error ? r : null; }, 420000);
  v = await vlogRow(id);
  check(v.stage === 'review' && !v.error, `the recording reaches review on its own (${v.stage}${v.error ? `: ${v.error}` : ''})`);
  if (!reached || v.error) throw new Error('pipeline stopped');
  check(Math.abs(Number(v.duration_s) - 80) < 1 && v.width === 1080 && v.height === 1920, `probe read 80 s, 1080×1920 (${v.duration_s} s, ${v.width}×${v.height})`);
  check(ctl.dgCalls === 1 && ctl.dgType === 'audio/mpeg' && ctl.dgBytes < 1_200_000 && ctl.dgAuth === 'Token stand-in', `Deepgram received a small MP3, not the video (${Math.round(ctl.dgBytes / 1024)} KB)`);
  check(v.provider === 'deepgram' && v.words === words.length, `the transcript is stored (${v.words} words)`);
  const clips = await clipRows(id);
  check(clips.length === 2, `two clips survive; the too-short and the "guaranteed" ones are dropped (${clips.length})`);
  check((v.episode?.dropped ?? []).some((d) => /s \(clips run/.test(d)) && (v.episode?.dropped ?? []).some((d) => /wording rules/.test(d)), 'the dropped picks are listed with the reason');
  const [c1, c2] = clips;
  check(c1.hook_start_s != null && Number(c1.hook_start_s) > Number(c1.start_s), 'clip 1 opens on its hook (a later sentence moved to the front)');
  check(Number(c1.start_s) <= words[0].start && Number(c2.start_s) > Number(c1.end_s), 'clip times come from the words and do not overlap');
  check(clips.every((c) => c.status === 'ready' && c.blob_path), 'both clips are rendered');
  {
    const shots = c1.features?.shots ?? [];
    const lay = shots.map((x) => x.layout).join(',');
    check(shots.length === 6 && shots[0].layout === 'face' && shots.every((x) => Number.isInteger(x.w0) && x.e > x.s), `clip 1 has a shot per played sentence, opening on face (${lay})`);
    check(shots.some((x) => x.screen === 'agency-leads') && !shots.some((x) => x.screen === 'made-up-screen') && !shots.some((x) => x.figure === '9000'), 'shots keep only real library screens and figures the speaker said');
    check(shots.filter((x) => x.accent != null).length >= 3 && shots.every((x) => x.accent == null || (x.accent >= x.w0 && x.accent <= x.w1)) && shots[2]?.accent == null, 'accent words are word indexes inside their own sentence; a filler pick is dropped');
    check((c2.features?.shots ?? []).length > 0 && c2.features.shots.every((x) => x.accent == null), 'a clip planned without shots still gets plain face shots');
  }
  // The rendered clip: 1080×1920, the hook's length plus the moment's, with audio.
  const clipFile = path.join(media, 'clip1.mp4');
  const presign = async (p) => { const { issueSignedToken, presignUrl } = await import('@vercel/blob'); const until = Date.now() + 600_000; const tok = await issueSignedToken({ pathname: p, operations: ['get'], validUntil: until }); return (await presignUrl(tok, { operation: 'get', pathname: p, access: 'private', validUntil: until })).presignedUrl; };
  fs.writeFileSync(clipFile, Buffer.from(await (await fetch(await presign(c1.blob_path))).arrayBuffer()));
  const info = (() => { try { execFileSync(FF, ['-hide_banner', '-i', clipFile]); return ''; } catch (e) { return String(e.stderr); } })();
  const want = (Number(c1.end_s) - Number(c1.start_s)) + (Number(c1.hook_end_s) - Number(c1.hook_start_s));
  const dur = (() => { const m = info.match(/Duration: (\d+):(\d+):([\d.]+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; })();
  check(/1080x1920/.test(info) && /Audio: aac/.test(info) && Math.abs(dur - want) < 0.6, `clip 1 is 1080×1920 with audio, ${dur.toFixed(1)} s (hook + moment ${want.toFixed(1)} s)`);
  execFileSync(FF, ['-y', '-loglevel', 'error', '-ss', '1.0', '-i', clipFile, '-frames:v', '1', path.join(OUT, 'clip1-frame.png')]);
  check(Array.isArray(v.thumbs) && v.thumbs.length === 3 && v.thumb_pick === 0 && ctl.aiCalls.includes('vision'), 'three thumbnails are made from the stills Claude picked');
  const thumbBytes = Buffer.from(await (await fetch(await presign(v.thumbs[0].blob))).arrayBuffer());
  fs.writeFileSync(path.join(OUT, 'thumb-a.jpg'), thumbBytes);
  check(thumbBytes[0] === 0xff && thumbBytes[1] === 0xd8 && thumbBytes.length < 2_000_000, `thumbnails are JPEGs under YouTube's 2 MB (${Math.round(thumbBytes.length / 1024)} KB)`);
  const spent = must(await db.rpc('studio_spent_cents'), 'spent');
  check(v.cost_cents > 0 && spent >= v.cost_cents, `the cost is charged to the Studio budget ($${(v.cost_cents / 100).toFixed(2)})`);

  // ---- The card ----
  await go(`/console/studio/unedit/${id}`);
  check(await ev(`document.querySelectorAll('.ue-clip').length === 2 && document.querySelectorAll('.ue-thumb').length === 3`), 'the card shows both clips and three thumbnails');
  check(await ev(`(() => { const b = [...document.querySelectorAll('.ue-approve button')][0]; return b && b.disabled && /Approve 7 posts|Approve 1 post/.test(b.textContent) || (b && b.disabled); })()`), 'the campaign Approve waits until every clip is decided');
  await shot('unedit-card-review', 1440, 1700);
  await shot('unedit-card-phone', 390, 1800, true);
  check(await ev('document.documentElement.scrollWidth <= innerWidth'), 'the card has no sideways scroll on a phone');
  await size(1440, 1000);

  // ---- The same file again opens the same job ----
  const again = await api({ tool: 'register', blobPath: v.blob_path, blobUrl: v.blob_url, bytes: v.bytes, fingerprint: v.fingerprint, fileName: 'again.mp4' });
  const look = await api({ tool: 'lookup', fingerprint: v.fingerprint });
  check(again.id === id && again.existing === true && look.id === id, 'the same recording opens the same job (no second campaign)');

  // ---- Redo with a note ----
  const before = { s: c2.start_s, e: c2.end_s };
  const r1 = await api({ id, tool: 'redo_clip', clip: c2.id, note: 'Use the follow-up part instead' });
  check(r1.ok, `redo starts (${r1.say ?? r1.error})`);
  await waitFor(async () => { const r = await vlogRow(id); return r.stage === 'review' || r.error ? r : null; }, 240000);
  const c2b = must(await db.from('unedit_clips').select('*').eq('id', c2.id).single(), 'c2b');
  check(ctl.aiCalls.includes('redo') && Number(c2b.start_s) !== Number(before.s) && c2b.status === 'ready' && c2b.title === 'The follow-up', `the redo picked a new moment from the note (${c2b.title}, ${Number(c2b.start_s).toFixed(1)}–${Number(c2b.end_s).toFixed(1)} s)`);

  // ---- Approve and send ----
  check((await api({ id, tool: 'approve' })).ok === false, 'the campaign cannot be approved with clips undecided');
  check((await api({ id, tool: 'approve_clip', clip: c1.id })).ok && (await api({ id, tool: 'approve_clip', clip: c2.id })).ok, 'both clips approved');
  check((await api({ id, tool: 'pick_thumb', index: 1 })).ok, 'thumbnail B picked');
  const ap = await api({ id, tool: 'approve' });
  check(ap.ok && /7 posts/.test(ap.say), `the campaign is approved (${ap.say ?? ap.error})`);
  await waitFor(async () => (await vlogRow(id)).stage === 'published', 120000);
  const posts = must(await db.from('unedit_posts').select('*').eq('vlog_id', id), 'posts');
  check(posts.length === 7 && posts.every((p) => p.status === 'sent' && !p.ai_label), `7 posts went to Metricool (${posts.map((p) => `${p.platform}:${p.status}`).join(', ')})`);
  const bodies = ctl.mcPosts.map((x) => x.body);
  check(bodies.length === 7 && bodies.every((b) => b.draft === true && b.autoPublish === false), 'every post is a Metricool draft (nothing publishes)');
  check(bodies.filter((b) => b.instagramData).every((b) => b.instagramData.isAiGenerated === false && b.instagramData.type === 'REEL') && bodies.filter((b) => b.youtubeData).every((b) => b.youtubeData.isAiGeneratedContent === false), 'no AI label on real footage (Instagram and YouTube flags false)');
  const yv = bodies.find((b) => b.youtubeData?.type === 'video');
  check(Boolean(yv) && yv.youtubeData.title === plan.episode.title && /thumbs\/2-orange\.jpg/.test(yv.videoThumbnailUrl ?? ''), 'the full video goes to YouTube with its title and the picked thumbnail');
  check(bodies.filter((b) => b.youtubeData?.type === 'short').length === 2 && bodies.filter((b) => b.facebookData?.type === 'REEL').length === 2, 'each clip goes as a YouTube Short and a Facebook Reel');
  const mediaUrl = bodies.find((b) => b.instagramData)?.media?.[0];
  const ranged = mediaUrl ? await fetch(mediaUrl, { headers: { range: 'bytes=0-99' } }) : null;
  check(ranged?.status === 206, 'Metricool can fetch the media from its presigned link (Range works)');
  await go(`/console/studio/unedit/${id}`);
  check(await ev(`document.querySelectorAll('.ue-posts li').length === 7 && /Draft in Metricool/.test(document.querySelector('.ue-posts').innerText)`), 'the card lists the 7 posts as drafts in Metricool');
  await shot('unedit-card-sent', 1440, 1600);

  // ---- A failed step shows its error, and Retry resumes ----
  ctl.dgFail = true;
  await go('/console/studio/unedit');
  await uploadVia(failFile);
  const id2 = await waitFor(async () => { const p = await ev('location.pathname'); return /^\/console\/studio\/unedit\/[0-9a-f-]{36}$/.test(p) && !p.endsWith(id) ? p.split('/').pop() : null; }, 120000);
  if (id2) created.push(id2);
  const failed = id2 ? await waitFor(async () => { const r = await vlogRow(id2); return r.error ? r : null; }, 180000) : null;
  check(Boolean(failed) && /Deepgram is down/.test(failed.error), `a failed transcription stops with the real error (${failed?.error})`);
  await go(`/console/studio/unedit/${id2}`);
  check(await ev(`/Deepgram is down/.test(document.querySelector('.ue-stop')?.innerText ?? '') && [...document.querySelectorAll('.ue-stop button')].some((b) => b.textContent === 'Retry')`), 'the card shows the error with Retry');
  await shot('unedit-card-stopped', 1440, 900);
  ctl.dgFail = false;
  check((await api({ id: id2, tool: 'retry' })).ok, 'Retry is accepted');
  const resumed = await waitFor(async () => { const r = await vlogRow(id2); return !r.error && ['finding', 'rendering', 'review'].includes(r.stage) ? r : null; }, 180000);
  check(Boolean(resumed), `after Retry it carries on (${resumed?.stage})`);

  // ---- The budget refuses past the cap ----
  const over = await db.rpc('unedit_spend', { p_vlog: id, p_cents: 100_000_000, p_what: 'verify: over the cap' });
  check(Boolean(over.error) && /monthly Studio budget/.test(over.error.message), 'a cost past the monthly Studio budget is refused');
} finally {
  // Clean up: the test recordings, their clips and posts (cascade), and their files.
  for (const vid of created) {
    const r = await db.from('unedit_vlogs').select('blob_path').eq('id', vid).maybeSingle();
    const files = (await list({ prefix: `studio/vlogs/${vid}/` }).catch(() => ({ blobs: [] }))).blobs.map((b) => b.url);
    if (r.data?.blob_path) files.push(r.data.blob_path);
    if (files.length) await del(files).catch(() => {});
    await db.from('unedit_vlogs').delete().eq('id', vid);
  }
  ws.close(); chrome.kill(); mock.close();
  if (process.platform === 'win32') { try { const pid = execFileSync('cmd', ['/c', `netstat -ano | findstr :${PORT} | findstr LISTENING`]).toString().trim().split(/\s+/).pop(); if (pid) execFileSync('taskkill', ['/PID', pid, '/T', '/F']); } catch {} } else dev.kill();
  fs.rmSync(media, { recursive: true, force: true });
  console.log(`screens in ${OUT}`);
}
