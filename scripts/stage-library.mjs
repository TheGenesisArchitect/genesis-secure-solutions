// Stage the PREVIEW database for the Screen Library: the demo agency (Brooks Family Insurance, fictional; via
// stage-intro-ep1), a fictional Genovus team member for the Enterprise screens (Tasha, account lead; a reserved
// .example address that never receives mail), and fictional calls and Helix notes on the Genovus line. Everything
// staged is marked demo and replaced on each run. Refuses to run against anything but the preview database.
//   node --env-file=.env.local scripts/stage-library.mjs
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { stage as stageAgency } from './stage-intro-ep1.mjs';
import { stageGrowth } from './stage-growth.mjs';
import { stageEnterprise } from './stage-enterprise.mjs';

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
export const FILMING_STAFF = { email: 'tasha@genovus-studio.example', name: 'Tasha (Genovus)', role: 'account_lead' };

// Fictional callers (555-01xx numbers are reserved for fiction) and the notes Helix wrote after each call.
const CALLS = [
  { from: '+17065550142', minutesAgo: 38, secs: 212, status: 'answered', summary: 'Dana Whitfield, owner of Whitfield Insurance Group (independent, 4 producers). Leads come in from the website but nobody follows up after 5 p.m. Wants to see the Genovus line and follow-ups. Asked for a demo Thursday morning.' },
  { from: '+17065550117', minutesAgo: 95, secs: 0, status: 'missed', summary: null },
  { from: '+17065550163', minutesAgo: 160, secs: 168, status: 'answered', summary: 'Ray Castillo, captive agent, opening a second office in the spring. Needs a site for the new location and a way to track which ads bring calls. Interested in Growth; wants pricing by email.' },
  { from: '+17065550129', minutesAgo: 300, secs: 95, status: 'answered', summary: 'Keisha Monroe, independent agency, two staff. Missed calls during lunch are costing her renewals. Liked that every call becomes a lead with a note. Follow up Monday at 10.' },
  { from: '+17065550155', minutesAgo: 1440, secs: 141, status: 'answered', summary: 'Tom Albrecht referred by a JAVA Agency client. Wants a turnkey site with quote request forms and reviews. Ready to start; send the Launch program link.' },
];
const NOTES = [
  { kind: 'action_item', chapter: 'calls', text: 'Call Dana Whitfield back before Thursday: she asked for a morning demo of the Genovus line and follow-ups.' },
  { kind: 'idea', chapter: 'growth', text: 'Three callers this week mentioned missed after-hours calls. Lead with the Genovus line in next week’s outreach.' },
  { kind: 'question', chapter: 'ask-helix', text: 'Do we offer a Spanish-language site option for agencies in Gainesville? · missing: no language options in the program catalog yet' },
];

// The demo agency's own Helix notes (Brooks Family Insurance, fictional): what the office told Helix this week.
const AGENCY_NOTES = [
  { kind: 'action_item', status: 'new', source: 'helix', text: 'Call the Lake Oliver marina about a boat referral partnership before spring launch season.' },
  { kind: 'action_item', status: 'new', source: 'helix', text: 'Send the Garcias their renewal review before Friday; they emailed Tuesday with questions.' },
  { kind: 'idea', status: 'new', source: 'helix', text: 'Post an RV pre-trip checklist when the campgrounds open in March.' },
  { kind: 'action_item', status: 'new', source: 'person', text: 'Ask the Okafor Bakery about coverage for the new location.' },
  { kind: 'question', status: 'new', source: 'helix', chapter: 'ask-helix', text: 'Can our website take quote requests in Spanish? · missing: no language options in the program yet' },
  { kind: 'action_item', status: 'done', source: 'helix', text: 'Follow up with Maria Delgado about adding her teen driver.' },
];

export const UNEDIT_DEMO = 'a11b0000-0000-4000-8000-000000000001';
const UD = 'studio/vlogs/library-demo';
const UNEDIT_CLIPS = [
  { title: 'One take, a week of posts', caption: 'I never opened an editor.', secs: 11.5, from: 0, to: 11.5 },
  { title: 'Three hours to edit', caption: 'So most agencies never post.', secs: 8.4, from: 12, to: 20.4 },
  { title: 'Nothing posts until you approve', caption: 'People approve anything that goes out.', secs: 4.3, from: 140, to: 144.3 },
];

async function stageUnedit(db, tenantId, uid) {
  must(await db.from('unedit_vlogs').delete().eq('id', UNEDIT_DEMO), 'clear demo recording');
  const zero = '0'.repeat(64);
  must(await db.from('unedit_vlogs').insert({
    id: UNEDIT_DEMO, tenant_id: tenantId, title: 'How Unedit works', file_name: 'how-unedit-works.mp4',
    blob_path: `${UD}/source.mp4`, blob_url: `${UD}/source.mp4`, bytes: 186_400_000, fingerprint: `186400000:${zero}:${'1'.repeat(64)}`,
    duration_s: 182.4, width: 1080, height: 1920, rotation: 0, vcodec: 'h264', stage: 'review', provider: 'deepgram', words: 468,
    episode: { title: 'How Unedit works: one take in, a week of posts out', description: 'One take on a phone becomes captioned clips, a full episode and three thumbnails on one card. Nothing posts until you approve.', tags: ['genovus', 'unedit', 'build log'] },
    thumbs: [['ONE TAKE', 'dark'], ['NO EDITOR', 'orange'], ['YOU APPROVE', 'light']].map(([text, look], i) => ({ blob: `${UD}/thumbs/${i + 1}-${look}.jpg`, text, t: [0.6, 1.4, 10.2][i], look })),
    thumb_pick: 0, cost_cents: 41, created_by: uid,
  }), 'demo recording');
  must(await db.from('unedit_clips').insert(UNEDIT_CLIPS.map((c, i) => ({
    tenant_id: tenantId, vlog_id: UNEDIT_DEMO, n: i + 1, start_s: c.from, end_s: c.to, title: c.title, caption: c.caption,
    copy: { instagram: c.caption, facebook: c.caption, youtube: c.title }, features: { hook: 'claim', topic: 'unedit', pro: true, shots: [] },
    blob_path: `${UD}/clips/${i + 1}.mp4`, secs: c.secs, status: i === 0 ? 'approved' : 'ready',
  }))), 'demo clips');
}

export async function stageLibrary(origin = 'http://localhost:3911') {
  if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: the Screen Library is staged on the preview database only');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // The demo agency (follow-ups, approvals, care) and its filming owner.
  const agencyLink = await stageAgency(origin);

  // The fictional Genovus team member who is signed in on the Enterprise screens.
  let uid = (await db.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === FILMING_STAFF.email)?.id;
  if (!uid) uid = must(await db.auth.admin.createUser({ email: FILMING_STAFF.email, email_confirm: true, user_metadata: { name: FILMING_STAFF.name } }), 'staff user').user.id;
  must(await db.from('staff').upsert({ user_id: uid, role: FILMING_STAFF.role, display_name: FILMING_STAFF.name }, { onConflict: 'user_id' }), 'staff');
  const staffLink = must(await db.auth.admin.generateLink({ type: 'magiclink', email: FILMING_STAFF.email }), 'staff link').properties.hashed_token;

  // The Genovus line: a demo number on the house account, fictional calls with Helix's notes, and Helix notes.
  const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
  let num = (await db.from('tracking_numbers').select('id').eq('tenant_id', house.id).is('released_at', null).limit(1).maybeSingle()).data;
  if (!num) num = must(await db.from('tracking_numbers').insert({ tenant_id: house.id, e164: '+17065550188', twilio_sid: 'PNdemolibrary0000000000000000000', label: 'Genovus line', source: 'website', forward_to: '+17065550100', record: true }).select('id').single(), 'number');
  must(await db.from('calls').delete().eq('tenant_id', house.id).like('call_sid', 'CAdemo%'), 'clear demo calls');
  const now = Date.now();
  must(await db.from('calls').insert(CALLS.map((c, i) => ({ tenant_id: house.id, number_id: num.id, call_sid: `CAdemo${String(i).padStart(28, '0')}`, from_e164: c.from, started_at: new Date(now - c.minutesAgo * 60_000).toISOString(), duration_s: c.secs, status: c.status, summary: c.summary }))), 'demo calls');
  must(await db.from('helix_notes').delete().contains('work', { demo: true }), 'clear demo notes');
  must(await db.from('helix_notes').insert(NOTES.map((n) => ({ ...n, source: 'helix', status: 'new', work: { demo: true } }))), 'demo notes');
  const brooks = must(await db.from('tenants').select('id').eq('slug', 'demo-brooks').single(), 'demo agency');
  // Leads, calls, partners, market costs, results and follow-ups, so no screen shows an empty office.
  const growth = await stageGrowth(db, brooks.id);
  console.log(`staged growth: ${growth.leads} leads, ${growth.calls} calls, ${growth.partners} partners`);
  const hour = 3_600_000;
  must(await db.from('helix_notes').insert(AGENCY_NOTES.map((n, i) => ({ chapter: 'agency', ...n, tenant_id: brooks.id, work: { demo: true }, created_at: new Date(now - (i + 1) * 5 * hour).toISOString(), updated_at: new Date(now - (i + 1) * 4 * hour).toISOString() }))), 'demo agency notes');

  // The Enterprise screens: inquiries, sample care plans, what Helix knows, the prospect call list.
  const ent = await stageEnterprise(db);
  console.log(`staged enterprise: ${ent.inquiries} inquiries, ${ent.care} sample care plans, ${ent.memory} Helix memories, ${ent.prospects} prospects`);

  // Unedit: one sample recording in review (three Unedit Pro clips, three thumbnails), media from
  // scripts/stage-unedit-media.mts under studio/vlogs/library-demo. Verify runs' recordings stay off camera.
  must(await db.from('unedit_vlogs').delete().ilike('file_name', 'verify-%'), 'clear verify recordings');
  await stageUnedit(db, house.id, uid);

  // Preview test leftovers never belong on camera: a stand-in morning brief, and a note's "no AI provider" error.
  const { data: briefs } = await db.from('helix_briefs').select('tenant_id, day, body').eq('tenant_id', house.id);
  for (const b of briefs ?? []) if (/verify|stand-?in|test/i.test(JSON.stringify(b.body))) await db.from('helix_briefs').delete().eq('tenant_id', b.tenant_id).eq('day', b.day);
  await db.from('helix_notes').update({ status: 'new', work: null }).eq('status', 'failed');

  return { agencyLink, staffToken: staffLink };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await stageLibrary(process.argv[2]);
  console.log('Staged: Brooks Family Insurance (with 6 Helix notes), Tasha (Genovus), 5 Genovus-line calls, 3 Helix notes.', r.agencyLink ? 'Links ready.' : '');
  process.exit(0);
}
