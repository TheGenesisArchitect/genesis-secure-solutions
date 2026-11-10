// Verify Upgrade Notes and the Search Console tables (migration 0100) on the PREVIEW database, as the "test-launch"
// agency's owner signed in the way a browser is:
//  1. a draft is invisible to the agency; once sent it shows, with its five parts
//  2. opening it marks it read for that person only (once)
//  3. answering a step: done and later are recorded; help also opens one care request for the team (not twice)
//  4. a step that isn't on the note, or an answer that isn't done/help/later, is refused
//  5. a member can't write notes, reads or steps directly, or see another agency's notes
//  6. search_daily / search_pages / visibility_pulls('search_console') accept the server's rows and the member reads them;
//     a malformed Search Console property is refused
//   node --env-file=.env.local scripts/verify-upgrade-notes.mjs
import { createClient } from '@supabase/supabase-js';

const SLUG = 'test-launch';
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(URL_, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const t = must(await db.from('tenants').select('id, name, is_sample').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t || t.is_sample) throw new Error(`${SLUG} is missing or a sample: run verify-agency-dashboard.mjs first`);
const [owner] = must(await db.from('memberships').select('user_id').eq('tenant_id', t.id).eq('role', 'owner').limit(1), 'owner');
const email = must(await db.auth.admin.getUserById(owner.user_id), 'owner user').user.email;
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const me = createClient(URL_, ANON, { auth: { persistSession: false } });
must(await me.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }), 'sign in');
const other = must(await db.from('tenants').select('id').eq('kind', 'agency').neq('id', t.id).limit(1).maybeSingle(), 'other tenant');

const TITLE = 'VUN verify note';
const clean = async () => {
  await db.from('care_requests').delete().eq('tenant_id', t.id).like('title', 'Help with: VUN%');
  await db.from('upgrade_notes').delete().like('title', 'VUN %');
  await db.from('search_daily').delete().eq('tenant_id', t.id);
  await db.from('search_pages').delete().eq('tenant_id', t.id);
  await db.from('visibility_pulls').delete().eq('tenant_id', t.id).eq('source', 'search_console');
  await db.from('tenants').update({ search_console_site: null }).eq('id', t.id);
};
await clean();

try {
  const steps = [{ key: 'vun-hours-1', text: 'VUN check your Google listing hours' }, { key: 'vun-reviews-2', text: 'VUN ask three customers for a review' }];
  const note = must(await db.from('upgrade_notes').insert({ tenant_id: t.id, title: TITLE, summary: 'Google can now see all your lines.', did: ['Auto and Home pages are live'], background: ['Google reads your hours'], expect: [{ when: 'Up to 2 weeks', what: 'Pages appear in Google' }], steps, scales: 'Adding a line is one step.', check_back_on: '2026-11-24' }).select('id').single(), 'insert note');

  // 1. drafts are staff only
  let seen = must(await me.from('upgrade_notes').select('id').eq('id', note.id), 'member read draft');
  check(seen.length === 0, 'a draft is invisible to the agency');
  must(await db.from('upgrade_notes').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', note.id), 'send');
  seen = must(await me.from('upgrade_notes').select('id, did, background, expect, steps, scales').eq('id', note.id), 'member read sent');
  check(seen.length === 1 && seen[0].did.length === 1 && seen[0].expect[0].when === 'Up to 2 weeks' && seen[0].steps.length === 2, 'once sent, the agency sees it with its five parts');

  // 2. read marks
  must(await me.rpc('read_upgrade_note', { p_note: note.id }), 'read');
  must(await me.rpc('read_upgrade_note', { p_note: note.id }), 'read again');
  const reads = must(await db.from('upgrade_note_reads').select('user_id').eq('note_id', note.id), 'reads');
  check(reads.length === 1 && reads[0].user_id === owner.user_id, 'opening it marks it read for that person, once');

  // 3. answers
  must(await me.rpc('answer_upgrade_step', { p_note: note.id, p_step: 'vun-hours-1', p_status: 'done' }), 'done');
  must(await me.rpc('answer_upgrade_step', { p_note: note.id, p_step: 'vun-reviews-2', p_status: 'help' }), 'help');
  must(await me.rpc('answer_upgrade_step', { p_note: note.id, p_step: 'vun-reviews-2', p_status: 'help' }), 'help again');
  const ans = must(await me.from('upgrade_note_steps').select('step_key, status').eq('note_id', note.id).order('step_key'), 'answers');
  check(ans.length === 2 && ans[0].status === 'done' && ans[1].status === 'help', 'done and help are recorded');
  const care = must(await db.from('care_requests').select('id, kind').eq('tenant_id', t.id).like('title', 'Help with: VUN%'), 'care');
  check(care.length === 1 && care[0].kind === 'support', 'help opens one care request for the team (not twice)');
  must(await me.rpc('answer_upgrade_step', { p_note: note.id, p_step: 'vun-reviews-2', p_status: 'later' }), 'later');
  check(must(await db.from('upgrade_note_steps').select('status').eq('note_id', note.id).eq('step_key', 'vun-reviews-2').single(), 'later row').status === 'later', 'later is recorded');

  // 4. refusals
  check(Boolean((await me.rpc('answer_upgrade_step', { p_note: note.id, p_step: 'not-a-step', p_status: 'done' })).error), 'a step that isn’t on the note is refused');
  check(Boolean((await me.rpc('answer_upgrade_step', { p_note: note.id, p_step: 'vun-hours-1', p_status: 'ignored' })).error), 'an unknown answer is refused');

  // 5. no direct writes, no other agency
  const w1 = await me.from('upgrade_notes').insert({ tenant_id: t.id, title: 'VUN forged', status: 'sent' }).select('id');
  check(Boolean(w1.error) || !(w1.data ?? []).length, 'a member can’t write a note');
  const w2 = await me.from('upgrade_notes').update({ title: 'VUN changed' }).eq('id', note.id).select('id');
  check(Boolean(w2.error) || !(w2.data ?? []).length, 'a member can’t change a note');
  const w3 = await me.from('upgrade_note_steps').upsert({ note_id: note.id, step_key: 'vun-hours-1', tenant_id: t.id, status: 'help' }).select('note_id');
  check(Boolean(w3.error) || !(w3.data ?? []).length, 'a member can’t write step answers directly');
  if (other) {
    const foreign = must(await db.from('upgrade_notes').insert({ tenant_id: other.id, title: 'VUN other agency', status: 'sent', sent_at: new Date().toISOString() }).select('id').single(), 'foreign');
    check(must(await me.from('upgrade_notes').select('id').eq('id', foreign.id), 'foreign read').length === 0, 'another agency’s note is invisible');
    check(Boolean((await me.rpc('answer_upgrade_step', { p_note: foreign.id, p_step: 'x', p_status: 'done' })).error), 'another agency’s steps can’t be answered');
  }

  // 6. Search Console tables
  must(await db.from('search_daily').upsert([{ tenant_id: t.id, day: '2026-11-01', clicks: 3, impressions: 120, position: 14.2 }, { tenant_id: t.id, day: '2026-11-02', clicks: 1, impressions: 80 }]), 'search_daily');
  must(await db.from('search_pages').upsert({ tenant_id: t.id, url: 'https://example.com/boat', indexed: true, verdict: 'PASS', coverage: 'Submitted and indexed' }), 'search_pages');
  must(await db.from('visibility_pulls').upsert({ tenant_id: t.id, source: 'search_console', ok: true, detail: { top: [{ query: 'boat insurance columbus ga', clicks: 1, impressions: 40, position: 9 }] } }, { onConflict: 'tenant_id,source' }), 'pull');
  const sd = must(await me.from('search_daily').select('impressions').eq('tenant_id', t.id), 'member search_daily');
  const sp = must(await me.from('search_pages').select('indexed').eq('tenant_id', t.id), 'member search_pages');
  check(sd.reduce((a, r) => a + r.impressions, 0) === 200 && sp.length === 1, 'the agency reads its own Google numbers');
  check(Boolean((await db.from('tenants').update({ search_console_site: 'javaagencyllc.com' }).eq('id', t.id)).error), 'a malformed Search Console property is refused');
  check(!(await db.from('tenants').update({ search_console_site: 'sc-domain:javaagencyllc.com' }).eq('id', t.id)).error, 'sc-domain:… is accepted');
  check(!(await db.from('tenants').update({ search_console_site: 'https://javaagencyllc.com/' }).eq('id', t.id)).error, 'https://…/ is accepted');
} finally {
  await clean();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nAll upgrade-note checks passed');
process.exit(failed ? 1 : 0);
