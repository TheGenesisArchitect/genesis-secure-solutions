// Proves tenant isolation through the public API, the way a browser would reach it.
// Creates three throwaway users (an agency owner, another agency's office staff, a network partner),
// signs each in, checks what they can and cannot read or do, then deletes them.
//   node --env-file=.env.local scripts/rls-test.mjs
import { createClient } from '@supabase/supabase-js';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (!ok) fails++; };

async function signedIn(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw error;
  const c = createClient(URL_, ANON, { auth: { persistSession: false } });
  const v = await c.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: 'magiclink' });
  if (v.error) throw v.error;
  return c;
}
const tenantId = async (slug) => (await admin.from('tenants').select('id').eq('slug', slug).single()).data.id;

const stamp = Date.now();
const emails = { owner: `rls-owner-${stamp}@example.com`, staff: `rls-staff-${stamp}@example.com`, net: `rls-net-${stamp}@example.com` };
const users = {};
try {
  for (const [k, e] of Object.entries(emails)) users[k] = (await admin.auth.admin.createUser({ email: e, email_confirm: true })).data.user;
  const brooks = await tenantId('demo-brooks');
  const ridge = await tenantId('sample-ridgeview');
  const mendez = await tenantId('mendez-hollis');
  const net = (await admin.from('networks').select('id').eq('slug', 'sample-carrier-network').single()).data.id;
  await admin.from('memberships').insert([{ tenant_id: brooks, user_id: users.owner.id, role: 'owner' }, { tenant_id: ridge, user_id: users.staff.id, role: 'staff' }]);
  await admin.from('network_members').insert({ network_id: net, user_id: users.net.id });

  const owner = await signedIn(emails.owner);
  const staff = await signedIn(emails.staff);
  const netUser = await signedIn(emails.net);
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

  // Agency owner sees only their own agency, on every tenant table.
  const tables = ['tenants', 'agent_records', 'gates', 'assets', 'approvals', 'care_requests', 'content_items', 'kpi_snapshots', 'invoices', 'lifecycle_events', 'audit_events'];
  for (const t of tables) {
    const col = t === 'tenants' ? 'id' : 'tenant_id';
    const { data, error } = await owner.from(t).select(col);
    const foreign = (data ?? []).filter((r) => r[col] !== brooks && r[col] !== null);
    check(`owner reads only own rows: ${t}`, !error && foreign.length === 0, error?.message ?? `${data?.length ?? 0} rows, ${foreign.length} foreign`);
  }
  check('owner sees no other agency (Mendez)', ((await owner.from('tenants').select('id').eq('id', mendez)).data ?? []).length === 0);
  check('owner cannot read inquiries', ((await owner.from('inquiries').select('id')).data ?? []).length === 0);
  check('owner cannot read internal assets', ((await owner.from('assets').select('id').eq('audience', 'internal')).data ?? []).length === 0);
  check('owner cannot see staff list beyond nothing', ((await owner.from('staff').select('user_id')).data ?? []).length === 0);

  // Writes only through functions, and only what the role allows.
  check('owner cannot insert directly', !!(await owner.from('care_requests').insert({ tenant_id: brooks, kind: 'change', title: 'direct' })).error);
  check('owner cannot update directly', ((await owner.from('tenants').update({ name: 'hacked' }).eq('id', brooks).select()).data ?? []).length === 0);
  check('owner cannot move a stage', !!(await owner.rpc('move_stage', { p_tenant: brooks, p_to: 'intake' })).error);
  check('owner cannot file a request for another agency', !!(await owner.rpc('create_care_request', { p_tenant: mendez, p_kind: 'change', p_title: 'cross-tenant' })).error);
  const req = await owner.rpc('create_care_request', { p_tenant: brooks, p_kind: 'support', p_title: 'RLS test request' });
  check('owner can file a request for own agency', !req.error, req.error?.message);
  const pend = (await owner.from('approvals').select('id').eq('status', 'pending').eq('approver', 'client').limit(1)).data?.[0];
  if (pend) check('owner can decide own client approval', !(await owner.rpc('decide_approval', { p_id: pend.id, p_decision: 'approved', p_note: 'RLS test' })).error);
  const team = (await admin.from('approvals').select('id').eq('tenant_id', brooks).eq('approver', 'team').eq('status', 'pending').limit(1)).data?.[0];
  if (team) check('owner cannot decide a team approval', !!(await owner.rpc('decide_approval', { p_id: team.id, p_decision: 'approved' })).error);

  // Office staff at another agency: own agency only, and no billing.
  const sRows = (await staff.from('tenants').select('id')).data ?? [];
  check('office staff sees only their agency', sRows.length === 1 && sRows[0].id === ridge);
  check('office staff cannot read invoices', ((await staff.from('invoices').select('id')).data ?? []).length === 0);
  const ridgePend = (await admin.from('approvals').select('id').eq('tenant_id', ridge).eq('status', 'pending').eq('approver', 'client').limit(1)).data?.[0];
  if (ridgePend) check('office staff cannot decide approvals', !!(await staff.rpc('decide_approval', { p_id: ridgePend.id, p_decision: 'approved' })).error);

  // Network partner: aggregates only.
  const port = await netUser.rpc('network_portfolio');
  check('network partner sees the portfolio', !port.error && (port.data ?? []).length >= 7, port.error?.message ?? `${port.data?.length} agencies`);
  check('portfolio excludes non-network agencies', !(port.data ?? []).some((r) => r.slug === 'mendez-hollis'));
  for (const t of ['tenants', 'gates', 'approvals', 'kpi_snapshots', 'content_items', 'invoices']) check(`network partner reads no raw ${t}`, ((await netUser.from(t).select('*')).data ?? []).length === 0);

  // Anonymous visitors get nothing.
  for (const t of ['tenants', 'inquiries', 'audit_events', 'assets']) {
    const { data } = await anon.from(t).select('*');
    check(`anonymous reads nothing: ${t}`, (data ?? []).length === 0);
  }
  check('anonymous cannot call functions', !!(await anon.rpc('network_portfolio')).error);

  // Staff roles are enforced in the database, not just the pages.
  for (const [k, role] of [['operator', 'operator'], ['reviewer', 'reviewer'], ['lead', 'account_lead']]) {
    users[k] = (await admin.auth.admin.createUser({ email: `rls-${k}-${stamp}@example.com`, email_confirm: true })).data.user;
    await admin.from('staff').insert({ user_id: users[k].id, role, display_name: `RLS ${k}` });
  }
  const operator = await signedIn(`rls-operator-${stamp}@example.com`);
  const reviewer = await signedIn(`rls-reviewer-${stamp}@example.com`);
  const lead = await signedIn(`rls-lead-${stamp}@example.com`);
  check('operator cannot move a stage', !!(await operator.rpc('move_stage', { p_tenant: ridge, p_to: 'care' })).error);
  check('operator cannot change a gate', !!(await operator.rpc('set_gate', { p_tenant: ridge, p_kind: 'domain', p_status: 'cleared' })).error);
  check('operator cannot convert an inquiry', !!(await operator.rpc('convert_inquiry', { p_id: '00000000-0000-0000-0000-000000000000', p_slug: 'x-test' })).error?.message.includes('admin'));
  check('reviewer can change a gate', !(await reviewer.rpc('set_gate', { p_tenant: ridge, p_kind: 'domain', p_status: 'open' })).error);
  check('account lead can move a stage', !(await lead.rpc('move_stage', { p_tenant: ridge, p_to: 'care', p_note: 'RLS test' })).error);
  check('staff of any role read every tenant', ((await operator.from('tenants').select('id')).data ?? []).length >= 9);

  // Platform internals stay internal.
  check('owner cannot read the email outbox', ((await owner.from('outbox').select('id')).data ?? []).length === 0);
  check('owner cannot read welcome links', ((await owner.from('client_links').select('id')).data ?? []).length === 0);
  check('signed-in users cannot probe sign-in eligibility', !!(await owner.rpc('signin_user_id', { p_email: emails.owner })).error);
  check('anonymous cannot run the audit check', !!(await anon.rpc('verify_audit_chain')).error);
  const { data: broken } = await lead.rpc('verify_audit_chain', { p_full: true });
  check('audit chain verifies in full', broken === null, `first broken id: ${broken}`);

  // A client approval on a real (non-sample) agency queues an email to its owner, exactly once.
  const { data: tmp } = await admin.from('tenants').insert({ slug: `rls-tmp-${stamp}`, name: 'RLS temp agency' }).select('id').single();
  await admin.from('memberships').insert({ tenant_id: tmp.id, user_id: users.owner.id, role: 'owner' });
  const { data: appr } = await admin.from('approvals').insert({ tenant_id: tmp.id, subject_kind: 'post', title: 'RLS outbox check', lane: 'required', approver: 'client' }).select('id').single();
  const { data: mail } = await admin.from('outbox').select('to_email, template').like('dedupe_key', `approval:${appr.id}:%`);
  check('client approval queues one owner email', (mail ?? []).length === 1 && mail[0].template === 'approval_waiting' && mail[0].to_email === emails.owner);
  await admin.from('tenants').delete().eq('id', tmp.id);

  // The audit log refuses edits and deletes, even with the service key.
  const last = (await admin.from('audit_events').select('id').order('id', { ascending: false }).limit(1)).data[0];
  check('audit log rejects update', !!(await admin.from('audit_events').update({ action: 'tamper' }).eq('id', last.id)).error);
  check('audit log rejects delete', !!(await admin.from('audit_events').delete().eq('id', last.id)).error);
} finally {
  for (const u of Object.values(users)) if (u) await admin.auth.admin.deleteUser(u.id);
  await admin.from('tenants').delete().like('slug', 'rls-tmp-%');
  await admin.from('care_requests').delete().eq('title', 'RLS test request');
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
