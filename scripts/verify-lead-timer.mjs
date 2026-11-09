// Verify Lead Engine P1, slice 3 (migration 0096) on the PREVIEW database, with the timer's own times as the clock:
//  1. office hours in the agency's time zone (a Central-time office): open now, after hours, the weekend
//  2. a new lead gets an owner and a timer that starts when the office is open
//  3. not contacted at 5 minutes: "still waiting" to the team and a push; at 15: the owners, and it's red (level 2)
//  4. marking it contacted closes the timer
//  5. an answered call starts no timer; a missed call does, with its call-back due in the agency's own time zone
//   node --env-file=.env.local scripts/verify-lead-timer.mjs
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SLUG = 'test-launch', NUM = '+17065550329';
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const t = must(await db.from('tenants').select('id, name, is_sample').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t || t.is_sample) throw new Error(`${SLUG} is missing or a sample: run verify-agency-dashboard.mjs first`);
const owners = must(await db.from('memberships').select('user_id').eq('tenant_id', t.id).eq('role', 'owner'), 'owners');
if (!owners.length) throw new Error(`${SLUG} has no owner: run verify-agency-dashboard.mjs first`);
const before = must(await db.from('agency_profiles').select('*').eq('tenant_id', t.id).maybeSingle(), 'profile');
const clean = async () => {
  const ids = (must(await db.from('leads').select('id').eq('tenant_id', t.id).or('name.like.T3 %,phone.like.+1706555032%'), 'find')).map((l) => l.id);
  if (ids.length) {
    await db.from('outbox').delete().eq('tenant_id', t.id).in('template', ['lead_new', 'lead_push', 'lead_waiting']);
    await db.from('calls').delete().in('lead_id', ids);
    must(await db.from('leads').delete().in('id', ids), 'clear');
  }
  await db.from('calls').delete().eq('tenant_id', t.id).like('call_sid', 'CAt3verify%');
  await db.from('tracking_numbers').delete().eq('e164', NUM);
  await db.from('follow_ups').delete().eq('tenant_id', t.id).like('reason', '%T3 line%');
};
await clean();
const hours = { mon: ['09:00', '18:00'], tue: ['09:00', '18:00'], wed: ['09:00', '18:00'], thu: ['09:00', '18:00'], fri: ['09:00', '18:00'], sat: null, sun: null };
must(await db.from('agency_profiles').upsert({ tenant_id: t.id, timezone: 'America/Chicago', office_hours: hours, lines: before?.lines ?? ['auto'], licensed_states: before?.licensed_states ?? ['GA', 'AL'] }, { onConflict: 'tenant_id' }), 'profile');
const openAt = async (iso) => new Date(must(await db.rpc('office_open_at', { p_tenant: t.id, p_at: iso }), 'open_at')).toISOString();

try {
  // 1. Central time. Wed 2026-11-11 10:00 CST = 16:00Z (open); Wed 20:00 CST = Thu 02:00Z -> Thu 09:00 CST = 15:00Z;
  //    Sat 2026-11-14 11:00 CST = 17:00Z -> Mon 2026-11-16 09:00 CST = 15:00Z; Wed 07:30 CST = 13:30Z -> 09:00 CST = 15:00Z.
  check(await openAt('2026-11-11T16:00:00Z') === '2026-11-11T16:00:00.000Z', 'Wednesday 10 AM Central: open, the timer starts now');
  check(await openAt('2026-11-12T02:00:00Z') === '2026-11-12T15:00:00.000Z', 'Wednesday 8 PM Central: starts Thursday 9 AM Central');
  check(await openAt('2026-11-14T17:00:00Z') === '2026-11-16T15:00:00.000Z', 'Saturday: starts Monday 9 AM Central');
  check(await openAt('2026-11-11T13:30:00Z') === '2026-11-11T15:00:00.000Z', 'Wednesday 7:30 AM Central: starts at 9 AM Central, not Eastern');

  // 2. owner and timer
  const r = must(await db.rpc('site_lead', { p_tenant: t.id, p_ext_id: `site:${randomUUID()}`, p_name: 'T3 Waiting', p_email: null, p_phone: '7065550321', p_topic: 'Auto',
    p_message: null, p_source: 'website', p_medium: 'callback', p_campaign: null, p_attribution: {}, p_consent: `I agree that ${t.name} may contact me about this request.` }), 'lead');
  const lead = must(await db.from('leads').select('id, owner_id, created_at').eq('id', r.id).single(), 'lead row');
  const timer = must(await db.from('lead_timers').select('*').eq('lead_id', r.id).maybeSingle(), 'timer');
  const start = await openAt(lead.created_at);
  check(owners.some((o) => o.user_id === lead.owner_id), 'the lead has an owner (an agency owner)');
  check(timer && new Date(timer.started_at).toISOString() === start && new Date(timer.due_at).getTime() === new Date(start).getTime() + 300_000 && timer.level === 0,
    `its timer starts when the office is open and is due 5 minutes later (${timer?.started_at} → ${timer?.due_at})`);

  // 3. escalation, with the clock moved by the timer's own times
  must(await db.from('lead_timers').update({ started_at: new Date(Date.now() - 6 * 60_000).toISOString(), due_at: new Date(Date.now() - 60_000).toISOString() }).eq('lead_id', r.id), 'age 6 min');
  const n1 = must(await db.rpc('run_lead_timers'), 'run 1');
  const t1 = must(await db.from('lead_timers').select('level, due_at, started_at').eq('lead_id', r.id).single(), 't1');
  const w1 = must(await db.from('outbox').select('to_email, data').eq('tenant_id', t.id).eq('template', 'lead_waiting').like('dedupe_key', `wait:${r.id}:1:%`), 'w1');
  check(n1 >= 1 && t1.level === 1 && w1.length >= 1 && w1.every((w) => w.data.waiting === '6' && w.data.level === '1'), `5 minutes, not reached: "still waiting" to the team (${w1.length} email, waiting ${w1[0]?.data?.waiting} min)`);
  check(new Date(t1.due_at).getTime() === new Date(t1.started_at).getTime() + 900_000, 'next step due at 15 minutes');
  must(await db.from('lead_timers').update({ started_at: new Date(Date.now() - 16 * 60_000).toISOString(), due_at: new Date(Date.now() - 60_000).toISOString() }).eq('lead_id', r.id), 'age 16 min');
  await db.rpc('run_lead_timers');
  const t2 = must(await db.from('lead_timers').select('level, done_at').eq('lead_id', r.id).single(), 't2');
  const w2 = must(await db.from('outbox').select('to_email, data').eq('tenant_id', t.id).eq('template', 'lead_waiting').like('dedupe_key', `wait:${r.id}:2:%`), 'w2');
  const evs = must(await db.from('lead_events').select('data').eq('lead_id', r.id).eq('kind', 'escalate'), 'escalations');
  check(t2.level === 2 && !t2.done_at && w2.length === owners.length && w2.every((w) => w.data.level === '2'), `15 minutes: the owners are emailed and it's red on Today (${w2.length} to owners)`);
  await db.rpc('run_lead_timers');
  check(evs.length === 2 && must(await db.from('outbox').select('id').eq('tenant_id', t.id).eq('template', 'lead_waiting').like('dedupe_key', `wait:${r.id}:%`), 'all').length === w1.length + w2.length, 'and nothing more after that');

  // 4. contact closes it
  must(await db.from('leads').update({ status: 'contacted', first_contact_at: new Date().toISOString() }).eq('id', r.id), 'contacted');
  check(!!must(await db.from('lead_timers').select('done_at').eq('lead_id', r.id).single(), 't4').done_at, 'marking it contacted closes the timer');

  // 5. calls
  must(await db.from('tracking_numbers').insert({ tenant_id: t.id, e164: NUM, twilio_sid: 'PNt3verify0000000000000000000000', label: 'T3 line', source: 'website', forward_to: '+17065550320', record: false }), 'number');
  const ans = must(await db.rpc('ingest_call', { p_to: NUM, p_sid: 'CAt3verify-ans', p_from: '+17065550322', p_status: 'answered', p_duration: 60, p_recording_sid: null, p_recording_s: null }), 'answered');
  check(!(await db.from('lead_timers').select('lead_id').eq('lead_id', ans.lead).maybeSingle()).data, 'an answered call starts no timer');
  const mis = must(await db.rpc('ingest_call', { p_to: NUM, p_sid: 'CAt3verify-mis', p_from: '+17065550323', p_status: 'missed', p_duration: 0, p_recording_sid: null, p_recording_s: null }), 'missed');
  check(!!(await db.from('lead_timers').select('lead_id').eq('lead_id', mis.lead).maybeSingle()).data, 'a missed call does');
  const fu = must(await db.from('follow_ups').select('due_on, due_at').eq('tenant_id', t.id).like('reason', '%T3 line%').maybeSingle(), 'follow-up');
  const ct = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (k) => ct.find((p) => p.type === k).value;
  check(fu?.due_on === `${part('year')}-${part('month')}-${part('day')}` && fu.due_at.slice(0, 2) === part('hour'), `its call-back is due in Central time (${fu?.due_on} ${fu?.due_at})`);
} finally {
  await clean();
  if (before) must(await db.from('agency_profiles').upsert(before, { onConflict: 'tenant_id' }), 'restore profile');
  else await db.from('agency_profiles').delete().eq('tenant_id', t.id);
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
