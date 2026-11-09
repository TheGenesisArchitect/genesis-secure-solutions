// Verify Lead Engine P1, slice 2 (migration 0095, lib/lead-checks.ts, lib/lead-score.ts) on the PREVIEW database, over
// HTTP against a local dev server. Twilio Lookup is a local stand-in (nothing is billed):
//  1. an in-line lead from a licensed state's area code, with a working email and a picked time, scores with its reasons
//  2. a request only for a line the agency doesn't write scores 0 and is flagged
//  3. an email domain that takes no mail is noted, never deleted
//  4. asking again rescores the lead (+5, 80 to 85); a second run with nothing new changes nothing
//  5. with LEAD_LOOKUP_ON=1 the carrier's answer replaces the well-formed check (+20, the line type kept)
//   node --env-file=.env.local scripts/verify-lead-score.mjs
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PORT = 3915, STUB = 3916, ORIGIN = `http://localhost:${PORT}`, SLUG = 'test-launch', SECRET = 'verify-lead-score';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const t = must(await db.from('tenants').select('id, name').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) throw new Error(`${SLUG} is missing: run verify-agency-dashboard.mjs first`);
const before = must(await db.from('agency_profiles').select('*').eq('tenant_id', t.id).maybeSingle(), 'profile');
const clean = async () => {
  const ids = (must(await db.from('leads').select('id').eq('tenant_id', t.id).like('name', 'S2 %'), 'find')).map((l) => l.id);
  if (ids.length) {
    await db.from('outbox').delete().eq('tenant_id', t.id).in('template', ['lead_new', 'lead_push']);
    must(await db.from('leads').delete().in('id', ids), 'clear');
  }
  await db.from('contacts').delete().eq('tenant_id', t.id).in('phone_e164', ['+17065550311', '+17065550312', '+17065550313', '+12125550314']);
};
await clean();
const profile = { tenant_id: t.id, lines: ['auto', 'home'], licensed_states: ['GA', 'AL'], service_radius_mi: before?.service_radius_mi ?? 15 };
must(await db.from('agency_profiles').upsert(profile, { onConflict: 'tenant_id' }), 'profile');

// The Twilio Lookup stand-in: every number is a valid mobile.
let lookups = 0;
const stub = createServer((req, res) => { lookups++; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ valid: true, line_type_intelligence: { type: 'mobile' } })); });
await new Promise((r) => stub.listen(STUB, r));

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy`);
const start = (extra) => {
  const p = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env: { ...process.env, CRON_SECRET: SECRET, LEAD_ENGINE_OFF: '', ...extra } });
  return p;
};
const stop = (p) => { try { execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' }); } catch { p.kill(); } };
let dev = start({ LEAD_LOOKUP_ON: '' });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
if (!(await up())) throw new Error(`the dev server on port ${PORT} didn't start: stop any other "next dev" for this project (a check that reuses port 3911 may have left one running)`);

const site = (o) => db.rpc('site_lead', {
  p_tenant: t.id, p_ext_id: `site:${randomUUID()}`, p_name: o.name, p_email: o.email ?? null, p_phone: o.phone ?? null, p_topic: o.topic ?? null,
  p_message: o.message ?? null, p_source: 'website', p_medium: 'callback', p_campaign: null, p_attribution: {}, p_consent: `I agree that ${t.name} may contact me about this request.`,
  p_requested_for: o.when ?? null,
});
const run = async () => { const r = await fetch(`${ORIGIN}/api/cron/leads`, { headers: { authorization: `Bearer ${SECRET}` } }); return [r.status, await r.json().catch(() => ({}))]; };
const lead = async (id) => must(await db.from('leads').select('score, score_reasons, out_of_line, verified, scored_at, updated_at').eq('id', id).single(), 'lead');

try {
  const when = new Date(Date.now() + 3 * 86_400_000); when.setUTCMinutes(0, 0, 0);
  const a = must(await site({ name: 'S2 Hot', phone: '(706) 555-0311', email: 's2.hot@gmail.com', topic: 'Auto', when: when.toISOString() }), 'a');
  const b = must(await site({ name: 'S2 Boat', phone: '7065550312', topic: 'Boat' }), 'b');
  const c = must(await site({ name: 'S2 Nomail', phone: '2125550314', email: 's2@example.com' }), 'c');
  const [st, body] = await run();
  check(st === 200 && body.checks?.scored >= 3 && body.checks.lookups === 0, `the minute's run scores new leads, no lookups while it's off (${st} ${JSON.stringify(body)})`);
  const la = await lead(a.id);
  check(la.score === 80 && la.verified === true && la.score_reasons.some((r) => /\+30 asks about Auto/.test(r)) && la.score_reasons.some((r) => /\+20 GA area code/.test(r))
    && la.score_reasons.some((r) => /\+10 email domain takes mail/.test(r)) && la.score_reasons.some((r) => /\+10 picked a time/.test(r)) && la.score_reasons.some((r) => /\+10 phone number is well-formed/.test(r)),
    `in line, GA area code, well-formed phone, working email, picked time: 80 (${la.score}: ${la.score_reasons.join(' | ')})`);
  const lb = await lead(b.id);
  check(lb.score === 0 && lb.out_of_line === true && lb.score_reasons.some((r) => /Outside your lines: Boat/.test(r)), `a boat-only request scores 0 and is flagged (${lb.score_reasons.join(' | ')})`);
  const lc = await lead(c.id);
  const mailCheck = must(await db.from('lead_checks').select('ok, result').eq('lead_id', c.id).eq('kind', 'email').maybeSingle(), 'mail');
  check(mailCheck?.ok === false && lc.score_reasons.some((r) => /does not take mail/.test(r)) && lc.score_reasons.includes('Line not stated'), `an email domain that takes no mail is noted (${mailCheck?.result?.why})`);
  check(!!(await db.from('leads').select('id').eq('id', c.id).maybeSingle()).data, 'and the lead stays');

  must(await site({ name: 'S2 Hot', phone: '7065550311', topic: 'Auto' }), 'again');
  await run();
  const la2 = await lead(a.id);
  const evs = must(await db.from('lead_events').select('data').eq('lead_id', a.id).eq('kind', 'score'), 'score events');
  check(la2.score === 85 && la2.score_reasons.some((r) => /\+5 asked 2 times/.test(r)) && evs.length === 2, `asking again rescores it to 85 (${la2.score}, ${evs.length} score events)`);
  await run();
  const evs2 = must(await db.from('lead_events').select('id').eq('lead_id', a.id).eq('kind', 'score'), 'score events');
  check(evs2.length === 2 && (await lead(a.id)).scored_at === la2.scored_at, 'a run with nothing new changes nothing');

  // 5. the carrier lookup, against the stand-in
  stop(dev);
  for (let i = 0; i < 30 && (await up()); i++) await sleep(500);
  dev = start({ LEAD_LOOKUP_ON: '1', TWILIO_ACCOUNT_SID: 'ACverify', TWILIO_AUTH_TOKEN: 'verify', TWILIO_LOOKUP_BASE: `http://localhost:${STUB}` });
  for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);
if (!(await up())) throw new Error(`the dev server on port ${PORT} didn't start: stop any other "next dev" for this project (a check that reuses port 3911 may have left one running)`);
  const d = must(await site({ name: 'S2 Lookup', phone: '7065550313', topic: 'Home' }), 'd');
  const [, body2] = await run();
  const ld = await lead(d.id);
  const lt = must(await db.from('lead_checks').select('ok, result').eq('lead_id', d.id).eq('kind', 'line_type').maybeSingle(), 'line type');
  check(lookups >= 1 && body2.checks?.lookups >= 1 && lt?.ok === true && lt.result.type === 'mobile' && ld.score === 70 && ld.score_reasons.some((r) => /\+20 phone checked with the carrier \(mobile\)/.test(r)),
    `with the lookup on, the carrier's answer counts +20 and keeps the line type (${ld.score}: ${ld.score_reasons.join(' | ')})`);
} finally {
  stop(dev);
  stub.close();
  await clean();
  if (before) must(await db.from('agency_profiles').upsert(before, { onConflict: 'tenant_id' }), 'restore profile');
  else await db.from('agency_profiles').delete().eq('tenant_id', t.id);
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
