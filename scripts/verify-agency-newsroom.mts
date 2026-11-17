// Verify the Agency Newsroom foundations (desks, local heat, the insurance copy check), preview DB only, no paid calls:
// the JAVA desk resolves from its profile; one desk never sees or acts on another's stories (lookups, actions, the
// Newsroom's buttons, Helix's brief); Columbus means Columbus, GA; agency heat follows the vision's formula; the copy
// check catches every rule and passes clean copy. Cleans up.
// Run: npx tsx --conditions=react-server --env-file=.env.local scripts/verify-agency-newsroom.mts
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const { deskFor, deskNamed, allDesks } = await import('../lib/desk');
const { runStoryLookup } = await import('../lib/helix-stories');
const { studioAction } = await import('../lib/helix-studio-act');
const { newsroomAction } = await import('../lib/newsroom-actions');
const { uneditBriefLines } = await import('../lib/helix-unedit-brief');
const { localScore, agencyHeat } = await import('../lib/newsroom-feed');
const { settings } = await import('../lib/newsroom');
const { checkCopy, copyRules } = await import('../lib/agency-copy');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (name: string, ok: unknown, info?: unknown) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`, JSON.stringify(info ?? '').slice(0, 500)); } };
const admin = (await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single()).data!.user_id as string;
const tag = randomBytes(3).toString('hex');
const made: string[] = [];
let brief = '';

try {
  console.log('desks');
  const house = await deskFor(), java = await deskFor('mendez-hollis');
  check('the house desk is Genovus', house.house && house.slug === 'genovus');
  check('JAVA is an agency desk from its profile', !java.house && java.name === 'JAVA Agency LLC' && java.profile?.host === 'Mendez' && java.profile.lines.includes('Boat'), java);
  check('an unknown desk falls back to the house', (await deskFor('no-such-desk')).house);
  check('“JAVA” and “Mendez” name his desk; nothing named is the house', (await deskNamed('JAVA')).slug === 'mendez-hollis' && (await deskNamed('Mendez')).slug === 'mendez-hollis' && (await deskNamed('')).house);
  check('every desk: house first, then JAVA', (await allDesks()).map((d) => d.slug).slice(0, 2).join() === 'genovus,mendez-hollis');
  const s = await settings(java.id);
  check('JAVA has its seven local beats with sources', s.beats.length === 7 && s.beats.every((b) => b.lines?.length) && s.beats.find((b) => b.id === 'weather')?.nws === true && s.beats.find((b) => b.id === 'recalls')?.national === true, s.beats.map((b) => b.id));
  check('the house desk keeps its own beats and no profile', (await settings(house.id)).profile === null);

  console.log('one desk never sees another');
  const js = (await db.from('newsroom_stories').insert({ tenant_id: java.id, beat: 'weather', headline: `Storm watch for the Valley zq${tag}`, source: 'National Weather Service', url: 'https://forecast.weather.gov/x', status: 'new', angles: [{ title: 'Before bed tonight' }, { title: 'After the storm' }] }).select('id').single()).data!.id as string;
  made.push(js);
  brief = (await db.from('newsroom_briefs').insert({ tenant_id: java.id, day: '2099-02-01', summary: `JAVA summary zq${tag}`, hot: [{ story_id: js, heat: 86, why: 'Watch starts at 6 PM', angle: 'Three things before bed' }] }).select('id').single()).data!.id as string;
  const onJava = await runStoryLookup(db, 'story_card', { headline: `storm watch valley zq${tag}` }, java.id);
  const onHouse = await runStoryLookup(db, 'story_card', { headline: `storm watch valley zq${tag}` }, house.id);
  check('story_card finds it on JAVA’s desk, with its heat', onJava.found === true && (onJava as { story: { heat: { heat: number } } }).story.heat.heat === 86, onJava);
  check('the house desk cannot see it', onHouse.found === false, onHouse);
  const houseList = await runStoryLookup(db, 'story_list', { limit: 25, days: 2 }, house.id) as { stories: string[] };
  check('the house desk list leaves it out', !houseList.stories.some((x) => x.includes(`zq${tag}`)));
  const ctxHouse = { by: admin, origin: 'http://localhost:1', desk: { id: house.id, slug: house.slug } };
  const ctxJava = { by: admin, origin: 'http://localhost:1', desk: { id: java.id, slug: java.slug } };
  const a1 = await studioAction('pick_angle', { story: `storm watch valley zq${tag}`, angle: 2 }, ctxHouse);
  check('Helix on the house desk cannot act on it', !a1.ok, a1);
  const a2 = await studioAction('pick_angle', { story: `storm watch valley zq${tag}`, angle: 2 }, ctxJava);
  const ch = (await db.from('newsroom_stories').select('chosen_angle').eq('id', js).single()).data!.chosen_angle;
  check('Helix on JAVA’s desk picks its angle', a2.ok && ch === 1, a2);
  let refused = '';
  try { await newsroomAction({ tool: 'set_angle', story: js, angle: 0 }, admin, 'http://localhost:1'); } catch (e) { refused = e instanceof Error ? e.message : String(e); }
  check('the Newsroom’s button on the house desk refuses it', refused === 'Story not found.', refused);
  const ok = await newsroomAction({ tool: 'set_angle', story: js, angle: 0, desk: 'mendez-hollis' }, admin, 'http://localhost:1');
  check('the same button on JAVA’s desk works', /Angle picked/.test(ok.say));
  const hb = (await uneditBriefLines(db, house)).join('\n'), jb = (await uneditBriefLines(db, java)).join('\n');
  check('Helix’s Genovus section never shows JAVA’s brief', !hb.includes(`zq${tag}`) && /GENOVUS DESK/.test(hb));
  check('JAVA’s section shows its own brief and is labeled', jb.includes(`JAVA summary zq${tag}`) && /JAVA AGENCY LLC DESK/.test(jb), jb.slice(0, 300));

  console.log('local means Columbus, GA');
  const p = java.profile!;
  check('Columbus with a Georgia station is local (30)', localScore({ title: 'Columbus road work update', summary: '', source: 'WTVM' }, p) === 30);
  check('Columbus, Ohio is not local (0)', localScore({ title: 'Columbus homeowners find a fresh start', summary: '', source: 'Fox 28' }, p) === 0 && localScore({ title: 'Columbus plan draws council ire', summary: 'Ohio', source: 'The Columbus Dispatch' }, p) === 0);
  check('Columbus with no Georgia signal is not counted', localScore({ title: 'Columbus weekend events', summary: '', source: 'Some Site' }, p) === 0);
  check('Phenix City and Lake Harding are local', localScore({ title: 'Phenix City opens new park', summary: '' }, p) === 30 && localScore({ title: 'Boat ramp news', summary: 'at Lake Harding this weekend' }, p) === 20);
  check('Georgia statewide counts a little (15)', localScore({ title: 'Georgia gas prices cool', summary: '' }, p) === 15);
  const weather = (await settings(java.id)).beats.find((b) => b.id === 'weather')!;
  const h = agencyHeat({ title: 'Severe storm watch for Columbus, Ga. tonight', summary: 'Hail could damage cars and roofs', at: Date.now() - 3600_000 }, weather, p, new Date('2026-04-10T12:00:00Z'));
  check('agency heat: local 30 + lines + act today 20 + season 10', h.heat >= 85 && /local 30/.test(h.parts) && /act today 20/.test(h.parts) && /season 10/.test(h.parts), h);

  console.log('the copy check');
  const rule = (t: string) => checkCopy(t, p).map((i) => i.rule);
  check('price: “save up to 20%”', rule('Switch today and save up to 20%.').includes('price'));
  check('price: dollar amounts and quotes', rule('Plans from $29 a month, get a free quote').includes('price'));
  check('coverage advice: “hail damage is covered”', rule('Don’t worry, hail damage is covered on comprehensive.').includes('coverage'));
  check('coverage advice: “your policy covers flooding”', rule('Your policy covers flooding from the river.').includes('coverage'));
  check('other lines: life insurance', rule('Ask us about life insurance too.').includes('line'));
  check('competitors by name', rule('Better than State Farm, ask anyone.').includes('competitor'));
  check('speaking for corporate', rule('GEICO guarantees the fastest claims.').includes('corporate'));
  check('no tragedy hooks', rule('After the deadly crash on I-185, check your coverage.').includes('tragedy'));
  check('English only', rule('Llámenos hoy, hablamos español.').includes('language'));
  const clean = 'Storms are expected tonight. Park away from trees, take photos of your car and home, and if you are not sure what your policy includes, call us and we’ll review it with you. I’m Mendez, your local GEICO office in Columbus. A GEICO Exclusive Agency.';
  check('clean, helpful copy passes', checkCopy(clean, p).length === 0, checkCopy(clean, p));
  check('the writer’s rules end on his sign-off', copyRules(p).includes(p.sign_off));
} finally {
  if (brief) await db.from('newsroom_briefs').delete().eq('id', brief);
  for (const id of made) await db.from('newsroom_stories').delete().eq('id', id);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
