// Verify the turnkey flow (Weeks 1–2) on the PREVIEW database.
//  1. the checks move the stage: proposal sent → Deposit; deposit paid → Intake and the plan becomes the package;
//     checklist done + photo rights and kickoff cleared → Build. Forward only, logged as automatic. Nothing moves
//     early (an unpaid deposit, a missing checklist, an open check)
//  2. what each client is waiting on is named (pipeline and Helix's brief use the same words)
// Each run makes its own test client (clients can't be deleted: the audit trail keeps them); it's marked a sample after.
//   node --conditions=react-server --env-file=.env.local scripts/verify-turnkey.mjs [outDir]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { createClient } from '@supabase/supabase-js';

if (/prod/i.test(process.env.VERCEL_ENV ?? '')) throw new Error('refusing: production environment');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'genovus-verify'); fs.mkdirSync(OUT, { recursive: true });
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const db = createClient(URL_, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith('.') && !/\\.[a-z]+$/.test(s)) return next(s + '.ts', c); if (s.startsWith('@/')) return next(new URL('../' + s.slice(2) + (/\\.[a-z]+$/.test(s) ? '' : (s.startsWith('@/components') ? '.tsx' : '.ts')), ${JSON.stringify(new URL('./', import.meta.url).href)}).href, c); throw e; } }`));

const SLUG = `verify-turnkey-${Date.now().toString(36)}`;
const t = must(await db.from('tenants').insert({ slug: SLUG, name: 'Verify Turnkey Agency', stage: 'consult' }).select('id').single(), 'tenant');
must(await db.from('gates').insert(['photo_rights', 'carrier_approval', 'carrier_rules', 'meta_access', 'domain', 'privacy_notice', 'kickoff'].map((kind) => ({ tenant_id: t.id, kind }))), 'gates');
must(await db.from('agent_records').insert({ tenant_id: t.id, version: 1, data: { agencyName: 'Verify Turnkey Agency', package: 'growth', email: 'owner@verify-turnkey.example' }, is_current: true, note: 'verify' }), 'record');
const stage = async () => must(await db.from('tenants').select('stage, plan').eq('id', t.id).single(), 'stage');
const events = async () => must(await db.from('lifecycle_events').select('from_stage, to_stage, note, actor').eq('tenant_id', t.id).order('at'), 'events');

try {
  const B = await import('../lib/blockers.ts');
  const why = async () => (await B.blockersFor(db, [t.id])).get(t.id)?.items ?? [];

  // 1. stage moves
  check((await why()).some((x) => /Draft the proposal and deposit/.test(x)), `a new client is waiting on its proposal (${(await why()).join('; ')})`);
  const dep = must(await db.from('invoices').insert({ tenant_id: t.id, kind: 'deposit', amount_cents: 175000, status: 'draft', note: 'Verify deposit' }).select('id').single(), 'deposit');
  must(await db.from('tenants').update({ proposal_sent_at: new Date().toISOString() }).eq('id', t.id), 'sent');
  const s1 = await stage();
  check(s1.stage === 'deposit' && !s1.plan, `proposal sent → Deposit, plan not set yet (${s1.stage}, ${s1.plan})`);
  must(await db.from('invoices').update({ status: 'open' }).eq('id', dep.id), 'open');
  check((await stage()).stage === 'deposit' && (await why()).some((x) => /Deposit not paid/.test(x)), `an unpaid deposit keeps it in Deposit, named (${(await why()).join('; ')})`);
  must(await db.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', dep.id), 'paid');
  const s2 = await stage();
  check(s2.stage === 'intake' && s2.plan === 'growth', `deposit paid → Intake, and the plan becomes the package (${s2.stage}, ${s2.plan})`);
  check((await why()).some((x) => /Client checklist: .*legal name/i.test(x)) && (await why()).some((x) => /Photo rights not cleared/.test(x)), `Intake names what's missing (${(await why()).join('; ')})`);
  must(await db.from('tenants').update({ checklist_done_at: new Date().toISOString() }).eq('id', t.id), 'checklist');
  check((await stage()).stage === 'intake', 'checklist done but photo rights and kickoff open: stays in Intake');
  must(await db.from('gates').update({ status: 'cleared' }).eq('tenant_id', t.id).eq('kind', 'photo_rights'), 'photo');
  check((await stage()).stage === 'intake', 'kickoff still open: stays in Intake');
  must(await db.from('gates').update({ status: 'waived' }).eq('tenant_id', t.id).eq('kind', 'kickoff'), 'kickoff');
  check((await stage()).stage === 'build', 'photo rights and kickoff cleared → Build');
  const ev = await events();
  check(ev.length === 3 && ev.every((e) => e.actor === null && /^Automatic: /.test(e.note)) && ev.map((e) => e.to_stage).join(',') === 'deposit,intake,build', `each move is logged as automatic (${ev.map((e) => `${e.from_stage}→${e.to_stage}`).join(', ')})`);
  must(await db.from('tenants').update({ proposal_sent_at: new Date().toISOString() }).eq('id', t.id), 'resend');
  check((await stage()).stage === 'build' && (await events()).length === 3, 'forward only: a later signal never moves it back');
  const audit = must(await db.from('audit_events').select('action, actor_label').eq('tenant_id', t.id).in('action', ['stage.auto', 'plan.set']), 'audit');
  check(audit.filter((a) => a.action === 'stage.auto').length === 3 && audit.some((a) => a.action === 'plan.set') && audit.every((a) => a.actor_label === 'Genovus (automatic)'), 'and in the audit trail, with the plan change');
  check((await why()).some((x) => /mark it ready for review/.test(x)), `Build names the next human step (${(await why()).join('; ')})`);
} finally {
  await db.from('tenants').update({ is_sample: true, name: 'Verify turnkey (test)' }).like('slug', 'verify-turnkey-%');
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
