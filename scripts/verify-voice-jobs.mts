// Verify voice jobs (lib/studio-voice-jobs.ts) on the preview database without spend: a stand-in Gemini TTS returns
// half a second of silence, a 1 s tone, then silence; the worker voices a job, trims the silence, stores each line,
// resumes a job across ticks, and records a failure. Cleans up after itself.
//   npx tsx --conditions=react-server --env-file=.env.local scripts/verify-voice-jobs.mts
import http from 'node:http';
import { del, get } from '@vercel/blob';

let fails = 0, calls = 0, failNext = false, longNext = 0;
const ok = (c: unknown, what: string, extra = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`); if (!c) fails++; };
const rate = 24000;
const pcm = Buffer.alloc(rate * 2 * 2.0); // 2 s: 0.5 silence, 1 s tone, 0.5 silence
for (let i = rate * 0.5; i < rate * 1.5; i++) pcm.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 220) * 9000), i * 2);
let lastBody = '';
const server = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    calls++; lastBody = b;
    res.setHeader('content-type', 'application/json');
    if (longNext > 0) { longNext--; const long = Buffer.alloc(rate * 2 * 20); for (let i = 0; i < rate * 20; i++) long.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 180) * 8000), i * 2);
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: `audio/L16;codec=pcm;rate=${rate}`, data: long.toString('base64') } }] } }] })); return; }
    if (failNext) { failNext = false; res.statusCode = 500; res.end(JSON.stringify({ error: { message: 'stand-in outage' } })); return; }
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: `audio/L16;codec=pcm;rate=${rate}`, data: pcm.toString('base64') } }] } }] }));
  });
});
await new Promise<void>((r) => server.listen(3932, r));
process.env.GEMINI_BASE_URL = 'http://127.0.0.1:3932/v1beta';
process.env.GEMINI_API_KEY = 'stand-in';

const { checkJob, runVoiceJobs } = await import('../lib/studio-voice-jobs');
const { adminDb } = await import('../lib/supabase/admin');
const { deskFor } = await import('../lib/desk');
const db = adminDb();
const ids: string[] = [];
try {
  ok(typeof checkJob({ title: 'x', lines: [] }) === 'string', 'a job with no lines is refused');
  ok(typeof checkJob({ title: 'x', voice: 'Morgan Freeman', lines: [{ id: 'a', text: 'hi' }] }) === 'string', 'an unknown voice is refused');
  ok(typeof checkJob({ title: 'x', lines: [{ id: 'a', text: 'hi' }, { id: 'a', text: 'yo' }] }) === 'string', 'a repeated line id is refused');
  ok(typeof checkJob({ title: 'x', lines: [{ id: '../etc', text: 'hi' }] }) === 'string', 'a line id that could escape its folder is refused');
  const good = checkJob({ title: 'Verify voice jobs', lines: [{ id: 'hook', text: 'One.' }, { id: 'close', text: 'Two.' }, { id: 'tail', text: 'Three.' }] });
  ok(typeof good !== 'string', 'a good job passes the checks');
  if (typeof good === 'string') throw new Error(good);
  const desk = await deskFor(null);
  const { data: j, error } = await db.from('studio_voice_jobs').insert({ tenant_id: desk.id, created_by: 'verify', ...good }).select('id').single();
  if (error) throw new Error(error.message);
  ids.push(j.id);
  // Other queued jobs on preview aren't ours; the worker takes them in order, so ours must be the oldest open job or alone.
  const r1 = await runVoiceJobs();
  ok(r1.voiced >= 3 && calls >= 3, 'the cron voices the job’s lines', JSON.stringify(r1));
  ok(lastBody.includes('Charon') && !/Say this/.test(lastBody) && JSON.parse(lastBody).contents[0].parts[0].text === 'Three.', 'only the words and the default voice reach Gemini (no direction to read aloud)');
  const { data: done } = await db.from('studio_voice_jobs').select('*').eq('id', j.id).single();
  ok(done.status === 'done' && done.done_at && !done.lease_until, 'the job is marked done and its lease released', done.status);
  const secs = done.results.hook?.secs;
  ok(secs > 1.0 && secs < 1.3, 'silence is trimmed from each line (1 s tone + 60 ms each side)', `${secs} s`);
  const blob = await get(done.results.hook.path, { access: 'private', useCache: false });
  const wav = blob?.stream ? Buffer.from(await new Response(blob.stream).arrayBuffer()) : Buffer.alloc(0);
  ok(wav.subarray(0, 4).toString() === 'RIFF' && wav.readUInt32LE(40) === wav.length - 44 && wav.readUInt32LE(24) === rate, 'the stored line is a valid WAV with a corrected header', `${wav.length} bytes`);
  // Resume: a job voiced partly keeps its voiced lines.
  const before = calls;
  const { data: j2 } = await db.from('studio_voice_jobs').insert({ tenant_id: desk.id, created_by: 'verify', ...good, title: 'Verify resume', results: { hook: done.results.hook } }).select('id').single();
  ids.push(j2!.id);
  await runVoiceJobs();
  ok(calls - before === 2, 'a resumed job voices only its remaining lines', `${calls - before} calls`);
  // A held lease is respected.
  const { data: j3 } = await db.from('studio_voice_jobs').insert({ tenant_id: desk.id, created_by: 'verify', ...good, title: 'Verify lease', status: 'voicing', lease_until: new Date(Date.now() + 60_000).toISOString() }).select('id').single();
  ids.push(j3!.id);
  const b3 = calls; await runVoiceJobs();
  ok(calls === b3, 'a job another tick holds is left alone');
  // Failure is recorded, not thrown.
  failNext = true;
  const { data: j4 } = await db.from('studio_voice_jobs').insert({ tenant_id: desk.id, created_by: 'verify', ...good, title: 'Verify failure', lines: [{ id: 'x', text: 'x' }] }).select('id').single();
  ids.push(j4!.id);
  await db.from('studio_voice_jobs').update({ status: 'done', lease_until: null }).eq('id', j3!.id); // out of the way
  // Only a 400 or 404 falls through to the second model; a 500 fails the job.
  const r4 = await runVoiceJobs();
  const { data: f } = await db.from('studio_voice_jobs').select('status, error').eq('id', j4!.id).single();
  ok(f!.status === 'failed' && /outage/.test(f!.error ?? ''), 'a voicing error fails the job with the reason', `${f!.status}: ${f!.error}`);
  ok(r4.failed === 1, 'the cron reports the failure', JSON.stringify(r4));
  // The voice reading the direction aloud: a 20 s take for a two-word line is retried without it, then refused.
  ok(typeof checkJob({ title: 'x', style: 'calmly', lines: [{ id: 'a', text: 'hi' }] }) === 'string', 'a delivery direction is refused before queueing (it can be read aloud)');
  longNext = 1;
  const { data: j5 } = await db.from('studio_voice_jobs').insert({ tenant_id: desk.id, created_by: 'verify', ...good, title: 'Verify retry', lines: [{ id: 'r', text: 'Two words.' }] }).select('id').single();
  ids.push(j5!.id);
  const b5 = calls; await runVoiceJobs();
  const { data: g5 } = await db.from('studio_voice_jobs').select('status, results').eq('id', j5!.id).single();
  ok(calls - b5 === 2 && g5!.status === 'done' && g5!.results.r.secs < 1.3, 'a take far longer than its line is voiced once more', `${calls - b5} calls, ${g5!.results.r?.secs} s`);
  longNext = 2;
  const { data: j6 } = await db.from('studio_voice_jobs').insert({ tenant_id: desk.id, created_by: 'verify', ...good, title: 'Verify too long', lines: [{ id: 'q', text: 'Two words.' }] }).select('id').single();
  ids.push(j6!.id);
  await runVoiceJobs();
  const { data: g6 } = await db.from('studio_voice_jobs').select('status, error').eq('id', j6!.id).single();
  ok(g6!.status === 'failed' && /said more than the line/.test(g6!.error ?? ''), 'still too long fails with the reason', g6!.error ?? '');
} finally {
  const { data: rows } = await db.from('studio_voice_jobs').select('results').in('id', ids);
  const paths = (rows ?? []).flatMap((r) => Object.values((r.results ?? {}) as Record<string, { path: string }>).map((x) => x.path));
  if (paths.length) await del([...new Set(paths)]).catch(() => {});
  await db.from('studio_voice_jobs').delete().in('id', ids);
  server.close();
}
console.log(fails ? `\n${fails} FAILED` : '\nall voice-job checks passed');
process.exit(fails ? 1 : 0);
