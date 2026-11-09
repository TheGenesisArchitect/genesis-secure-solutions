// Verify Lead Engine P1, slice 1 (migration 0094, docs/LEAD_ENGINE_SPEC.md §4.1–4.2) on the PREVIEW database:
//  1. a form lead writes one consent row: the exact text, its sha256 version, call+email, the connection's hash;
//     its contact carries the +1 phone
//  2. the row is append-only: changing the text or deleting it is refused; a revocation can be added once
//  3. asking again within 30 days joins the open lead (asks 2, one repeat event, a second consent row, one
//     "asked again" alert); a retried delivery (same ext id) changes nothing; a Gmail +tag is the same person
//  4. consent_allows: call and email yes, SMS and AI calls no; revoking one lead revokes the person's other leads
//  5. a call from a known number joins its lead; a new caller's lead has no marketing consent
//  6. leads.partner_id has its foreign key; deleting a lead takes its consent rows with it
//  7. every existing lead has its consent row (the backfill)
//   node --env-file=.env.local scripts/verify-lead-engine.mjs
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SLUG = 'test-launch';
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const t = must(await db.from('tenants').select('id, name, is_sample').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) throw new Error(`${SLUG} is missing: run verify-agency-dashboard.mjs first`);
const PH = '7065550301', PH2 = '7065550302', CALLER = '+17065550303', NUM = '+17065550309';
const clean = async () => {
  const ids = (must(await db.from('leads').select('id').eq('tenant_id', t.id).like('name', 'P1 %'), 'find')).map((l) => l.id);
  const callIds = (must(await db.from('leads').select('id').eq('tenant_id', t.id).eq('phone', CALLER), 'find calls')).map((l) => l.id);
  const all = [...ids, ...callIds];
  if (all.length) {
    await db.from('outbox').delete().eq('tenant_id', t.id).in('template', ['lead_new', 'lead_push']);
    await db.from('calls').delete().in('lead_id', all);
    must(await db.from('leads').delete().in('id', all), 'clear leads');
  }
  await db.from('calls').delete().eq('tenant_id', t.id).like('call_sid', 'CAp1verify%');
  await db.from('tracking_numbers').delete().eq('e164', NUM);
  await db.from('follow_ups').delete().eq('tenant_id', t.id).like('reason', '%P1 line%');
  await db.from('contacts').delete().eq('tenant_id', t.id).in('phone_e164', [`+1${PH}`, `+1${PH2}`, CALLER]);
  await db.from('contacts').delete().eq('tenant_id', t.id).eq('email_norm', 'p1.verify@gmail.com');
};
const site = (o) => db.rpc('site_lead', {
  p_tenant: t.id, p_ext_id: o.ext ?? `site:${randomUUID()}`, p_name: o.name, p_email: o.email ?? null, p_phone: o.phone ?? null, p_topic: o.topic ?? 'Auto',
  p_message: o.message ?? null, p_source: 'website', p_medium: 'callback', p_campaign: null, p_attribution: {}, p_consent: `I agree that ${t.name} may contact me about this request.`,
  p_meta: { seller: t.name, page_url: 'https://example.test/s/test-launch', ip_hash: 'ab'.repeat(16), user_agent: 'verify-lead-engine' },
});
const consents = async (lead) => must(await db.from('lead_consents').select('*').eq('lead_id', lead).order('received_at'), 'consents');
const allows = async (lead, ch) => must(await db.rpc('consent_allows', { p_lead: lead, p_channel: ch }), 'allows');

await clean();
try {
  // 1. one consent row with the exact text
  const first = must(await site({ name: 'P1 Repeat', phone: PH, email: 'P1.Verify+quote@gmail.com' }), 'site lead');
  const lead = first.id;
  const [c1] = await consents(lead);
  const text = `I agree that ${t.name} may contact me about this request.`;
  check(c1 && c1.text === text && c1.text_version === createHash('sha256').update(text).digest('hex') && c1.channels.join() === 'call,email' && c1.ip_hash === 'ab'.repeat(16) && c1.seller_name === t.name,
    `a form lead writes its consent: exact text, sha256 version, call+email, hashed connection (${c1?.channels})`);
  const l1 = must(await db.from('leads').select('contact_id, asks').eq('id', lead).single(), 'lead');
  const ct = must(await db.from('contacts').select('phone_e164, email_norm').eq('id', l1.contact_id).single(), 'contact');
  check(ct.phone_e164 === `+1${PH}` && ct.email_norm === 'p1.verify@gmail.com', `its contact: ${ct.phone_e164}, ${ct.email_norm} (Gmail +tag dropped)`);

  // 2. append-only
  const edit = await db.from('lead_consents').update({ text: 'I agree to anything at all, really.' }).eq('id', c1.id);
  check(!!edit.error && /append-only/.test(edit.error.message), `changing the text is refused (${edit.error?.message?.slice(0, 60)})`);
  const del = await db.from('lead_consents').delete().eq('id', c1.id);
  check(!!del.error && /kept/.test(del.error.message), 'deleting a consent row on its own is refused');

  // 3. asking again
  const again = must(await site({ name: 'P1 Repeat', phone: `(706) 555-${PH.slice(6)}`, topic: 'Home', message: 'Also my house', ext: 'site:p1-again' }), 'again');
  const l2 = must(await db.from('leads').select('id, asks, last_asked_at').eq('tenant_id', t.id).eq('contact_id', l1.contact_id), 'leads of contact');
  const reps = must(await db.from('lead_events').select('data').eq('lead_id', lead).eq('kind', 'repeat'), 'repeats');
  check(again.repeat === true && again.id === lead && l2.length === 1 && l2[0].asks === 2 && reps.length === 1 && reps[0].data.topic === 'Home',
    `asking again joins the open lead (one lead, asks ${l2[0]?.asks}, ${reps.length} repeat event, topic ${reps[0]?.data?.topic})`);
  check((await consents(lead)).length === 2, 'and records the second consent');
  if (!t.is_sample) {
    const alerts = must(await db.from('outbox').select('dedupe_key, data').eq('tenant_id', t.id).like('dedupe_key', `%${lead}:again:%`), 'alerts');
    check(alerts.length >= 1 && alerts.every((a) => a.data.repeat === 'true' && a.data.topic === 'Home'), `one "asked again" alert per person (${alerts.length})`);
  }
  const retry = must(await site({ name: 'P1 Repeat', phone: PH, ext: 'site:p1-again' }), 'retry');
  const l3 = must(await db.from('leads').select('asks').eq('id', lead).single(), 'lead');
  check(retry.duplicate === true && l3.asks === 2, `a retried delivery changes nothing (asks ${l3.asks})`);
  const byMail = must(await site({ name: 'P1 Repeat', email: 'p1.verify+other@gmail.com' }), 'by email');
  check(byMail.id === lead && byMail.repeat === true, 'the same Gmail with another +tag is the same person');

  // 4. consent_allows and revoke-all
  check(await allows(lead, 'call') && await allows(lead, 'email'), 'call and email are allowed');
  check(!(await allows(lead, 'sms')) && !(await allows(lead, 'autodial_ai')), 'SMS and AI calls are not');
  must(await db.from('leads').update({ status: 'lost' }).eq('id', lead), 'close');
  const second = must(await site({ name: 'P1 Repeat', phone: PH }), 'after lost');
  check(second.id && second.id !== lead && !second.repeat, 'after the lead is closed, a new ask is a new lead');
  // Revoke just after the person's latest consent, by the database's clock (this computer's clock may lag it).
  const latest = must(await db.from('lead_consents').select('received_at').eq('tenant_id', t.id).in('lead_id', [lead, second.id]).order('received_at', { ascending: false }).limit(1), 'latest')[0];
  const stopAt = new Date(new Date(latest.received_at).getTime() + 1).toISOString();
  must(await db.from('lead_consents').update({ revoked_at: stopAt, revoked_via: 'stop' }).eq('id', c1.id), 'revoke');
  const twice = await db.from('lead_consents').update({ revoked_at: new Date(new Date(stopAt).getTime() + 1000).toISOString() }).eq('id', c1.id);
  check(!!twice.error, 'a revocation is added once and never changed');
  check(!(await allows(lead, 'call')) && !(await allows(second.id, 'email')), 'revoking one consent stops every channel on all of the person’s leads');

  const back = must(await site({ name: 'P1 Repeat', phone: PH, ext: 'site:p1-back' }), 'ask again after stop');
  check(back.repeat === true && await allows(back.id, 'call') && await allows(lead, 'email'), 'asking again after a stop is new consent: they can be reached again');

  // 5. calls
  must(await db.from('tracking_numbers').insert({ tenant_id: t.id, e164: NUM, twilio_sid: 'PNp1verify0000000000000000000000', label: 'P1 line', source: 'website', forward_to: '+17065550300', record: false }), 'number');
  const other = must(await site({ name: 'P1 Caller Known', phone: PH2 }), 'known');
  const known = must(await db.rpc('ingest_call', { p_to: NUM, p_sid: 'CAp1verify-known', p_from: `+1${PH2}`, p_status: 'answered', p_duration: 40, p_recording_sid: null, p_recording_s: null }), 'call known');
  check(known.lead === other.id, 'a call from a known number joins that person’s lead');
  const fresh = must(await db.rpc('ingest_call', { p_to: NUM, p_sid: 'CAp1verify-new', p_from: CALLER, p_status: 'missed', p_duration: 0, p_recording_sid: null, p_recording_s: null }), 'call new');
  const [cc] = await consents(fresh.lead);
  check(cc && cc.channels.length === 0 && /no marketing consent/.test(cc.text) && !(await allows(fresh.lead, 'call')), 'a new caller’s lead records no marketing consent');

  // 6. partner FK
  const bad = await db.from('leads').insert({ tenant_id: t.id, name: 'P1 Bad Partner', phone: '7065550399', consent_text: 'I agree that you may contact me.', partner_id: randomUUID() });
  check(!!bad.error && /leads_partner_fk/.test(bad.error.message), 'a lead can’t point at a partner that doesn’t exist');

  const gone = must(await site({ name: 'P1 Gone', email: 'p1.gone@example.com' }), 'gone');
  must(await db.from('leads').delete().eq('id', gone.id), 'delete lead');
  check((await consents(gone.id)).length === 0, 'deleting a lead takes its consent rows with it');
  await db.from('contacts').delete().eq('tenant_id', t.id).eq('email_norm', 'p1.gone@example.com');

  // 7. backfill
  const leadIds = must(await db.from('leads').select('id').eq('tenant_id', t.id).limit(1000), 'all leads').map((l) => l.id);
  const withRow = new Set(must(await db.from('lead_consents').select('lead_id').in('lead_id', leadIds), 'rows').map((r) => r.lead_id));
  check(leadIds.every((id) => withRow.has(id)), `every lead of ${SLUG} has its consent row (${withRow.size}/${leadIds.length})`);
} finally {
  await clean();
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
