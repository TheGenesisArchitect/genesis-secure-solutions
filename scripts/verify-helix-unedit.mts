// Verify Helix sees UnEdit Studio and the Newsroom (lib/helix-unedit-brief.ts), preview DB only: seeds a recording
// waiting for review, a stuck one, a stopped one, a scheduled post, a failed post, a Newsroom brief with a hot story and
// an unrecorded production; checks the brief lines, the Enterprise brief and Studio voice carry them. Cleans up.
// Run: npx tsx --conditions=react-server --env-file=.env.local scripts/verify-helix-unedit.mts
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const { uneditBriefLines } = await import('../lib/helix-unedit-brief');
const { enterpriseBrief } = await import('../lib/helix-enterprise');
const { studioSystem } = await import('../lib/helix-bible');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (name: string, ok: unknown, info?: unknown) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`, info ?? ''); } };
const must = <T,>(r: { data: T; error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); return r.data; };
const tenant = must(await db.from('tenants').select('id').eq('slug', 'genovus').single()).id as string;
const tag = randomBytes(3).toString('hex');
const vlogs: string[] = [];
let story = '', brief = '';

async function vlog(name: string, stage: string, extra: Record<string, unknown> = {}) {
  const id = randomUUID();
  must(await db.from('unedit_vlogs').insert({ id, tenant_id: tenant, title: name, file_name: 'v.mp4', blob_path: `studio/vlogs/uploads/verify-hx-${id}.mp4`, blob_url: 'https://example.invalid/v.mp4', bytes: 1000,
    fingerprint: `1000:${randomBytes(32).toString('hex')}:${randomBytes(32).toString('hex')}`, stage, episode: { title: name }, cost_cents: 37, ...extra }));
  vlogs.push(id);
  return id;
}
try {
  const R = await vlog(`HX Review ${tag}`, 'review');
  must(await db.from('unedit_clips').insert([1, 2].map((n) => ({ tenant_id: tenant, vlog_id: R, n, start_s: n * 20, end_s: n * 20 + 18, title: `c${n}`, caption: 'c', copy: {}, blob_path: `studio/vlogs/${R}/clip-${n}.mp4`, secs: 18, status: 'ready' }))));
  await vlog(`HX Stuck ${tag}`, 'rendering', { stage_at: new Date(Date.now() - 5 * 3_600_000).toISOString() });
  await vlog(`HX Stopped ${tag}`, 'failed', { error: `Transcription failed ${tag}` });
  const P = await vlog(`HX Posted ${tag}`, 'published');
  must(await db.from('unedit_posts').insert([
    { tenant_id: tenant, vlog_id: P, platform: 'instagram', kind: 'reel', status: 'queued', scheduled_at: new Date(Date.now() + 2 * 86_400_000).toISOString(), title: 't', body: 'b' },
    { tenant_id: tenant, vlog_id: P, platform: 'facebook', kind: 'reel', status: 'error', mc_error: `Page token expired ${tag}`, scheduled_at: new Date(Date.now() - 86_400_000).toISOString(), title: 't', body: 'b' },
  ]));
  story = must(await db.from('newsroom_stories').insert({ tenant_id: tenant, beat: 'ai', headline: `HX hot story ${tag}`, source: 'Example Wire', url: 'https://example.com/a', status: 'new' }).select('id').single()).id;
  brief = must(await db.from('newsroom_briefs').insert({ tenant_id: tenant, day: '2099-01-01', summary: `HX summary ${tag}`, hot: [{ story_id: story, heat: 82, why: `HX why ${tag}`, angle: `HX angle ${tag}` }] }).select('id').single()).id;
  must(await db.from('newsroom_productions').insert({ tenant_id: tenant, story_id: story, angle: `HX production ${tag}`, next_upload: true }));

  console.log('brief lines');
  const t = (await uneditBriefLines(db)).join('\n');
  check('a section heading for UnEdit and the Newsroom', /^UNEDIT STUDIO & NEWSROOM/.test(t));
  check('waiting for review, with clips ready', t.includes(`"HX Review ${tag}" (2 clips ready`), t.split('\n')[2]);
  check('stuck: rendering for hours', t.includes(`"HX Stuck ${tag}" (rendering for 5 h)`), t.split('\n')[3]);
  check('stopped, with its error', t.includes(`Transcription failed ${tag}`));
  check('the next 7 days of the calendar', /Posting calendar, next 7 days/.test(t) && t.includes(`HX Posted ${tag}, full video, Instagram`));
  check('a failed post with its reason', t.includes(`Page token expired ${tag}`));
  check('says post views are not tracked yet (no invented numbers)', /not tracked in Genovus yet/.test(t));
  check('spend this month', /UnEdit and Newsroom spend this month: \$/.test(t));
  check('the morning brief summary', t.includes(`HX summary ${tag}`));
  check('hot topic with headline, heat, why and angle', t.includes(`"HX hot story ${tag}" (Example Wire, new) heat 82: HX why ${tag} Angle: HX angle ${tag}`));
  check('an unrecorded production', t.includes(`angle "HX production ${tag}" (the next upload is cut against it)`));

  console.log('where Helix reads it');
  const ent = await enterpriseBrief(db as never, { money: false });
  check('Enterprise Ask Helix brief carries the section', ent.text.includes('UNEDIT STUDIO & NEWSROOM') && ent.text.includes(`HX Review ${tag}`));
  check('the section sits before SPEND METERS', ent.text.indexOf('UNEDIT STUDIO') < ent.text.indexOf('SPEND METERS'));
  const home = await studioSystem({ kind: 'home' });
  check('Studio voice on the Studio home knows it', home.includes(`HX hot story ${tag}`));
  const un = await studioSystem({ kind: 'unedit' });
  check('Studio voice on UnEdit pages knows it (with the calendar)', un.includes(`HX Stuck ${tag}`) && un.includes('POSTING CALENDAR BY VOICE'));
} finally {
  if (brief) await db.from('newsroom_briefs').delete().eq('id', brief);
  if (story) await db.from('newsroom_stories').delete().eq('id', story);
  if (vlogs.length) { await db.from('unedit_posts').delete().in('vlog_id', vlogs); await db.from('unedit_clips').delete().in('vlog_id', vlogs); await db.from('unedit_vlogs').delete().in('id', vlogs); }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
