'use server';
// The console's side of a new client's welcome (the client page's "Welcome and kickoff" panel):
//  - sendWelcomeAction: the welcome email (outward: a person's tap, an admin or account lead) to the client's email
//    and the agency's owners: their package and terms, the deposit and its due date, the kickoff, and the link to
//    their Welcome page with Ask Helix. Marks the checklist link as sent, so the deposit doesn't send a second one.
//  - setDepositDueAction: the deposit invoice's due date (the date agreed on the consult).
//  - copyPromosAction: start the client's Library from another same-carrier agency's approved promo images (the
//    carrier's standard assets): copies of the files, theirs to keep, change or drop; the source is untouched.
import { revalidatePath } from 'next/cache';
import { get, put } from '@vercel/blob';
import { db } from './supabase/server';
import { adminDb } from './supabase/admin';
import type { ActionResult } from './actions';

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? '').trim().slice(0, max);
const done = (ok: string): ActionResult => ({ ok, at: Date.now() });
const fail = (err: string): ActionResult => ({ err, at: Date.now() });
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Only files and plain public images copy: never a path under another client's private welcome link (/w/, /welcome/). */
const promoCopyable = (a: { location_kind: string; location: string }) => a.location_kind === 'blob' || a.location_kind === 'external' || (a.location_kind === 'public' && !/^\/(w|welcome)\//.test(a.location));

async function allowed(roles: string[]) {
  const supabase = await db();
  const { data } = await supabase.rpc('has_role', { roles });
  const { data: me } = await supabase.auth.getUser();
  return data ? me.user : null;
}

export async function sendWelcomeAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const me = await allowed(['admin', 'account_lead']);
  if (!me) return fail('Only an admin or account lead can send the welcome.');
  const tenantId = str(f, 'tenant', 64);
  const admin = adminDb();
  const { data: t } = await admin.from('tenants').select('id, name, slug, is_sample').eq('id', tenantId).maybeSingle();
  if (!t) return fail('Client not found.');
  const { welcomeData, etWhen } = await import('./welcome');
  const w = await welcomeData(t.id as string, t.slug as string);
  // The record's email plus the agency's owners (the people who were invited to the dashboard).
  const { data: members } = await admin.from('memberships').select('user_id, role').eq('tenant_id', t.id);
  const owners = (members ?? []).filter((m) => m.role === 'owner');
  const emails = new Set<string>();
  if (typeof w.record.email === 'string' && EMAIL.test(w.record.email)) emails.add(w.record.email.toLowerCase());
  for (const o of owners) { const { data: u } = await admin.auth.admin.getUserById(o.user_id as string); if (u.user?.email) emails.add(u.user.email.toLowerCase()); }
  if (!emails.size) return fail('Add the client’s email to their record, or invite the owner, first: the welcome goes there.');
  if (!(members ?? []).length) return fail('Invite the owner to the dashboard first (People panel): the welcome links to their dashboard.');
  const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  const { postalAddress } = await import('./consult-followups');
  const data = {
    agency: t.name, first: w.first || 'there', package: w.plan.name,
    deposit: usd(w.deposit.cents), due: w.deposit.due ? new Date(`${w.deposit.due}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }) : '',
    paid: w.deposit.paid ? 'true' : 'false', balance: usd(w.balanceCents), care: w.plan.careName ? `${w.plan.careName} at ${usd(w.plan.careCents ?? 0)} a month` : '',
    kickoff: w.kickoff ? etWhen(w.kickoff.starts) : '', confirmed: w.kickoff?.confirmed ? 'true' : 'false',
    link: `${origin}/app/${t.slug}/welcome`, address: await postalAddress(), reply_to: me.email ?? '',
  };
  if (!t.is_sample) {
    const stamp = new Date().toISOString().slice(0, 13);
    const { error } = await admin.from('outbox').insert([...emails].map((to) => ({ tenant_id: t.id, to_email: to, template: 'client_welcome', data, dedupe_key: `welcome:${t.id}:${stamp}:${to}` })));
    if (error && !/duplicate/.test(error.message)) return fail(error.message);
  }
  // The welcome replaces the checklist email that would otherwise go out when the deposit clears.
  await admin.from('tenants').update({ checklist_link_sent_at: new Date().toISOString() }).eq('id', t.id).is('checklist_link_sent_at', null);
  await admin.from('audit_events').insert({ tenant_id: t.id, actor: me.id, actor_label: me.email ?? 'staff', action: 'welcome.sent', subject: w.plan.name, after: { to: [...emails], kickoff: data.kickoff, due: w.deposit.due }, prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  return done(`Welcome sent to ${[...emails].join(', ')}.`);
}

export async function setDepositDueAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const me = await allowed(['admin', 'account_lead']);
  if (!me) return fail('Only an admin or account lead can change the deposit.');
  const tenantId = str(f, 'tenant', 64), due = str(f, 'due', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return fail('Pick a due date.');
  const admin = adminDb();
  const { data: dep } = await admin.from('invoices').select('id, status, due_date').eq('tenant_id', tenantId).eq('kind', 'deposit').neq('status', 'void').order('created_at').limit(1).maybeSingle();
  if (!dep) return fail('There’s no deposit invoice yet. Start onboarding drafts it.');
  if (dep.status === 'paid') return fail('The deposit is already paid.');
  const { error } = await admin.from('invoices').update({ due_date: due }).eq('id', dep.id);
  if (error) return fail(error.message);
  await admin.from('audit_events').insert({ tenant_id: tenantId, actor: me.id, actor_label: me.email ?? 'staff', action: 'deposit.due', subject: due, before: { due: dep.due_date }, after: { due }, prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  return done(`Deposit due ${due}.`);
}

export async function copyPromosAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const me = await allowed(['admin', 'account_lead', 'operator']);
  if (!me) return fail('Not allowed.');
  const target = str(f, 'tenant', 64), source = str(f, 'source', 64);
  const ids = f.getAll('asset').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 60);
  if (!ids.length) return fail('Tick at least one promo to copy.');
  if (target === source) return fail('Pick another agency’s library.');
  const admin = adminDb();
  const [{ data: src }, { data: items }] = await Promise.all([
    admin.from('tenants').select('name').eq('id', source).single(),
    admin.from('assets').select('*').eq('tenant_id', source).in('id', ids).eq('kind', 'image').neq('audience', 'internal'),
  ]);
  let copied = 0, skipped = 0;
  for (const a of items ?? []) {
    if (!promoCopyable(a)) { skipped++; continue; }
    const { data: have } = await admin.from('assets').select('id').eq('tenant_id', target).eq('title', a.title).maybeSingle();
    if (have) { skipped++; continue; }
    let location = a.location as string;
    if (a.location_kind === 'blob') {
      // A copy of the file under the new agency, so either can change or remove theirs without touching the other.
      const res = await get(a.location, { access: 'private', useCache: false });
      if (!res || res.statusCode !== 200) { skipped++; continue; }
      const ext = String(a.location).split('.').pop() ?? 'jpg';
      location = `assets/${target}/promos/${crypto.randomUUID()}.${ext}`;
      await put(location, res.stream, { access: 'private', contentType: res.blob.contentType, addRandomSuffix: false });
    }
    const { error } = await admin.from('assets').insert({ tenant_id: target, kind: 'image', title: a.title, location_kind: a.location_kind, location, preview: a.preview, audience: 'client', rights_status: a.rights_status,
      notes: `Carrier starter promo, copied from ${src?.name ?? 'another agency'}’s library on ${new Date().toISOString().slice(0, 10)}.${a.notes ? ` ${a.notes}` : ''}`.slice(0, 1000) });
    if (error) { skipped++; continue; }
    copied++;
  }
  await admin.from('audit_events').insert({ tenant_id: target, actor: me.id, actor_label: me.email ?? 'staff', action: 'library.copied', subject: `${copied} promos from ${src?.name ?? source}`, after: { copied, skipped }, prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  return copied ? done(`${copied} promo${copied === 1 ? '' : 's'} copied into this client’s Library${skipped ? ` (${skipped} already there or unavailable)` : ''}.`) : fail(skipped ? 'Those are already in this client’s Library.' : 'Nothing was copied.');
}
