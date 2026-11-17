// Verify slices 5-6 of the Agency Newsroom (migration 0113), preview DB only, nothing sent: JAVA's clips carry his crest,
// colors and end card and never a Genovus screen; the house desk's clips are unchanged; a campaign waiting for him
// queues his approval email AND a phone alert; the morning brief's email and alert queue at 7 AM ET only while brief_on
// is true, read as his brief (his name, his stories) and pass his copy rules. Cleans up.
// Run: npx tsx --conditions=react-server --env-file=.env.local scripts/verify-agency-alerts.mts
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const { deskFor } = await import('../lib/desk');
const { proBrand, proProps } = await import('../lib/unedit-pro');
const { briefNotices, queueBriefNotices } = await import('../lib/newsroom-morning');
const { outboxEmail } = await import('../lib/email');
const { checkCopy } = await import('../lib/agency-copy');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (name: string, ok: unknown, info?: unknown) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`, JSON.stringify(info ?? '').slice(0, 500)); } };
const java = await deskFor('mendez-hollis'), house = await deskFor();
const admin = (await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single()).data!.user_id as string;
const tag = randomBytes(3).toString('hex');
const keys: string[] = [];
let member = false, sub = '', approval = '', story = '';
const before = (await db.from('newsroom_settings').select('brief_on, brief_to').eq('tenant_id', java.id).single()).data!;

try {
  console.log('his look on his clips');
  const b = proBrand(java.profile);
  check('JAVA’s brand: his crest (white and navy) on genovus.io, his navy and lime', b && b.name === 'JAVA Agency LLC' && b.line === 'A GEICO Exclusive Agency' && /^https:\/\/.+\/brand\/agencies\/mendez-hollis\/crest-white\.png$/.test(b.mark) && /crest-navy\.png$/.test(b.markDark ?? '') && b.navy === '#071d43' && b.accent === '#acd137', b);
  check('the house desk has no agency brand', proBrand(house.profile) === null);
  const words = ['Storms', 'tonight.', 'Park', 'away', 'from', 'trees.', 'Call', 'us.'].map((w, i) => ({ w, s: i * 0.5, e: i * 0.5 + 0.4 }));
  const spans = [{ from: 0, to: 4 }];
  const shots = [
    { s: 0, e: 1, layout: 'face', accent: null, figure: null, screen: null },
    { s: 1, e: 2.5, layout: 'screen', accent: null, figure: null, screen: 'today' },
    { s: 2.5, e: 3.5, layout: 'split', accent: null, figure: null, screen: 'leads' },
    { s: 3.5, e: 4, layout: 'number', accent: null, figure: '3', screen: null },
  ] as never;
  const cues = [{ s: 1, e: 2, w: 2, kind: 'tap', text: 'Tap', screen: 'today', sound: null, cam: null }] as never;
  const pj = await proProps('https://example.invalid/c.mp4', words, spans, shots, [], cues, b);
  check('his clip shows no Genovus screen: screen and split shots become him', pj.shots.every((s) => !s.screen) && pj.shots[1].layout === 'face' && pj.shots[2].layout === 'face' && pj.shots[3].layout === 'number', pj.shots);
  check('no screen cues on his clip', pj.cues.length === 0, pj.cues);
  check('his clip carries his brand, in his plain caption style (no Genovus serif)', pj.brand === b && pj.serif === false);

  console.log('a campaign waiting for him: email and phone');
  await db.from('memberships').insert({ tenant_id: java.id, user_id: admin, role: 'owner' }); member = true;
  sub = (await db.from('push_subscriptions').insert({ user_id: admin, endpoint: `https://push.example.invalid/${tag}`, p256dh: 'x', auth: 'y', device: 'verify' }).select('id').single()).data!.id as string;
  approval = (await db.from('approvals').insert({ tenant_id: java.id, subject_kind: 'post', lane: 'required', approver: 'client', title: `Storm tips campaign zq${tag}`, status: 'pending', body: { kind: 'unedit' } }).select('id').single()).data!.id as string;
  const ob = (await db.from('outbox').select('template, to_email, data, dedupe_key').like('dedupe_key', `approval%${approval}%`)).data ?? [];
  keys.push(...ob.map((r) => r.dedupe_key as string));
  check('his approval email is queued', ob.some((r) => r.template === 'approval_waiting' && r.to_email !== 'push'), ob);
  const push = ob.find((r) => r.template === 'approval_push');
  check('and an alert on his phone that opens his Approvals', push && push.to_email === 'push' && (push.data as Record<string, string>).url === '/app/mendez-hollis/approvals' && /Nothing posts until you approve/.test((push.data as Record<string, string>).body), push);

  console.log('the morning brief');
  story = (await db.from('newsroom_stories').insert({ tenant_id: java.id, beat: 'weather', headline: `Storm watch for the Valley zq${tag}`, source: 'National Weather Service', url: 'https://forecast.weather.gov/x', status: 'new' }).select('id').single()).data!.id as string;
  const brief = { day: `2099-03-0${1 + (parseInt(tag, 16) % 8)}`, summary: 'Storms roll through the Valley tonight. Roads are slick by morning.', hot: [{ story_id: story, heat: 88, why: 'The watch starts at 6 PM', angle: 'Three things to do before the storm.' }], stats: { beats: 7, added: 1, cents: 1 }, created_at: new Date().toISOString() };
  await db.from('newsroom_settings').update({ brief_on: false, brief_to: null }).eq('tenant_id', java.id);
  check('while brief_on is off nothing is queued', (await queueBriefNotices(java.id, brief)) === 0 && !((await db.from('outbox').select('id').like('dedupe_key', `brief%${brief.day}%`)).data ?? []).length);
  await db.from('newsroom_settings').update({ brief_on: true, brief_to: `mendez-verify-${tag}@example.invalid` }).eq('tenant_id', java.id);
  const n = await queueBriefNotices(java.id, brief);
  const rows = (await db.from('outbox').select('template, to_email, data, send_after, dedupe_key').like('dedupe_key', `brief%${brief.day}%`)).data ?? [];
  keys.push(...rows.map((r) => r.dedupe_key as string));
  check('turned on: one email to him and one phone alert', n === 2 && rows.some((r) => r.template === 'agency_brief' && r.to_email === `mendez-verify-${tag}@example.invalid`) && rows.some((r) => r.template === 'brief_push'), rows);
  const at = new Date(rows[0]?.send_after as string);
  const nyHour = Number(at.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  check('they go out at 7 AM ET (or now, if later)', nyHour === 7 || Math.abs(at.getTime() - Date.now()) < 120_000, at.toISOString());
  check('one of each per day: running again adds nothing', (await queueBriefNotices(java.id, brief), ((await db.from('outbox').select('id').like('dedupe_key', `brief%${brief.day}%`)).data ?? []).length) === 2);
  const mail = outboxEmail('agency_brief', 'x@example.invalid', rows.find((r) => r.template === 'agency_brief')!.data as Record<string, string>, 'https://genovus.io')!;
  check('the email is his brief: his name, the story and its angle, his dashboard', /Good morning, Mendez/.test(mail.html) && mail.html.includes(`zq${tag}`) && /Three things to do before the storm/.test(mail.subject) && mail.html.includes('/app/mendez-hollis'), mail.subject);
  check('the brief passes his copy rules', checkCopy(mail.text.replace(/genovus/gi, ''), java.profile!).length === 0, checkCopy(mail.text, java.profile!));
  const pv = await briefNotices(house.id, brief, null, true);
  check('the house desk never gets an agency brief', pv.length === 0);
} finally {
  await db.from('newsroom_settings').update({ brief_on: before.brief_on, brief_to: before.brief_to }).eq('tenant_id', java.id);
  for (const k of keys) await db.from('outbox').delete().eq('dedupe_key', k);
  if (approval) await db.from('approvals').delete().eq('id', approval);
  if (story) await db.from('newsroom_stories').delete().eq('id', story);
  if (sub) await db.from('push_subscriptions').delete().eq('id', sub);
  if (member) await db.from('memberships').delete().eq('tenant_id', java.id).eq('user_id', admin).eq('role', 'owner');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
