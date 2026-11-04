// Verify the Lead Engine P0 fixes on the PREVIEW database (docs/LEAD_ENGINE_SPEC.md §3), over HTTP against a local
// dev server with Cloudflare's always-pass Turnstile test keys:
//  1. partner credit needs a signed link: a forged or bare code credits no one ("partner-unverified"); a signed one
//     links the partner once and moves it to referring
//  2. the lead API takes at most 30 leads a minute per agency (the 31st gets 429)
//  3. a hosted-site lead keeps the visit's tags (utm_source, fbclid) and the connection's hash
//  4. Turnstile on: no token is refused; the test token goes through
//  5. a phone with filter characters can't widen the duplicate check; 5 requests an hour per connection, then 429
//   node --env-file=.env.local scripts/verify-lead-p0.mjs
import { spawn, execSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const PORT = 3913, ORIGIN = `http://localhost:${PORT}`, SLUG = 'test-launch', SECRET = 'verify-lead-p0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };

const t = must(await db.from('tenants').select('id').eq('slug', SLUG).maybeSingle(), 'tenant');
if (!t) throw new Error(`${SLUG} is missing: run verify-agency-dashboard.mjs first`);
const key = randomBytes(24).toString('hex'), keyHash = createHash('sha256').update(key).digest('hex');
const clean = async () => {
  const ids = (must(await db.from('leads').select('id').eq('tenant_id', t.id).or('ext_id.like.p0-%,name.like.P0 %'), 'find')).map((l) => l.id);
  if (ids.length) {
    await db.from('outbox').delete().eq('tenant_id', t.id).in('template', ['lead_new', 'lead_push']);
    await db.from('partner_events').delete().eq('tenant_id', t.id).like('note', 'Referred P0 %');
    must(await db.from('leads').delete().in('id', ids), 'clear leads');
  }
  await db.from('partner_targets').delete().eq('tenant_id', t.id).eq('place_id', 'p0-verify');
  await db.from('lead_keys').delete().eq('tenant_id', t.id).eq('label', 'verify lead p0');
};
await clean();
must(await db.from('lead_keys').insert({ tenant_id: t.id, key_hash: keyHash, label: 'verify lead p0' }), 'lead key');
const partner = must(await db.from('partner_targets').insert({ tenant_id: t.id, place_id: 'p0-verify', line: 'auto', category: 'car_dealer' }).select('id, ref_code').single(), 'partner');
const signed = `${partner.ref_code}.${createHmac('sha256', SECRET).update(`partner:${t.id}:${partner.ref_code}`).digest('hex').slice(0, 10)}`;
const previewK = createHmac('sha256', SECRET).update(`site:${SLUG}`).digest('base64url').slice(0, 24);

const up = async () => { try { return (await fetch(ORIGIN, { redirect: 'manual' })).status > 0; } catch { return false; } };
if (await up()) throw new Error(`port ${PORT} is busy: stop the other dev server first`);
const env = { ...process.env, CRON_SECRET: SECRET, PARTNER_LINK_SECRET: '', SITE_PREVIEW_SECRET: '', PROPOSAL_LINK_SECRET: '', MEDIA_LINK_SECRET: '',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA', TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' };
const dev = spawn('npx', ['next', 'dev', '-p', String(PORT)], { stdio: 'ignore', shell: true, env });
for (let i = 0; i < 120 && !(await up()); i++) await sleep(1000);

const ingest = (body) => fetch(`${ORIGIN}/api/leads/ingest`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ consent: 'I agree that Test Agency may contact me about this request.', ...body }) });
const lead = async (ext) => must(await db.from('leads').select('id, source, campaign, partner_id, channel, attribution').eq('tenant_id', t.id).eq('ext_id', ext).maybeSingle(), 'lead');
const partnerNow = async () => must(await db.from('partner_targets').select('status').eq('id', partner.id).single(), 'partner');

try {
  // 1. partner credit
  await ingest({ id: 'p0-forged', name: 'P0 Forged', phone: '7065550181', attribution: { utm_source: 'partner', utm_campaign: `${partner.ref_code}.0000000000` } });
  await ingest({ id: 'p0-bare', name: 'P0 Bare', phone: '7065550182', attribution: { utm_source: 'partner', utm_campaign: partner.ref_code } });
  const forged = await lead('p0-forged'), bare = await lead('p0-bare');
  check(forged?.source === 'partner-unverified' && !forged.partner_id, `a forged signature credits no one (${forged?.source})`);
  check(bare?.source === 'partner-unverified' && !bare.partner_id, `an unsigned code credits no one (${bare?.source})`);
  check((await partnerNow()).status === 'new', 'and the partner stays new');
  await ingest({ id: 'p0-signed', name: 'P0 Signed', phone: '7065550183', attribution: { utm_source: 'partner', utm_campaign: signed } });
  const good = await lead('p0-signed');
  check(good?.partner_id === partner.id && good.channel === 'partner' && good.campaign === partner.ref_code, `a signed link credits the partner (${good?.source}, ${good?.campaign})`);
  check((await partnerNow()).status === 'referring', 'and moves it to referring');
  const evs = must(await db.from('partner_events').select('id').eq('partner_id', partner.id).eq('kind', 'referral'), 'events');
  check(evs.length === 1, `one referral event (${evs.length})`);

  // 2. rate limit: 30 a minute per agency
  const { count: minute } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).gte('created_at', new Date(Date.now() - 60_000).toISOString());
  const fill = Array.from({ length: Math.max(0, 30 - (minute ?? 0)) }, (_, i) => ({ tenant_id: t.id, ext_id: `p0-bulk-${i}`, name: `P0 Bulk ${i}`, phone: `70655502${String(i).padStart(2, '0')}`, source: 'direct', consent_text: 'I agree that Test Agency may contact me.', channel: 'form' }));
  if (fill.length) must(await db.from('leads').insert(fill), 'bulk');
  const over = await ingest({ id: 'p0-over', name: 'P0 Over', phone: '7065550184' });
  check(over.status === 429 && !(await lead('p0-over')), `the 31st lead in a minute gets 429 (${over.status})`);

  // 3–5. the hosted site
  const site = (body, k = previewK) => fetch(`${ORIGIN}/api/site/${SLUG}/lead?k=${k}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-forwarded-for': '203.0.113.77' }, body: JSON.stringify({ consent: true, ms: 4000, topic: 'Auto', ...body }) });
  const noToken = await site({ name: 'P0 Notoken', phone: '7065550185' });
  check(noToken.status === 400, `Turnstile on: no token is refused (${noToken.status})`);
  const tok = 'XXXX.DUMMY.TOKEN.XXXX';
  const tagged = await site({ name: 'P0 Tagged', phone: '7065550186', 'cf-turnstile-response': tok, attribution: { utm_source: 'facebook', utm_campaign: 'fall-auto', fbclid: 'p0fbclid', landing: '/s/test-launch' } });
  const tj = await tagged.json();
  const tl = must(await db.from('leads').select('source, campaign, attribution').eq('tenant_id', t.id).eq('name', 'P0 Tagged').maybeSingle(), 'tagged');
  check(tj.ok && tl?.attribution?.utm_source === 'facebook' && tl.attribution.fbclid === 'p0fbclid' && tl.campaign === 'fall-auto', `a hosted-site lead keeps utm_source, fbclid and campaign (${JSON.stringify(tl?.attribution ?? {})})`);
  check(/^[0-9a-f]{32}$/.test(tl?.attribution?.ip_hash ?? ''), 'and the connection’s hash, never the address');
  const inj = await site({ name: 'P0 Inject', phone: '7065550187,id.neq.00000000-0000-0000-0000-000000000000', 'cf-turnstile-response': tok });
  const ij = await inj.json();
  const il = must(await db.from('leads').select('id').eq('tenant_id', t.id).eq('name', 'P0 Inject'), 'inject');
  check(ij.ok && il.length === 1, 'a phone with filter characters can’t widen the duplicate check (the lead lands)');
  for (const n of [1, 2, 3]) await site({ name: `P0 Many ${n}`, phone: `70655501${90 + n}`, 'cf-turnstile-response': tok });
  const sixth = await site({ name: 'P0 Sixth', phone: '7065550199', 'cf-turnstile-response': tok });
  check(sixth.status === 429, `five requests an hour from one connection, then 429 (${sixth.status})`);
} finally {
  await clean();
  try { execSync(`taskkill /pid ${dev.pid} /T /F`, { stdio: 'ignore' }); } catch { dev.kill(); }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
