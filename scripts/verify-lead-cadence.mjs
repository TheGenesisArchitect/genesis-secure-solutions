// Verify Lead Engine P1, slice 4 (migration 0097) on the PREVIEW database. The steps' own due times are the clock;
// outcomes are recorded as the agency's owner, signed in the way a browser is:
//  1. a new lead with an email gets 5 steps (email now, call +2h, email +24h, calls +26h and +47h), each at the next
//     open office time; one with no email gets the 3 calls; a texting step can't exist
//  2. a step that comes due becomes a priority task on Today for that lead; nothing is queued to the lead
//  3. marking it contacted stops the rest and closes the open step tasks
//  4. a step the person's consent no longer covers is skipped
//  5. Quoted, Bound (premium, lines) and Lost (reason, renewal date) are recorded; the renewal date puts call tasks
//     45, 30 and 15 days before it; an unknown reason or a far-off date is refused
//   node --env-file=.env.local scripts/verify-lead-cadence.mjs
import { randomUUID } from 'node:crypto';
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
if (!owner) throw new Error(`${SLUG} has no owner`);
const email = must(await db.auth.admin.getUserById(owner.user_id), 'owner user').user.email;
const link = must(await db.auth.admin.generateLink({ type: 'magiclink', email }), 'link');
const me = createClient(URL_, ANON, { auth: { persistSession: false } });
must(await me.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' }), 'sign in');

const clean = async () => {
  const ids = (must(await db.from('leads').select('id').eq('tenant_id', t.id).like('name', 'C4 %'), 'find')).map((l) => l.id);
  if (ids.length) {
    await db.from('outbox').delete().eq('tenant_id', t.id).in('template', ['lead_new', 'lead_push', 'lead_waiting']);
    must(await db.from('leads').delete().in('id', ids), 'clear');
  }
};
const site = (name, phone, mail) => db.rpc('site_lead', { p_tenant: t.id, p_ext_id: `site:${randomUUID()}`, p_name: name, p_email: mail ?? null, p_phone: phone, p_topic: 'Auto',
  p_message: null, p_source: 'website', p_medium: 'callback', p_campaign: null, p_attribution: {}, p_consent: `I agree that ${t.name} may contact me about this request.` });
const steps = async (id) => must(await db.from('lead_cadence').select('*').eq('lead_id', id).order('step'), 'steps');
const openAt = async (iso) => new Date(must(await db.rpc('office_open_at', { p_tenant: t.id, p_at: iso }), 'open_at')).getTime();
const due = async (id, step) => must(await db.from('lead_cadence').update({ due_at: new Date(Date.now() - 60_000).toISOString() }).eq('lead_id', id).eq('step', step), 'due');

await clean();
try {
  // 1. the steps
  const a = must(await site('C4 Steps', '7065550341', 'c4.steps@gmail.com'), 'a');
  const la = must(await db.from('leads').select('created_at').eq('id', a.id).single(), 'la');
  const sa = await steps(a.id);
  const offsets = { 1: 0, 2: 2, 3: 24, 4: 26, 5: 47 };
  const want = await Promise.all(sa.map((s) => openAt(new Date(new Date(la.created_at).getTime() + offsets[s.step] * 3_600_000).toISOString())));
  check(sa.map((s) => `${s.step}${s.kind}`).join() === '1email,2call,3email,4call,5call' && sa.every((s, i) => new Date(s.due_at).getTime() === want[i]),
    `a lead with an email gets 5 steps at the next open office times (${sa.map((s) => `${s.step}:${s.kind}`).join(' ')})`);
  const b = must(await site('C4 Nomail', '7065550342'), 'b');
  check((await steps(b.id)).map((s) => s.kind).join() === 'call,call,call', 'one with no email gets the 3 calls');
  const sms = await db.from('lead_cadence').insert({ tenant_id: t.id, lead_id: a.id, step: 9, kind: 'sms', due_at: new Date().toISOString() });
  check(!!sms.error, 'a texting step can’t exist');

  // 2. a due step becomes a task
  const outBefore = must(await db.from('outbox').select('id').eq('tenant_id', t.id).eq('to_email', 'c4.steps@gmail.com'), 'out').length;
  await due(a.id, 2);
  const ran = must(await db.rpc('run_lead_cadence'), 'run');
  const s2 = (await steps(a.id)).find((s) => s.step === 2);
  const task = s2?.follow_up_id ? must(await db.from('follow_ups').select('*').eq('id', s2.follow_up_id).single(), 'task') : null;
  check(ran >= 1 && s2.status === 'done' && task?.priority === true && task.lead_id === a.id && /Call C4 Steps again: no contact yet \(2nd try\)/.test(task.reason), `the 2-hour step is a priority task on Today ("${task?.reason}")`);
  check(must(await db.from('outbox').select('id').eq('tenant_id', t.id).eq('to_email', 'c4.steps@gmail.com'), 'out').length === outBefore, 'and nothing is queued to the lead');

  // 3. contact stops the rest (whatever was still pending: the email step may already be done in office hours)
  const pending = (await steps(a.id)).filter((s) => s.status === 'pending').map((s) => s.step);
  must(await me.rpc('update_lead', { p_id: a.id, p_status: 'contacted', p_note: null }), 'contacted');
  const after = await steps(a.id);
  const task2 = must(await db.from('follow_ups').select('status').eq('id', s2.follow_up_id).single(), 'task2');
  const tasksOpen = must(await db.from('follow_ups').select('id').eq('lead_id', a.id).eq('status', 'open'), 'open tasks');
  check(pending.length >= 3 && after.filter((s) => s.status === 'pending').length === 0 && after.filter((s) => s.status === 'stopped').map((s) => s.step).join() === pending.join() && task2.status === 'done' && tasksOpen.length === 0,
    `contact stops the rest (steps ${pending.join(', ')}) and closes every step task`);

  // 4. consent
  const [cb] = must(await db.from('lead_consents').select('id').eq('lead_id', b.id), 'consent b');
  must(await db.from('lead_consents').update({ revoked_at: new Date().toISOString(), revoked_via: 'stop' }).eq('id', cb.id), 'revoke');
  await due(b.id, 2);
  await db.rpc('run_lead_cadence');
  const sb = (await steps(b.id)).find((s) => s.step === 2);
  check(sb.status === 'skipped' && !sb.follow_up_id, `a step their consent no longer covers is skipped (${sb.note})`);

  // 5. outcomes
  const c = must(await site('C4 Outcome', '7065550343'), 'c');
  must(await me.rpc('update_lead', { p_id: c.id, p_status: 'quoted', p_note: null }), 'quoted');
  const q = must(await db.from('leads').select('status, quoted_at').eq('id', c.id).single(), 'q');
  check(q.status === 'quoted' && !!q.quoted_at, 'Quoted is a status, with when');
  const x = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const tasks = must(await me.rpc('record_outcome', { p_id: c.id, p_status: 'lost', p: { lost_reason: 'price', x_date: x } }), 'lost');
  const lc = must(await db.from('leads').select('status, lost_reason, x_date').eq('id', c.id).single(), 'lc');
  const ren = must(await db.from('follow_ups').select('due_on, reason').eq('lead_id', c.id).like('reason', 'Renews %').order('due_on'), 'renewals');
  const back = (n) => { const d = new Date(`${x}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
  check(lc.status === 'lost' && lc.lost_reason === 'price' && lc.x_date === x && tasks === 3 && ren.map((r) => r.due_on).join() === [back(45), back(30), back(15)].join(),
    `Lost with a reason and a renewal date: 3 call tasks 45/30/15 days before (${ren.map((r) => r.due_on).join(', ')})`);
  const d = must(await site('C4 Bound', '7065550344'), 'd');
  must(await me.rpc('record_outcome', { p_id: d.id, p_status: 'won', p: { premium_cents: 145000, lines: ['auto', 'home', 'spaceship'] } }), 'bound');
  const ld = must(await db.from('leads').select('status, bound_at, premium_cents, lines_bound').eq('id', d.id).single(), 'ld');
  check(ld.status === 'won' && !!ld.bound_at && ld.premium_cents === 145000 && ld.lines_bound.sort().join() === 'auto,home', 'Bound records premium and only real lines');
  const badReason = await me.rpc('record_outcome', { p_id: d.id, p_status: 'lost', p: { lost_reason: 'astrology' } });
  const farDate = await me.rpc('record_outcome', { p_id: d.id, p_status: 'lost', p: { lost_reason: 'price', x_date: '2031-01-01' } });
  check(!!badReason.error && !!farDate.error, 'an unknown reason or a far-off renewal date is refused');
} finally {
  await clean();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
