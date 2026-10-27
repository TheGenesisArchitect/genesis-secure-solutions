'use server';
// Send the proposal and deposit (outward: only a person's tap, an admin or account lead). Opens the deposit invoice
// in Mercury when Mercury is connected (its pay link then shows on the proposal), emails the proposal link to the
// client's email on record, and marks the proposal sent, which moves the client to Deposit (migration 0080).
import { revalidatePath } from 'next/cache';
import { db } from './supabase/server';
import { adminDb } from './supabase/admin';
import type { ActionResult } from './actions';
import { ensureDepositDraft, packageOf, planFor, proposalToken } from './proposal';

const done = (ok: string): ActionResult => ({ ok, at: Date.now() });
const fail = (err: string): ActionResult => ({ err, at: Date.now() });

export async function sendProposal(tenantId: string): Promise<{ ok: string } | { err: string }> {
  const supabase = await db();
  const { data: allowed } = await supabase.rpc('has_role', { roles: ['admin', 'account_lead'] });
  if (!allowed) return { err: 'Only an admin or account lead can send a proposal and deposit.' };
  const admin = adminDb();
  const { data: t } = await admin.from('tenants').select('id, name, slug, is_sample, proposal_sent_at').eq('id', tenantId).single();
  if (!t) return { err: 'Client not found.' };
  const { data: rec } = await admin.from('agent_records').select('data').eq('tenant_id', tenantId).eq('is_current', true).maybeSingle();
  const r = (rec?.data ?? {}) as Record<string, unknown>;
  const email = typeof r.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email) ? r.email.toLowerCase() : null;
  if (!email) return { err: 'Add the client’s email to their record first: the proposal goes there.' };
  const pkg = packageOf(r.package);
  const token = proposalToken(tenantId);
  if (!token) return { err: 'Proposal links aren’t set up on this deployment (no signing secret).' };
  const depositId = await ensureDepositDraft(tenantId, pkg);
  // The deposit opens in Mercury when it's connected; otherwise the proposal says the invoice follows.
  let payNote = 'Your deposit invoice follows separately.';
  const { mercuryConfigured, pushInvoice } = await import('./mercury');
  const { data: dep } = await admin.from('invoices').select('status, pay_url').eq('id', depositId).single();
  if (dep?.status === 'draft' && mercuryConfigured()) {
    try { await pushInvoice(depositId); payNote = 'The deposit invoice is linked on the proposal.'; } catch (e) { return { err: `The deposit didn’t open in Mercury: ${e instanceof Error ? e.message : e}` }; }
  } else if (dep?.status === 'open' && dep.pay_url) payNote = 'The deposit invoice is linked on the proposal.';
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  const plan = planFor(pkg);
  const first = String(r.contactName ?? '').split(/\s+/)[0] || 'there';
  if (!t.is_sample) {
    const { error } = await admin.from('outbox').insert({ tenant_id: tenantId, to_email: email, template: 'proposal_ready', data: { agency: t.name, first, package: plan.name, link: `${origin}/proposal/${token}` }, dedupe_key: `proposal:${tenantId}:${new Date().toISOString().slice(0, 10)}` });
    if (error && !/duplicate/.test(error.message)) return { err: error.message };
  }
  await admin.from('tenants').update({ proposal_sent_at: new Date().toISOString() }).eq('id', tenantId);
  const { data: me } = await supabase.auth.getUser();
  await admin.from('audit_events').insert({ tenant_id: tenantId, actor: me.user?.id ?? null, actor_label: me.user?.email ?? 'staff', action: 'proposal.sent', subject: plan.name, after: { email, package: pkg }, prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  return { ok: `Proposal sent to ${email} (${plan.name}). ${payNote}` };
}

/** The client page's "Send proposal and deposit" button. */
export async function sendProposalAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const r = await sendProposal(String(f.get('tenant') ?? ''));
  return 'err' in r ? fail(r.err) : done(r.ok);
}
