'use server';
// Invite someone to an agency dashboard. The caller must be Genovus staff or that agency's owner (checked as
// the caller, through row-level security); only then does the server-only service key create the account,
// add the membership, send a branded invitation that lands them signed in, and write the audit entry.
// Owners can add office staff; only staff can add another owner.
import { headers } from 'next/headers';
import type { ActionResult } from './actions';
import { revalidatePath } from 'next/cache';
import { db } from './supabase/server';
import { adminDb } from './supabase/admin';
import { emailConfigured, inviteEmail, sendEmail } from './email';

export async function inviteMember(_: ActionResult, f: FormData): Promise<ActionResult> {
  const tenant = String(f.get('tenant') ?? '');
  const email = String(f.get('email') ?? '').trim().toLowerCase();
  const role = String(f.get('role') ?? 'staff') === 'owner' ? 'owner' : 'staff';

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return { err: 'Enter a valid email address.', at: Date.now() };
  const me = await db();
  const [{ data: staff }, { data: owner }, { data: auth }, { data: t }] = await Promise.all([
    me.rpc('is_staff'), me.rpc('is_owner', { t: tenant }), me.auth.getUser(), me.from('tenants').select('name, slug').eq('id', tenant).maybeSingle(),
  ]);
  if (!t || (!staff && !(owner && role === 'staff'))) return { err: 'You do not have permission to invite to this agency.', at: Date.now() };

  const admin = adminDb();
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  let { data: userId } = await admin.rpc('user_id_by_email', { p_email: email });
  if (!userId) {
    if (emailConfigured()) userId = (await admin.auth.admin.createUser({ email, email_confirm: true })).data.user?.id ?? null;
    else userId = (await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(`/app/${t!.slug}`)}` })).data.user?.id ?? null;
  }
  if (!userId) return { err: 'The invitation could not be sent. Try again in a minute.', at: Date.now() };

  const { error } = await admin.from('memberships').upsert({ tenant_id: tenant, user_id: userId, role }, { onConflict: 'tenant_id,user_id' });
  if (error) return { err: 'Access could not be saved. Tell the Genovus team.', at: Date.now() };

  if (emailConfigured()) {
    const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    const p = data?.properties;
    const inviter = (await me.from('staff').select('display_name').eq('user_id', auth.user!.id).maybeSingle()).data?.display_name ?? auth.user?.email ?? 'Genovus';
    const sent = p?.hashed_token && p.email_otp
      ? await sendEmail(inviteEmail(email, t!.name, inviter, `${origin}/auth/continue?t=${encodeURIComponent(p.hashed_token)}&next=${encodeURIComponent(`/app/${t!.slug}`)}`, p.email_otp, origin))
      : { ok: false as const, error: 'no link' };
    if (!sent.ok) return { err: `Access was added, but the email did not send (${sent.error}). They can sign in at /signin.`, at: Date.now() };
  }
  await admin.from('audit_events').insert({
    tenant_id: tenant, actor: auth.user?.id ?? null, actor_label: auth.user?.email ?? 'unknown', action: 'member.invite',
    subject: email, after: { role }, prev_hash: '', hash: '',
  });
  revalidatePath('/', 'layout');
  return { ok: `Invitation sent to ${email}.`, at: Date.now() };
}
