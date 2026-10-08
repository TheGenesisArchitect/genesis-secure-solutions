'use server';
// Every dashboard write. Each one calls a database function that checks the caller's permission and
// writes the audit log, so the rules hold even if a form is replayed or forged.
// Writes return a result (shown as a toast) instead of redirecting, so the page updates in place and
// keeps the scroll position. Only actions that move you somewhere new (converting an inquiry) redirect.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from './supabase/server';
import { quoteUpgrade, careName, careRate, monthEnd, daysInMonth, businessToday } from './billing';

export type ActionResult = { ok?: string; err?: string; sticky?: boolean; at: number } | null;

const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? '').trim().slice(0, max);
const done = (ok: string, sticky = false): ActionResult => ({ ok, sticky, at: Date.now() });
const fail = (err: string): ActionResult => ({ err, at: Date.now() });

async function call(fn: string, args: Record<string, unknown>, okMsg: string): Promise<ActionResult> {
  const supabase = await db();
  const { error } = await supabase.rpc(fn, args);
  revalidatePath('/', 'layout');
  return error ? fail(error.message) : done(okMsg);
}

export async function moveStage(_: ActionResult, f: FormData) {
  return call('move_stage', { p_tenant: str(f, 'tenant', 64), p_to: str(f, 'stage', 20), p_note: str(f, 'note', 500) || null }, 'Stage updated');
}

export async function setGate(_: ActionResult, f: FormData) {
  return call('set_gate', { p_tenant: str(f, 'tenant', 64), p_kind: str(f, 'kind', 40), p_status: str(f, 'status', 20), p_evidence: str(f, 'evidence', 1000) || null }, 'Gate updated');
}

export async function decideApproval(_: ActionResult, f: FormData) {
  return call('decide_approval', { p_id: str(f, 'id', 64), p_decision: str(f, 'decision', 30), p_note: str(f, 'note') || null },
    str(f, 'decision', 30) === 'approved' ? 'Approved' : 'Changes requested');
}

export async function createCareRequest(_: ActionResult, f: FormData) {
  return call('create_care_request', { p_tenant: str(f, 'tenant', 64), p_kind: str(f, 'kind', 20), p_title: str(f, 'title', 140), p_detail: str(f, 'detail', 4000) || null },
    'Request sent. The Genovus team will pick it up.');
}

export async function setCareStatus(_: ActionResult, f: FormData) {
  return call('set_care_status', { p_id: str(f, 'id', 64), p_status: str(f, 'status', 30) }, 'Request updated');
}

export async function setInquiryStatus(_: ActionResult, f: FormData) {
  return call('set_inquiry_status', { p_id: str(f, 'id', 64), p_status: str(f, 'status', 20) }, 'Inquiry updated');
}

export async function convertInquiry(_: ActionResult, f: FormData): Promise<ActionResult> {
  const slug = str(f, 'slug', 64).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const supabase = await db();
  const { error } = await supabase.rpc('convert_inquiry', { p_id: str(f, 'id', 64), p_slug: slug });
  revalidatePath('/', 'layout');
  if (error) return fail(error.message.includes('duplicate') ? 'That client address is taken; pick another.' : error.message);
  redirect(`/console/clients/${slug}?ok=${encodeURIComponent('Client created in Consult with a draft record')}`);
}

export async function saveRecord(_: ActionResult, f: FormData) {
  let data: unknown;
  try {
    data = JSON.parse(str(f, 'data', 50_000));
  } catch {
    return fail('The record is not valid JSON');
  }
  return call('save_agent_record', { p_tenant: str(f, 'tenant', 64), p_data: data, p_note: str(f, 'note', 500) || null }, 'New record version saved');
}

/** Issue a welcome-package link for a database client. The full link is shown once; only its hash is kept. */
export async function issueWelcomeLink(_: ActionResult, f: FormData): Promise<ActionResult> {
  const tenant = str(f, 'tenant', 64);
  const supabase = await db();
  const { data: allowed } = await supabase.rpc('has_role', { roles: ['admin', 'account_lead'] });
  if (!allowed) return fail('Only an admin or account lead can issue a welcome link.');
  const { randomBytes, createHash } = await import('node:crypto');
  const { adminDb } = await import('./supabase/admin');
  const token = randomBytes(16).toString('base64url');
  const full = createHash('sha256').update(token).digest('hex');
  const { data: auth } = await supabase.auth.getUser();
  const admin = adminDb();
  // A reissued link keeps the first link's storage key, so the client's saved setup progress carries over.
  const { data: first } = await admin.from('client_links').select('key16').eq('tenant_id', tenant).order('created_at').limit(1).maybeSingle();
  await admin.from('client_links').update({ revoked_at: new Date().toISOString() }).eq('tenant_id', tenant).is('revoked_at', null);
  const { error } = await admin.from('client_links').insert({ tenant_id: tenant, token_hash: full, key16: first?.key16 ?? full.slice(0, 16), created_by: auth.user?.id ?? null });
  if (error) return fail('The link could not be created.');
  await admin.from('audit_events').insert({ tenant_id: tenant, actor: auth.user?.id ?? null, actor_label: auth.user?.email ?? 'staff', action: 'welcome.link', subject: 'welcome link issued', prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  return done(`Welcome link ready (shown once, copy it now): /welcome/${token}`, true);
}

/** Approve every listed team item in one go. Each still goes through decide_approval (role check + audit). */
export async function bulkApprove(_: ActionResult, f: FormData): Promise<ActionResult> {
  const ids = f.getAll('id').map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
  const supabase = await db();
  let ok = 0;
  const errors = new Set<string>();
  for (const id of ids) {
    const { error } = await supabase.rpc('decide_approval', { p_id: id, p_decision: 'approved', p_note: 'Approved in bulk: passed every rule' });
    if (error) errors.add(error.message);
    else ok++;
  }
  revalidatePath('/', 'layout');
  return errors.size ? fail(`Approved ${ok} of ${ids.length}. ${[...errors].join(' ')}`) : done(`Approved ${ok} item${ok === 1 ? '' : 's'}.`);
}

// ---------- billing (Mercury) ----------
const cents = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, '')) * 100);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateOr = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00Z') : new Date(businessToday() + 'T00:00:00Z'));
const fmt = (c: number) => (c < 0 ? '−' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Deposit, balance, care or a custom ("Other") invoice with up to three line items. */
export async function createInvoice(_: ActionResult, f: FormData): Promise<ActionResult> {
  const kind = str(f, 'kind', 20);
  const lines = [1, 2, 3].map((i) => ({ label: str(f, `line${i}`, 120), cents: cents(str(f, `amount${i}`, 20) || '0') })).filter((l) => l.label && l.cents);
  const amount = lines.length ? lines.reduce((s, l) => s + l.cents, 0) : cents(str(f, 'amount', 20) || '0');
  if (!(amount > 0)) return fail('Enter an amount (or line items) above zero.');
  if (kind === 'custom' && !str(f, 'note', 300) && !lines.length) return fail('Describe the custom invoice.');
  return call('create_invoice', {
    p_tenant: str(f, 'tenant', 64), p_kind: kind, p_amount_cents: amount, p_note: str(f, 'note', 300) || null, p_due: str(f, 'due', 10) || null,
    p_lines: lines,
  }, 'Invoice drafted. Add its Mercury payment link to send it.');
}

export async function createUpgradeInvoice(_: ActionResult, f: FormData): Promise<ActionResult> {
  const tenant = str(f, 'tenant', 64), to = str(f, 'to', 20), on = dateOr(str(f, 'on', 10));
  const supabase = await db();
  const [{ data: t }, { data: paid }] = await Promise.all([
    supabase.from('tenants').select('plan, care_active, care_rate_cents').eq('id', tenant).single(),
    supabase.from('invoices').select('amount_cents, kind, status').eq('tenant_id', tenant).in('kind', ['deposit', 'balance', 'upgrade']),
  ]);
  if (!t) return fail('Client not found.');
  const setupPaid = (paid ?? []).filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount_cents, 0);
  const unpaid = (paid ?? []).filter((i) => i.kind !== 'upgrade' && (i.status === 'draft' || i.status === 'open')).reduce((s, i) => s + i.amount_cents, 0);
  const q = quoteUpgrade(t, setupPaid, to, on, unpaid);
  if (!q) return fail('Pick Growth or Premium.');
  if (q.total <= 0) return fail('Nothing to charge: what they have paid already covers this plan.');
  return call('create_upgrade', {
    p_tenant: tenant, p_to: to, p_amount_cents: q.total, p_note: `Upgrade to ${q.plan.name}, effective ${iso(on)}`, p_due: iso(new Date(on.getTime() + 7 * 86_400_000)),
    p_lines: q.lines,
  }, `Upgrade to ${q.plan.name} drafted: ${fmt(q.total)}${unpaid ? `; the unpaid ${fmt(unpaid)} setup balance is retired` : ''}. Add its Mercury link to send it with the upgrade email.`);
}

/** Start monthly care: plan, rate and start date; the first month is prorated to month end. */
export async function startCare(_: ActionResult, f: FormData): Promise<ActionResult> {
  const tenant = str(f, 'tenant', 64), plan = str(f, 'plan', 20), start = dateOr(str(f, 'start', 10));
  const rate = careRate[plan];
  if (!rate) return fail('Pick a care plan.');
  const dim = daysInMonth(start), left = dim - start.getUTCDate() + 1;
  const first = Math.round((rate * left) / dim);
  return call('start_care', { p_tenant: tenant, p_care: careName[plan], p_rate_cents: rate, p_start: iso(start), p_first_cents: first, p_first_end: iso(monthEnd(start)) },
    `${careName[plan]} started ${iso(start)}: first month ${fmt(first)} (${left} of ${dim} days) drafted; ${fmt(rate)} drafts on the 1st of each month.`);
}

export async function stopCare(_: ActionResult, f: FormData) {
  return call('stop_care', { p_tenant: str(f, 'tenant', 64), p_end: str(f, 'end', 10) || businessToday() }, 'Care stopped. Past invoices stay on record.');
}

export async function publishInvoice(_: ActionResult, f: FormData) {
  return call('publish_invoice', { p_id: str(f, 'id', 64), p_pay_url: str(f, 'pay_url', 500), p_number: str(f, 'number', 40) || null, p_due: str(f, 'due', 10) || null },
    'Invoice sent: it is in the client’s Billing page and they get an email.');
}

export async function markInvoicePaid(_: ActionResult, f: FormData) {
  return call('mark_invoice_paid', { p_id: str(f, 'id', 64), p_via: str(f, 'via', 60) || 'Mercury', p_paid_on: str(f, 'paid_on', 10) || businessToday() }, 'Payment recorded.');
}

export async function voidInvoice(_: ActionResult, f: FormData) {
  return call('void_invoice', { p_id: str(f, 'id', 64) }, 'Invoice voided.');
}

export async function deleteInvoice(_: ActionResult, f: FormData) {
  return call('delete_invoice', { p_id: str(f, 'id', 64) }, 'Draft removed.');
}
