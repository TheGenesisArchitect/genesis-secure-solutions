// Verify Helix knows the Newsroom's stories and UnEdit's recordings inside out (lib/helix-stories.ts), preview DB only.
// Seeds a story with claims, a morning-brief heat, a written production cut into a recording with clips and posts, plus
// a second story still on the desk; checks story_list, story_card, recording_card, the not-found answers, and that
// typed, voice and Studio Helix all carry the lookups. Cleans up.
// Run: npx tsx --conditions=react-server --env-file=.env.local scripts/verify-helix-stories.mts
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const { runStoryLookup, storyLookupRules, storyTools, STORY_LOOKUPS } = await import('../lib/helix-stories');
const { studioSystem, UNEDIT_TOOLS, STUDIO_HOME_TOOLS } = await import('../lib/helix-bible');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (name: string, ok: unknown, info?: unknown) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`, JSON.stringify(info ?? '').slice(0, 600)); } };
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };
const tenant = must(await db.from('tenants').select('id').eq('slug', 'genovus').single()).id as string;
const tag = randomBytes(3).toString('hex');
const T = (s: string) => `${s} zq${tag}`;
const has = (x: string, start: string) => x.startsWith(start) && x.includes(`zq${tag}`);
let s1 = '', s2 = '', brief = '', vlog = '';

try {
  s1 = must(await db.from('newsroom_stories').insert({ tenant_id: tenant, beat: 'ai', headline: T('Regulators probe rogue agent incident'), source: 'Example Wire', url: 'https://example.com/a', why: 'Founders run agents in production.', fit: 88, status: 'in_studio',
    angles: [{ title: 'What it means for your agents', line: 'Three checks before Friday' }, { title: 'Who is liable', line: 'The contract clause to read' }], chosen_angle: 0 }).select('id').single()).id;
  s2 = must(await db.from('newsroom_stories').insert({ tenant_id: tenant, beat: 'markets', headline: T('Chip stocks slide before earnings'), source: 'Example Markets', url: 'https://example.com/b', fit: 61, status: 'new', angles: [] }).select('id').single()).id;
  must(await db.from('newsroom_claims').insert([
    { tenant_id: tenant, story_id: s1, text: T('The agency opened an inquiry on Monday'), status: 'confirmed', attribution: 'the agency', source_title: 'Agency release', source_url: 'https://example.com/r', passage_verified: true },
    { tenant_id: tenant, story_id: s1, text: T('The agent accessed other systems'), status: 'alleged', attribution: 'the complaint', denial: 'The company disputes it.', source_url: 'https://example.com/c', passage_verified: false },
  ]));
  brief = must(await db.from('newsroom_briefs').insert({ tenant_id: tenant, day: '2099-01-02', summary: 'x', hot: [{ story_id: s1, heat: 91, why: T('Six outlets today'), angle: 'Agents gone rogue' }] }).select('id').single()).id;
  vlog = randomUUID();
  must(await db.from('unedit_vlogs').insert({ id: vlog, tenant_id: tenant, title: T('Rogue agents explained'), file_name: 'v.mp4', blob_path: `studio/vlogs/uploads/verify-st-${vlog}.mp4`, blob_url: 'https://example.invalid/v.mp4', bytes: 1000,
    fingerprint: `1000:${randomBytes(32).toString('hex')}:${randomBytes(32).toString('hex')}`, stage: 'published', duration_s: 312, cost_cents: 140, episode: { title: T('Rogue agents explained'), description: 'What happened and what to check.', chapters: [{ t: 0, title: 'What happened' }, { t: 90, title: 'Three checks' }] },
    post_plan: { mode: 'plan', rhythm: 'flood', why: 'Heat 91 and under a day old.' } }));
  const clips = must(await db.from('unedit_clips').insert([1, 2].map((n) => ({ tenant_id: tenant, vlog_id: vlog, n, start_s: n * 20, end_s: n * 20 + 18, hook_start_s: n === 1 ? 20 : null, title: T(`Check ${n}`), caption: `Caption ${n}`, copy: { instagram: `IG copy ${n}` }, blob_path: `studio/vlogs/${vlog}/clip-${n}.mp4`, secs: 18, status: 'approved' }))).select('id, n'));
  must(await db.from('unedit_posts').insert([
    { tenant_id: tenant, vlog_id: vlog, clip_id: clips.find((c) => c.n === 1)!.id, platform: 'instagram', kind: 'reel', status: 'posted', posted_url: 'https://instagram.com/p/x', scheduled_at: new Date(Date.now() - 86_400_000).toISOString(), title: 't', body: 'b' },
    { tenant_id: tenant, vlog_id: vlog, clip_id: clips.find((c) => c.n === 2)!.id, platform: 'facebook', kind: 'reel', status: 'queued', scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), title: 't', body: 'b' },
  ]));
  must(await db.from('newsroom_productions').insert({ tenant_id: tenant, story_id: s1, angle: 'What it means for your agents', formats: ['episode', 'clips'], outputs: { script: T('SCRIPT: Here is what happened'), teleprompter: 'Here is what happened.', broll: ['agency building'], social: { linkedin: 'x' } }, vlog_id: vlog }));

  console.log('story_list');
  const list = await runStoryLookup(db, 'story_list', { limit: 25 }) as { stories: string[] };
  const l1 = list.stories.find((x) => has(x, 'Regulators probe'));
  check('lists the story with heat, fit, angles and claims', l1 && l1.includes('heat 91') && l1.includes('fit 88') && l1.includes('2 angles') && l1.includes('2 claims (1 confirmed)'), l1);
  check('shows how far it got: posted', l1?.includes('posted (1 live)'), l1);
  check('the hot story sorts above the unrated one', list.stories.findIndex((x) => has(x, 'Regulators probe')) < list.stories.findIndex((x) => has(x, 'Chip stocks')));
  const l2 = list.stories.find((x) => has(x, 'Chip stocks'));
  check('a fresh story reads as on the desk, not in a brief', l2?.includes('not in a brief') && l2.includes('on the desk'), l2);
  const byBeat = await runStoryLookup(db, 'story_list', { beat: 'markets', limit: 25 }) as { stories: string[] };
  check('filter by beat', byBeat.stories.every((x) => x.includes('| markets')) && byBeat.stories.some((x) => has(x, 'Chip stocks')));

  console.log('story_card');
  const card = await runStoryLookup(db, 'story_card', { headline: `regulators rogue agent zq${tag}` }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  check('finds the story by headline words', card.found === true && card.story.headline === T('Regulators probe rogue agent incident'), card);
  check('heat with why it is hot', card.story.heat?.heat === 91 && String(card.story.heat.why_hot).includes('Six outlets'), card.story.heat);
  check('angles with the chosen one marked', card.story.angles[0].startsWith('[CHOSEN] What it means'), card.story.angles);
  check('confirmed claim with source and verified passage', card.claims.some((c: string) => c.startsWith('1. CONFIRMED, passage verified') && c.includes('Agency release')), card.claims);
  check('alleged claim keeps its status and the other side', card.claims.some((c: string) => c.startsWith('2. ALLEGED') && c.includes('Other side: The company disputes it.')), card.claims);
  check('the script written for it', card.productions[0]?.script?.includes('SCRIPT: Here is what happened'), card.productions);
  check('the recording it became, with clips and posts', card.recordings[0]?.recording?.title === T('Rogue agents explained') && card.recordings[0].clips.length === 2 && card.recordings[0].posts.some((p: string) => p.includes('live')), card.recordings);
  const nf = await runStoryLookup(db, 'story_card', { headline: `nothing like this zz${tag}` });
  check('no match says so (never guesses)', nf.found === false, nf);

  console.log('recording_card');
  const rc = await runStoryLookup(db, 'recording_card', { title: `rogue agents explained zq${tag}` }) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  check('finds the recording by title words', rc.found === true && rc.recording.length === '5:12', rc.recording);
  check('chapters and posting plan', rc.recording.chapters.includes('Three checks') && String(rc.recording.posting_plan).includes('flood'), rc.recording);
  check('clips with hook, caption and copy', rc.clips[0].includes('hook first') && rc.clips[0].includes('Caption 1') && rc.clips[0].includes('IG copy 1'), rc.clips);
  check('posts: live with link, waiting with time', rc.posts.some((p: string) => p.includes('Instagram: live') && p.includes('instagram.com')) && rc.posts.some((p: string) => p.includes('Facebook: waiting')), rc.posts);
  check('the story it was cut against', rc.cut_against_story?.headline === T('Regulators probe rogue agent incident'), rc.cut_against_story);
  check('says views are not tracked (no invented numbers)', /not in Genovus yet/.test(rc.performance));

  console.log('where Helix uses them');
  check('typed rules name all three lookups', STORY_LOOKUPS.every((t) => storyLookupRules(false).includes(t)) && /never present an alleged claim as fact/.test(storyLookupRules(false)));
  check('voice tools declared', storyTools.map((t) => t.name).join() === 'story_list,story_card,recording_card');
  const names = (x: { functionDeclarations: unknown }[]) => (x[0].functionDeclarations as { name: string }[]).map((d) => d.name);
  check('Studio voice on UnEdit pages has them', ['story_card', 'recording_card', 'move_posts'].every((n) => names(UNEDIT_TOOLS).includes(n)));
  check('Studio voice on the Studio home has them', ['story_card', 'plan_production'].every((n) => names(STUDIO_HOME_TOOLS).includes(n)));
  check('Studio voice instructions explain them', (await studioSystem({ kind: 'unedit' })).includes('STORIES AND RECORDINGS'));
} finally {
  if (vlog) { await db.from('newsroom_productions').delete().eq('vlog_id', vlog); await db.from('unedit_posts').delete().eq('vlog_id', vlog); await db.from('unedit_clips').delete().eq('vlog_id', vlog); await db.from('unedit_vlogs').delete().eq('id', vlog); }
  if (brief) await db.from('newsroom_briefs').delete().eq('id', brief);
  for (const s of [s1, s2].filter(Boolean)) await db.from('newsroom_stories').delete().eq('id', s);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
