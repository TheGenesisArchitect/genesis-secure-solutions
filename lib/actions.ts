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
