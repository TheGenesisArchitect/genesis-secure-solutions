// Verify Helix's hands in the Newsroom and UnEdit (lib/helix-studio-act.ts), preview DB only, no paid calls:
// free actions run and change what the button changes; spend actions hand back a background job (not run here);
// yes-lane actions change NOTHING until confirm brings back the signed token, which only works for the same person,
// untampered; bad names, missing clips and clips still cutting are refused with a reason. Cleans up.
// Run: npx tsx --conditions=react-server --env-file=.env.local scripts/verify-helix-act.mts
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const { studioAction, confirmStudioAction } = await import('../lib/helix-studio-act');
const { ACTIONS, studioActTools, studioActRules } = await import('../lib/helix-act-tools');
const { UNEDIT_TOOLS, STUDIO_HOME_TOOLS, studioSystem } = await import('../lib/helix-bible');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (name: string, ok: unknown, info?: unknown) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`, JSON.stringify(info ?? '').slice(0, 500)); } };
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };
const tenant = must(await db.from('tenants').select('id').eq('slug', 'genovus').single()).id as string;
const admin = must(await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single()).user_id as string;
const tag = randomBytes(3).toString('hex');
const ctx = { by: admin, origin: 'http://localhost:1' };
let s1 = '', vlog = '', vlog2 = '';

try {
  s1 = must(await db.from('newsroom_stories').insert({ tenant_id: tenant, beat: 'ai', headline: `Helix hands test story zq${tag}`, source: 'Example', url: 'https://example.com/h', status: 'new', angles: [{ title: 'First angle' }, { title: 'Second angle' }] }).select('id').single()).id;
  must(await db.from('newsroom_claims').insert([1, 2].map((n) => ({ tenant_id: tenant, story_id: s1, text: `Fact ${n} zq${tag}`, status: 'reported', source_url: 'https://example.com/f', passage_verified: false, approved: false }))));
  const prod = must(await db.from('newsroom_productions').insert({ tenant_id: tenant, story_id: s1, angle: 'First angle', outputs: {} }).select('id').single()).id;
  const mk = async (title: string, statuses: string[]) => {
    const id = randomUUID();
    must(await db.from('unedit_vlogs').insert({ id, tenant_id: tenant, title, file_name: 'v.mp4', blob_path: `studio/vlogs/uploads/verify-act-${id}.mp4`, blob_url: 'https://example.invalid/v.mp4', bytes: 1000,
      fingerprint: `1000:${randomBytes(32).toString('hex')}:${randomBytes(32).toString('hex')}`, stage: 'review', episode: { title }, thumbs: [{ blob: 'a', text: 'A', look: 'x' }, { blob: 'b', text: 'B', look: 'x' }, { blob: 'c', text: 'C', look: 'x' }] }));
    must(await db.from('unedit_clips').insert(statuses.map((st, i) => ({ tenant_id: tenant, vlog_id: id, n: i + 1, start_s: i * 20, end_s: i * 20 + 18, title: `Clip ${i + 1}`, caption: 'c', copy: { instagram: 'ig', facebook: 'fb', youtube: 'yt' }, blob_path: `studio/vlogs/${id}/clip-${i + 1}.mp4`, secs: 18, status: st }))));
    return id;
  };
  vlog = await mk(`Hands test recording zq${tag}`, ['ready', 'ready', 'ready']);
  vlog2 = await mk(`Hands still cutting zq${tag}`, ['ready', 'rendering']);
  const clip = async (n: number) => (await db.from('unedit_clips').select('status, title').eq('vlog_id', vlog).eq('n', n).single()).data!;
  const story = async () => (await db.from('newsroom_stories').select('chosen_angle, build, status').eq('id', s1).single()).data!;

  console.log('free: just does it');
  let r = await studioAction('pick_angle', { story: `hands test story zq${tag}`, angle: 2 }, ctx);
  check('pick angle 2 by headline words', r.ok && (await story()).chosen_angle === 1, r);
  r = await studioAction('set_parts', { story: s1, parts: 'Hook; What happened; What to do' }, ctx);
  check('set the parts', r.ok && JSON.stringify((await story()).build) === JSON.stringify(['Hook', 'What happened', 'What to do']), r);
  r = await studioAction('pick_angle', { story: 'this', angle: 1 }, { ...ctx, currentStory: s1 });
  check('“this story” uses the one on screen', r.ok && (await story()).chosen_angle === 0, r);
  r = await studioAction('next_upload', { story: s1 }, ctx);
  check('next upload cut against its production', r.ok && (await db.from('newsroom_productions').select('next_upload').eq('id', prod).single()).data!.next_upload === true, r);
  r = await studioAction('leave_out_clip', { recording: 'this', clip: 3 }, { ...ctx, current: vlog });
  check('leave out clip 3 on the recording on screen', r.ok && (await clip(3)).status === 'dropped', r);
  r = await studioAction('reopen_clip', { recording: `hands test recording zq${tag}`, clip: 3 }, ctx);
  check('reopen clip 3 by title words', r.ok && (await clip(3)).status !== 'dropped', [r, await clip(3)]);
  r = await studioAction('edit_clip', { recording: vlog, clip: 1, title: `New title zq${tag}` }, ctx);
  check('edit clip 1’s title', r.ok && (await clip(1)).title === `New title zq${tag}`, r);
  r = await studioAction('pick_thumbnail', { recording: vlog, thumb: 2 }, ctx);
  check('pick thumbnail 2', r.ok && (await db.from('unedit_vlogs').select('thumb_pick').eq('id', vlog).single()).data!.thumb_pick === 1, r);
  r = await studioAction('sweep_wire', {}, ctx);
  check('a slow free action runs in the background', r.ok && typeof r.background === 'function' && /^Started/.test(r.say ?? ''), r);

  console.log('spend: cost said, background job (not run here)');
  r = await studioAction('research_deeper', { story: s1 }, ctx);
  check('research deeper hands back a background job', r.ok && r.lane === 'spend' && typeof r.background === 'function', r);
  check('every spend action names its cost', Object.values(ACTIONS).filter((a) => a.lane === 'spend').every((a) => a.cost));

  console.log('yes: nothing changes until confirm');
  r = await studioAction('approve_campaign', { recording: vlog, rhythm: 'drip' }, ctx);
  const posts0 = (await db.from('unedit_posts').select('id').eq('vlog_id', vlog)).data!.length;
  check('approve returns a summary and token, no posts yet', r.ok && r.needs_yes && r.token && /3 clips plus the full video/.test(r.summary ?? '') && posts0 === 0, r);
  const bad = await confirmStudioAction(r.token!, { ...ctx, by: randomUUID() });
  check('another person cannot use the token', !bad.ok && /someone else/.test(bad.error ?? ''), bad);
  const [body, sig] = r.token!.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), a: 'post_full_video' })).toString('base64url');
  const tam = await confirmStudioAction(`${forged}.${sig}`, ctx);
  check('a tampered token is refused', !tam.ok && /not valid/.test(tam.error ?? ''), tam);
  const yes = await confirmStudioAction(r.token!, ctx);
  const posts1 = (await db.from('unedit_posts').select('id, status, scheduled_at').eq('vlog_id', vlog)).data!;
  check('after yes: the campaign is on the calendar (drip)', yes.ok && posts1.length >= 9 && posts1.every((p) => p.status === 'queued' && p.scheduled_at), [yes, posts1.length]);
  r = await studioAction('dismiss_story', { story: s1 }, ctx);
  check('dismiss waits for a yes', r.needs_yes && (await story()).status === 'new', r);
  r = await studioAction('approve_claim', { story: s1, claim: 2 }, ctx);
  check('approve fact 2 reads the fact back', r.needs_yes && (r.summary ?? '').includes(`Fact 2 zq${tag}`), r);
  const ac = await confirmStudioAction(r.token!, ctx);
  check('after yes: fact 2 approved, fact 1 untouched', ac.ok && (await db.from('newsroom_claims').select('text, approved').eq('story_id', s1).order('created_at')).data!.map((c) => c.approved).join() === 'false,true', ac);

  console.log('refusals');
  r = await studioAction('approve_campaign', { recording: vlog2 }, ctx);
  check('a clip still cutting holds the Approve', !r.ok && /still being cut/.test(r.error ?? ''), r);
  r = await studioAction('approve_clip', { recording: vlog, clip: 9 }, ctx);
  check('a clip that does not exist', !r.ok && /no clip 9/.test(r.error ?? ''), r);
  r = await studioAction('pick_angle', { story: `nothing like it zz${tag}`, angle: 1 }, ctx);
  check('an unknown story is refused', !r.ok && /No story matches/.test(r.error ?? ''), r);
  r = await studioAction('pick_angle', { story: s1, angle: 5 }, ctx);
  check('an angle out of range lists the choices', !r.ok && r.choices?.length === 2, r);
  r = await studioAction('launch_rockets', {}, ctx);
  check('an unknown action is refused', !r.ok, r);

  console.log('where Helix has them');
  const names = (x: { functionDeclarations: unknown }[]) => (x[0].functionDeclarations as { name: string }[]).map((d) => d.name);
  check('Studio voice on UnEdit pages', ['studio_action', 'confirm_studio_action', 'open_studio', 'point_at'].every((n) => names(UNEDIT_TOOLS).includes(n)));
  check('Studio voice on the Studio home', names(STUDIO_HOME_TOOLS).includes('studio_action'));
  check('the action enum matches the server list', JSON.stringify((studioActTools[0].parameters.properties.action as { enum: string[] }).enum) === JSON.stringify(Object.keys(ACTIONS)));
  check('rules: yes only after a clear yes', /Only after a clear yes, call confirm_studio_action/.test(studioActRules(true)) && /Yes button on screen/.test(studioActRules(false)));
  check('Studio voice instructions include the hands', (await studioSystem({ kind: 'unedit' })).includes('HANDS-FREE IN THE NEWSROOM AND UNEDIT'));
} finally {
  for (const v of [vlog, vlog2].filter(Boolean)) { await db.from('unedit_posts').delete().eq('vlog_id', v); await db.from('unedit_clips').delete().eq('vlog_id', v); await db.from('unedit_vlogs').delete().eq('id', v); }
  if (s1) { await db.from('newsroom_productions').delete().eq('story_id', s1); await db.from('newsroom_stories').delete().eq('id', s1); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
