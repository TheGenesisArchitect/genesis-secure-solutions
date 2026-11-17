// Verify Helix voice on the UnEdit posting calendar (lib/unedit-helix.ts + the Studio voice setup), preview DB only.
// Seeds two recordings with waiting and sent posts, then: read the calendar, move by recording to a day (drip keeps
// its spacing), move one clip's network to a time, refuse a time too soon, refuse an ambiguous name, never touch a sent
// post, cancel, and check Helix's UnEdit instructions and tools. Cleans up after itself.
// Run: npx tsx --conditions=react-server --env-file=.env.local scripts/verify-unedit-voice.mts
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const { calendar, calendarText, movePosts, cancelPosts, pick } = await import('../lib/unedit-helix');
const { studioSystem, UNEDIT_TOOLS } = await import('../lib/helix-bible');
const { genovusTenant } = await import('../lib/unedit');
const { nyAt, nyDay } = await import('../lib/unedit-plan');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (name: string, ok: unknown, info?: unknown) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`, info ?? ''); } };
const tenant = await genovusTenant();
const today = nyDay(new Date());
const at = (plus: number, h: number, m = 0) => nyAt(today, plus, h, m).toISOString();
const ymd = (iso: string) => { const x = nyDay(new Date(iso)); return `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`; };
const ny = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/New_York' });
const tag = randomBytes(3).toString('hex');
const created: string[] = [];

async function seed(name: string, clips: number) {
  const id = randomUUID();
  const r = await db.from('unedit_vlogs').insert({ id, tenant_id: tenant, title: name, file_name: 'verify.mp4', blob_path: `studio/vlogs/uploads/verify-voice-${id}.mp4`, blob_url: 'https://example.invalid/v.mp4', bytes: 1000,
    fingerprint: `1000:${randomBytes(32).toString('hex')}:${randomBytes(32).toString('hex')}`, stage: 'published', episode: { title: name } });
  if (r.error) throw new Error(r.error.message);
  created.push(id);
  const { data: cs, error } = await db.from('unedit_clips').insert(Array.from({ length: clips }, (_, i) => ({ tenant_id: tenant, vlog_id: id, n: i + 1, start_s: i * 20, end_s: i * 20 + 18, title: `Clip ${i + 1}`, caption: 'c', copy: {}, blob_path: `studio/vlogs/${id}/clip-${i + 1}.mp4`, secs: 18, status: 'approved' }))).select('id, n');
  if (error) throw new Error(error.message);
  return { id, clip: new Map(cs!.map((c) => [c.n as number, c.id as string])) };
}
async function post(vlog: string, clip: string | null, platform: string, kind: string, when: string, status = 'queued') {
  const { data, error } = await db.from('unedit_posts').insert({ tenant_id: tenant, vlog_id: vlog, clip_id: clip, platform, kind, status, scheduled_at: when, title: 't', body: 'c' }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
const get = async (id: string) => (await db.from('unedit_posts').select('scheduled_at, status').eq('id', id).single()).data!;

try {
  const DS = await seed(`Verify voice DeepSeek ${tag}`, 2);
  const BO = await seed(`Verify voice Boat ${tag}`, 1);
  const BO2 = await seed(`Verify voice Boat Show ${tag}`, 1);
  // DeepSeek: a drip over two days, plus one already sent.
  const d1ig = await post(DS.id, DS.clip.get(1)!, 'instagram', 'reel', at(2, 10));
  const d1fb = await post(DS.id, DS.clip.get(1)!, 'facebook', 'reel', at(2, 10, 5));
  const d2ig = await post(DS.id, DS.clip.get(2)!, 'instagram', 'reel', at(4, 10));
  const dsent = await post(DS.id, DS.clip.get(2)!, 'youtube', 'short', at(0, 23, 50), 'sent');
  const b1 = await post(BO.id, BO.clip.get(1)!, 'facebook', 'reel', at(3, 12));
  const b2 = await post(BO2.id, BO2.clip.get(1)!, 'facebook', 'reel', at(5, 12));

  console.log('calendar');
  const cal = await calendarText();
  check('calendar lists the seeded posts with recording, clip and network', cal.posts.some((l) => l.includes(`Verify voice DeepSeek ${tag}, clip 2, Instagram Reel`) && l.includes('waiting')), cal.posts.slice(0, 5));
  check('a sent post reads as locked', cal.posts.some((l) => l.includes(`DeepSeek ${tag}, clip 2, YouTube Short`) && l.includes('locked')));

  console.log('move a drip to a day');
  const target = ymd(at(6, 0));
  const before = await Promise.all([d1ig, d1fb, d2ig].map(get));
  const pv = await movePosts({ recording: `DeepSeek ${tag}`, date: target, preview: true }, 'verify');
  check('preview reports 3 posts and moves nothing', pv.ok && pv.count === 3 && (await get(d1ig)).scheduled_at === before[0].scheduled_at, pv);
  const mv = await movePosts({ recording: `deepseek ${tag}`, date: target }, 'verify');
  const after = await Promise.all([d1ig, d1fb, d2ig].map(get));
  check('“push the DeepSeek clips to <day>”: 3 moved', mv.ok && mv.moved === 3, mv);
  check('first post lands on that day at its own time (10:00)', ymd(after[0].scheduled_at) === target && ny(after[0].scheduled_at) === '10:00', after[0]);
  const gap = (a: { scheduled_at: string }[]) => [Date.parse(a[1].scheduled_at) - Date.parse(a[0].scheduled_at), Date.parse(a[2].scheduled_at) - Date.parse(a[0].scheduled_at)];
  check('the drip keeps its spacing (5 min, 2 days)', JSON.stringify(gap(after)) === JSON.stringify(gap(before)), [gap(before), gap(after)]);
  check('the sent post was not touched', (await get(dsent)).status === 'sent');

  console.log('move one clip on one network to a time');
  const one = await movePosts({ recording: `DeepSeek ${tag}`, clip: '1', platform: 'facebook', date: target, time: '18:00' }, 'verify');
  const fb = await get(d1fb);
  check('clip 1 Facebook moved to 6:00 PM, Instagram stayed', one.moved === 1 && ny(fb.scheduled_at) === '18:00' && ny((await get(d1ig)).scheduled_at) === '10:00', [one, fb]);

  console.log('refusals');
  const soon = await movePosts({ recording: `Boat ${tag}`, date: ymd(new Date().toISOString()), time: ny(new Date(Date.now() + 5 * 60_000).toISOString()) }, 'verify');
  check('a time under 20 minutes out is refused', soon.ok === false && /minutes from now/.test(String(soon.error)), soon);
  const amb = pick(await calendar(), { recording: `voice ${tag}` });
  check('a name matching several recordings equally asks which', 'error' in amb && (amb.choices?.length ?? 0) >= 2, amb);
  const boat = pick(await calendar(), { recording: `Boat ${tag}` });
  check('“Boat” picks “Boat” over “Boat Show”', 'posts' in boat && boat.posts.every((p) => p.vlog === BO.id), boat);
  const exact = pick(await calendar(), { recording: `Boat Show ${tag}` });
  check('“Boat Show” picks the one recording', 'posts' in exact && exact.posts.length === 1 && exact.posts[0].id === b2, exact);
  const none = await movePosts({ recording: `Nonexistent ${tag}`, date: target }, 'verify');
  check('an unknown recording is refused with the choices', none.ok === false && Array.isArray(none.choices), none);
  const sentOnly = await movePosts({ recording: `DeepSeek ${tag}`, platform: 'youtube', date: target }, 'verify');
  check('asking to move only a sent post moves nothing', sentOnly.ok === false && (await get(dsent)).status === 'sent', sentOnly);
  const thisOne = pick(await calendar(), { recording: 'this', current: BO.id });
  check('“this” means the recording on screen', 'posts' in thisOne && thisOne.posts.every((p) => p.vlog === BO.id), thisOne);

  console.log('cancel');
  const cx = await cancelPosts({ recording: `Boat Show ${tag}` }, 'verify');
  check('cancel takes the post off the calendar', cx.ok && cx.cancelled === 1 && (await get(b2)).status === 'cancelled', cx);
  check('the other Boat recording stays', (await get(b1)).status === 'queued');

  console.log('Helix setup on UnEdit');
  const sys = await studioSystem({ kind: 'unedit' });
  check('instructions carry TODAY and the calendar', /TODAY: /.test(sys) && sys.includes(`DeepSeek ${tag}`), sys.slice(-400));
  check('cancel needs a yes in the instructions', /only after a clear yes call cancel_posts/.test(sys));
  const names = (UNEDIT_TOOLS[0].functionDeclarations as { name: string }[]).map((d) => d.name);
  check('tools: posting_calendar, move_posts, cancel_posts', ['posting_calendar', 'move_posts', 'cancel_posts'].every((n) => names.includes(n)), names);
  const sysOne = await studioSystem({ kind: 'unedit', code: DS.id });
  check('on a recording, Helix knows which one', sysOne.includes(`the recording "Verify voice DeepSeek ${tag}"`));
} finally {
  if (created.length) {
    await db.from('unedit_posts').delete().in('vlog_id', created);
    await db.from('unedit_clips').delete().in('vlog_id', created);
    await db.from('unedit_vlogs').delete().in('id', created);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
