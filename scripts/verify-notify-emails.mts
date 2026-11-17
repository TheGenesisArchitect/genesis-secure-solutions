// Verify migration 0114 on the preview DB, nothing sent (rows are queued for 2099 and removed): an agency's notices to
// its own people go to tenants.notify_emails (first To:, rest Cc:); email to its customers, push rows and the house
// desk are untouched.
// Run: npx tsx --env-file=.env.local scripts/verify-notify-emails.mts
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
if (!/sckbuj/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '')) throw new Error('refusing: not the preview database');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!, { auth: { persistSession: false } });
let pass = 0, fail = 0;
const check = (name: string, ok: unknown, info?: unknown) => { if (ok) { pass++; console.log(`  ok  ${name}`); } else { fail++; console.log(`  FAIL ${name}`, JSON.stringify(info ?? '').slice(0, 400)); } };
const java = (await db.from('tenants').select('id, notify_emails').eq('slug', 'mendez-hollis').single()).data!;
const admin = (await db.from('staff').select('user_id').eq('role', 'admin').limit(1).single()).data!.user_id as string;
const adminEmail = (await db.auth.admin.getUserById(admin)).data.user!.email!;
const other = (await db.from('tenants').select('id').neq('id', java.id).eq('notify_emails', '{}').limit(1).single()).data!.id as string;
const tag = randomBytes(3).toString('hex');
const keys: string[] = [];
let member = false;
const q = async (tenant: string, to: string, template = 'approval_waiting') => {
  const k = `verify-notify:${tag}:${keys.length}`; keys.push(k);
  return (await db.from('outbox').insert({ tenant_id: tenant, to_email: to, template, data: { title: 'x' }, dedupe_key: k, send_after: '2099-01-01T00:00:00Z' }).select('to_email, data').single()).data!;
};
try {
  check('JAVA: GEICO inbox first, Gmail second', JSON.stringify(java.notify_emails) === JSON.stringify(['menhollis@geico.com', 'dezhollis@gmail.com']), java.notify_emails);
  await db.from('memberships').insert({ tenant_id: java.id, user_id: admin, role: 'owner' }); member = true;
  const a = await q(java.id, adminEmail);
  check('a notice to his sign-in email goes To: his GEICO inbox, Cc: his Gmail', a.to_email === 'menhollis@geico.com' && (a.data as Record<string, string>).notify_cc === 'dezhollis@gmail.com' && (a.data as Record<string, string>).signin_email === adminEmail, a);
  const g = await q(java.id, 'dezhollis@gmail.com', 'agency_brief');
  check('one queued to his Gmail directly: same, no double copy', g.to_email === 'menhollis@geico.com' && (g.data as Record<string, string>).notify_cc === 'dezhollis@gmail.com', g);
  const c = await q(java.id, `customer-${tag}@example.invalid`, 'lead_reply');
  check('email to his customers is untouched', c.to_email === `customer-${tag}@example.invalid` && !(c.data as Record<string, string>).notify_cc, c);
  const p = await q(java.id, 'push', 'approval_push');
  check('phone alerts are untouched', p.to_email === 'push' && !(p.data as Record<string, string>).notify_cc, p);
  const h = await q(other, adminEmail);
  check('an agency without notify_emails is unchanged', h.to_email === adminEmail && !(h.data as Record<string, string>).notify_cc, h);
} finally {
  for (const k of keys) await db.from('outbox').delete().eq('dedupe_key', k);
  if (member) await db.from('memberships').delete().eq('tenant_id', java.id).eq('user_id', admin).eq('role', 'owner');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
