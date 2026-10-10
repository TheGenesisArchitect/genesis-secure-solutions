'use server';
// Staff tools for getting an agency live: a lead key for its website (shown once; only its hash is stored) and a
// one-time sign-in link for a member of the agency, as the fallback when an invitation email is slow or filtered.
import { createHash, randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';

type Out = { ok?: string; err?: string; secret?: string };

export async function issueLeadKey(tenantId: string, label: string): Promise<Out> {
  await requireStaff();
  if (!/^[0-9a-f-]{36}$/.test(tenantId)) return { err: 'Unknown agency.' };
  const key = `gnv_lk_${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(key).digest('hex');
  const { error } = await (await db()).rpc('issue_lead_key', { p_tenant: tenantId, p_label: label.slice(0, 60), p_hash: hash });
  if (error) return { err: error.message };
  return { ok: 'Lead key issued. Copy it now: it is not shown again.', secret: key };
}

export async function revokeLeadKey(id: string): Promise<Out> {
  await requireStaff();
  const { error } = await (await db()).rpc('revoke_lead_key', { p_id: id });
  return error ? { err: error.message } : { ok: 'Lead key revoked: the website can no longer send leads with it.' };
}

/** A one-time sign-in link for someone who is already a member of this agency (works once, expires in an hour). */
export async function staffSigninLink(tenantId: string, email: string): Promise<Out> {
  await requireStaff();
  const addr = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) return { err: 'Enter the member’s email.' };
  const admin = adminDb();
  const { data: uid } = await admin.rpc('signin_user_id', { p_email: addr });
  if (!uid) return { err: 'That email has no access yet: send them an invitation first.' };
  const { data: member } = await admin.from('memberships').select('role').eq('tenant_id', tenantId).eq('user_id', uid).maybeSingle();
  if (!member) return { err: 'That person is not a member of this agency.' };
  const { data: t } = await admin.from('tenants').select('slug').eq('id', tenantId).single();
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: addr });
  if (error || !data?.properties?.hashed_token) return { err: error?.message ?? 'Could not create a link.' };
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const link = `${origin}/auth/continue?t=${encodeURIComponent(data.properties.hashed_token)}&next=${encodeURIComponent(`/app/${t?.slug ?? ''}`)}`;
  const { error: logErr } = await (await db()).rpc('log_staff_signin_link', { p_tenant: tenantId, p_email: addr });
  if (logErr) return { err: `Not issued: the audit entry failed (${logErr.message}).` };
  return { ok: 'One-time sign-in link: send it to them directly. It works once and expires in an hour.', secret: link };
}

/** Turn modules on for one agency (staff): for `days` days as a trial, or with no end date when days is null. */
export async function grantModules(tenantId: string, keys: string[], days: number | null, reason: string): Promise<Out> {
  await requireStaff();
  const clean = keys.filter((k) => /^[a-z0-9-]{2,40}$/.test(k));
  if (!clean.length) return { err: 'Pick at least one module.' };
  const until = days ? new Date(Date.now() + days * 86_400_000).toISOString() : null;
  const { error } = await (await db()).rpc('grant_modules', { p_tenant: tenantId, p_keys: clean, p_until: until, p_reason: reason.slice(0, 200) });
  return error ? { err: error.message } : { ok: days ? `On for ${days} days: ${clean.length} module${clean.length > 1 ? 's' : ''}.` : `On with no end date: ${clean.length} module${clean.length > 1 ? 's' : ''}.` };
}

export async function revokeModules(tenantId: string, keys: string[]): Promise<Out> {
  await requireStaff();
  const { error } = await (await db()).rpc('revoke_modules', { p_tenant: tenantId, p_keys: keys });
  return error ? { err: error.message } : { ok: 'Turned off.' };
}
