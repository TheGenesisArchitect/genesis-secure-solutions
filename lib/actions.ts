'use server';
// Every dashboard write. Each one calls a database function that checks the caller's permission and
// writes the audit log, so the rules hold even if a form is replayed or forged.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from './supabase/server';

const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? '').trim().slice(0, max);
const back = (f: FormData, fallback: string) => {
  const b = str(f, 'back', 300);
  return b.startsWith('/') && !b.startsWith('//') ? b : fallback;
};
const withMsg = (path: string, key: 'ok' | 'err', msg: string) => `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(msg)}`;

async function call(fn: string, args: Record<string, unknown>, f: FormData, fallback: string, okMsg: string) {
  const supabase = await db();
  const { error } = await supabase.rpc(fn, args);
  const to = back(f, fallback);
  revalidatePath('/', 'layout');
  redirect(withMsg(to, error ? 'err' : 'ok', error ? error.message : okMsg));
}

export async function moveStage(f: FormData) {
  await call('move_stage', { p_tenant: str(f, 'tenant', 64), p_to: str(f, 'stage', 20), p_note: str(f, 'note', 500) || null }, f, '/console/pipeline', 'Stage updated');
}

export async function setGate(f: FormData) {
  await call('set_gate', { p_tenant: str(f, 'tenant', 64), p_kind: str(f, 'kind', 40), p_status: str(f, 'status', 20), p_evidence: str(f, 'evidence', 1000) || null }, f, '/console', 'Gate updated');
}

export async function decideApproval(f: FormData) {
  await call('decide_approval', { p_id: str(f, 'id', 64), p_decision: str(f, 'decision', 30), p_note: str(f, 'note') || null }, f, '/console/approvals',
    str(f, 'decision', 30) === 'approved' ? 'Approved' : 'Changes requested');
}

export async function createCareRequest(f: FormData) {
  await call('create_care_request', { p_tenant: str(f, 'tenant', 64), p_kind: str(f, 'kind', 20), p_title: str(f, 'title', 140), p_detail: str(f, 'detail', 4000) || null },
    f, '/console/care', 'Request sent. The Genovus team will pick it up.');
}

export async function setCareStatus(f: FormData) {
  await call('set_care_status', { p_id: str(f, 'id', 64), p_status: str(f, 'status', 30) }, f, '/console/care', 'Request updated');
}

export async function setInquiryStatus(f: FormData) {
  await call('set_inquiry_status', { p_id: str(f, 'id', 64), p_status: str(f, 'status', 20) }, f, '/console/inquiries', 'Inquiry updated');
}

export async function convertInquiry(f: FormData) {
  const slug = str(f, 'slug', 64).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const supabase = await db();
  const { error } = await supabase.rpc('convert_inquiry', { p_id: str(f, 'id', 64), p_slug: slug });
  revalidatePath('/', 'layout');
  if (error) redirect(withMsg(back(f, '/console/inquiries'), 'err', error.message.includes('duplicate') ? 'That client address is taken; pick another.' : error.message));
  redirect(withMsg(`/console/clients/${slug}`, 'ok', 'Client created in Consult with a draft record'));
}

export async function saveRecord(f: FormData) {
  let data: unknown;
  try {
    data = JSON.parse(str(f, 'data', 50_000));
  } catch {
    redirect(withMsg(back(f, '/console'), 'err', 'The record is not valid JSON'));
  }
  await call('save_agent_record', { p_tenant: str(f, 'tenant', 64), p_data: data, p_note: str(f, 'note', 500) || null }, f, '/console', 'New record version saved');
}

/** Issue a welcome-package link for a database client. The full link is shown once; only its hash is kept. */
export async function issueWelcomeLink(f: FormData) {
  const tenant = str(f, 'tenant', 64);
  const to = back(f, '/console');
  const supabase = await db();
  const { data: allowed } = await supabase.rpc('has_role', { roles: ['admin', 'account_lead'] });
  if (!allowed) redirect(withMsg(to, 'err', 'Only an admin or account lead can issue a welcome link.'));
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
  if (error) redirect(withMsg(to, 'err', 'The link could not be created.'));
  await admin.from('audit_events').insert({ tenant_id: tenant, actor: auth.user?.id ?? null, actor_label: auth.user?.email ?? 'staff', action: 'welcome.link', subject: 'welcome link issued', prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  redirect(withMsg(to, 'ok', `Welcome link ready (shown once, copy it now): /welcome/${token}`));
}

/** Approve every listed team item in one go. Each still goes through decide_approval (role check + audit). */
export async function bulkApprove(f: FormData) {
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
  redirect(withMsg('/console/approvals', errors.size ? 'err' : 'ok', errors.size ? `Approved ${ok} of ${ids.length}. ${[...errors].join(' ')}` : `Approved ${ok} item${ok === 1 ? '' : 's'}.`));
}
