// Verify UnEdit on an agency desk waits for the owner (migration 0112 + lib/unedit.ts), preview DB only, no Metricool
// calls: a JAVA recording registers on JAVA's desk; the copy check blocks an Approve with a price claim; without his
// Metricool brand nothing can be approved; with it, Approve creates ZERO queued posts (all awaiting the owner) and one
// approval in his Approvals; nothing is due for the cron; only the owner's own decide_approval (run as him, through
// row-level security) puts them on the calendar; changes requested take them off and reopen review; the full video
// can't be posted around him; the house desk is untouched. Cleans up.
// Run: npx tsx --conditions=react-server --env-file=.env.local scripts/verify-agency-unedit.mts
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
process.env.METRICOOL_API_BASE = 'http://127.0.0.1:9/never'; // nothing here may reach Metricool
const { tap, blogFor, sweepDuePosts, distribute, registerVlog } = await import('../lib/unedit');
const { deskFor } = await import('../lib/desk');

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (name: string, ok: unknown, info?: unknown) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`, JSON.stringify(info ?? '').slice(0, 500)); } };
const java = await deskFor('mendez-hollis'), house = await deskFor();
const admin = (await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single()).data!.user_id as string;
const tag = randomBytes(3).toString('hex');
const vlogs: string[] = [];
const blogBefore = (await db.from('tenants').select('metricool_blog_id').eq('id', java.id).single()).data!.metricool_blog_id;
let member = false;
const sql = postgres((process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL)!, { ssl: 'require', max: 1, onnotice: () => {} });
/** decide_approval run as a signed-in person (row-level security and is_owner see them). */
const decideAs = async (uid: string, id: string, decision: string, note?: string) => {
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: 'authenticated' })}, true), set_config('request.jwt.claim.sub', ${uid}, true)`;
      await tx`set local role authenticated`;
      await tx`select decide_approval(${id}::uuid, ${decision}, ${note ?? null})`;
    });
    return 'ok';
  } catch (e) { return e instanceof Error ? e.message : String(e); }
};
const seed = async (copyIg: string) => {
  const id = randomUUID();
  await db.from('unedit_vlogs').insert({ id, tenant_id: java.id, title: `JAVA storm tips zq${tag}`, file_name: 'v.mp4', blob_path: `studio/vlogs/uploads/verify-au-${id}.mp4`, blob_url: 'https://example.invalid/v.mp4', bytes: 1000,
    fingerprint: `1000:${randomBytes(32).toString('hex')}:${randomBytes(32).toString('hex')}`, stage: 'review', episode: { title: `Storm tips zq${tag}`, description: 'Three things to do before the storm.' } });
  vlogs.push(id);
  await db.from('unedit_clips').insert([1, 2].map((n) => ({ tenant_id: java.id, vlog_id: id, n, start_s: n * 20, end_s: n * 20 + 18, title: `Before the storm ${n}`, caption: 'Park away from trees tonight.', copy: { instagram: n === 1 ? copyIg : 'Take photos of your car tonight.', facebook: 'Park away from trees tonight.', youtube: 'Storm tips' }, blob_path: `studio/vlogs/${id}/clip-${n}.mp4`, secs: 18, status: 'ready' })));
  return id;
};
const posts = async (v: string) => (await db.from('unedit_posts').select('status, scheduled_at').eq('vlog_id', v)).data ?? [];
const err = async (f: () => Promise<unknown>) => { try { await f(); return ''; } catch (e) { return e instanceof Error ? e.message : String(e); } };

try {
  console.log('registration and brands');
  const reg = await registerVlog({ blobPath: `studio/vlogs/uploads/verify-reg-${tag}.mp4`, blobUrl: 'https://example.invalid/r.mp4', bytes: 1234, fingerprint: `1234:${randomBytes(32).toString('hex')}:${randomBytes(32).toString('hex')}`, fileName: `reg ${tag}.mp4`, by: admin, desk: 'mendez-hollis' });
  vlogs.push(reg.id);
  check('an upload from JAVA’s desk is JAVA’s recording', (await db.from('unedit_vlogs').select('tenant_id').eq('id', reg.id).single()).data!.tenant_id === java.id);
  check('the house desk posts from the Genovus brand', (await blogFor(house.id)) === (process.env.METRICOOL_GENOVUS_BLOG_ID || '7426930'));
  await db.from('tenants').update({ metricool_blog_id: null }).eq('id', java.id);
  check('an agency with no brand can never fall back to Genovus’s', /no Metricool brand/.test(await err(() => blogFor(java.id))));

  console.log('the Approve on his desk');
  const bad = await seed('Switch today and save up to 20%!');
  const e1 = await err(() => tap(bad, { tool: 'approve', mode: 'plan', rhythm: 'drip' }, admin, 'http://localhost:1'));
  check('a price claim in the copy blocks the Approve', /Fix the copy first/.test(e1) && /save/.test(e1) && (await posts(bad)).length === 0, e1);
  const v = await seed('Storm tonight: park away from trees and take photos of your car.');
  const e2 = await err(() => tap(v, { tool: 'approve', mode: 'plan', rhythm: 'drip' }, admin, 'http://localhost:1'));
  check('without his Metricool brand nothing is approved', /no Metricool brand/.test(e2) && (await posts(v)).length === 0, e2);
  await db.from('tenants').update({ metricool_blog_id: '9999999' }).eq('id', java.id);
  const say = await tap(v, { tool: 'approve', mode: 'now' }, admin, 'http://localhost:1');
  const p1 = await posts(v);
  check('Approve sends it to Mendez, even “post now”', /Sent to Mendez for approval/.test(say) && /Nothing goes out until he approves/.test(say), say);
  check('ZERO posts are queued: all wait for the owner', p1.length === 4 && p1.every((p) => p.status === 'awaiting_owner'), p1);
  check('only his connected networks (Instagram, Facebook): no YouTube', (await db.from('unedit_posts').select('platform').eq('vlog_id', v)).data!.every((p) => p.platform !== 'youtube'));
  const ap = (await db.from('approvals').select('id, status, approver, lane, body').eq('unedit_vlog_id', v).single()).data!;
  check('one approval in his Approvals, for the owner, with clips and times', ap.status === 'pending' && ap.approver === 'client' && ap.body.kind === 'unedit' && ap.body.clips.length === 2 && ap.body.posts.length === 4, ap);
  await sweepDuePosts();
  const d = await distribute((await db.from('unedit_vlogs').select('*').eq('id', v).single()).data as never);
  check('nothing is due for the cron and nothing is sent', d.sent === 0 && (await posts(v)).every((p) => p.status === 'awaiting_owner'), d);
  check('the full video can’t be posted around him', /after the owner approves/.test(await err(() => tap(v, { tool: 'post_longform' }, admin, 'http://localhost:1'))));

  console.log('only the owner decides');
  check('staff cannot approve it for him', /only the agency owner/.test(await decideAs(admin, ap.id, 'approved')) && (await posts(v)).every((p) => p.status === 'awaiting_owner'));
  await db.from('memberships').insert({ tenant_id: java.id, user_id: admin, role: 'owner' }); member = true;
  check('asking for changes needs a note', /say what should change/.test(await decideAs(admin, ap.id, 'changes_requested', '')));
  check('the owner approves', (await decideAs(admin, ap.id, 'approved')) === 'ok');
  const p2 = await posts(v);
  check('his yes puts every post on the calendar, at least 20 minutes out', p2.every((p) => p.status === 'queued' && Date.parse(p.scheduled_at!) >= Date.now() + 19 * 60_000), p2);

  console.log('changes requested');
  const v2 = await seed('Storm tonight: park away from trees.');
  await tap(v2, { tool: 'approve', mode: 'plan', rhythm: 'steady' }, admin, 'http://localhost:1');
  const ap2 = (await db.from('approvals').select('id').eq('unedit_vlog_id', v2).single()).data!;
  check('the owner asks for changes', (await decideAs(admin, ap2.id, 'changes_requested', 'Use the other thumbnail')) === 'ok');
  const st = (await db.from('unedit_vlogs').select('stage').eq('id', v2).single()).data!.stage;
  check('nothing posts and the recording is back in review', (await posts(v2)).every((p) => p.status === 'cancelled') && st === 'review', [st, await posts(v2)]);
} finally {
  if (member) await db.from('memberships').delete().eq('tenant_id', java.id).eq('user_id', admin).eq('role', 'owner');
  await db.from('tenants').update({ metricool_blog_id: blogBefore }).eq('id', java.id);
  for (const v of vlogs) { await db.from('approvals').delete().eq('unedit_vlog_id', v); await db.from('unedit_posts').delete().eq('vlog_id', v); await db.from('unedit_clips').delete().eq('vlog_id', v); await db.from('unedit_vlogs').delete().eq('id', v); }
  await sql.end();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
