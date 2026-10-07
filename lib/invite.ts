'use server';
// Invite someone to an agency dashboard. The caller must be Genovus staff or that agency's owner (checked as
// the caller, through row-level security); only then does the server-only service key create the account,
// add the membership and write the audit entry. Owners can add office staff; only staff can add another owner.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from './supabase/server';
import { adminDb } from './supabase/admin';

export async function inviteMember(f: FormData) {
  const tenant = String(f.get('tenant') ?? '');
  const email = String(f.get('email') ?? '').trim().toLowerCase();
  const role = String(f.get('role') ?? 'staff') === 'owner' ? 'owner' : 'staff';
  const back = String(f.get('back') ?? '/');
  const safe = back.startsWith('/') && !back.startsWith('//') ? back : '/';
  const to = (k: 'ok' | 'err', m: string) => redirect(`${safe}${safe.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(m)}`);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) to('err', 'Enter a valid email address.');
  const me = await db();
  const [{ data: staff }, { data: owner }, { data: auth }] = await Promise.all([me.rpc('is_staff'), me.rpc('is_owner', { t: tenant }), me.auth.getUser()]);
  if (!staff && !(owner && role === 'staff')) to('err', 'You do not have permission to invite to this agency.');

  const admin = adminDb();
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`;
  let userId: string | undefined;
  const invited = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${origin}/auth/confirm` });
  if (invited.data.user) userId = invited.data.user.id;
  else {
    // Already has an account (for example, staff of two agencies): find it and add the membership.
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
      if (data.users.length < 200) break;
    }
  }
  if (!userId) to('err', 'The invitation could not be sent. Try again in a minute.');

  const { error } = await admin.from('memberships').upsert({ tenant_id: tenant, user_id: userId, role }, { onConflict: 'tenant_id,user_id' });
  if (error) to('err', 'The invitation was sent, but the access could not be saved. Tell the Genovus team.');
  await admin.from('audit_events').insert({
    tenant_id: tenant, actor: auth.user?.id ?? null, actor_label: auth.user?.email ?? 'unknown', action: 'member.invite',
    subject: email, after: { role }, prev_hash: '', hash: '',
  });
  revalidatePath('/', 'layout');
  to('ok', `Invitation sent to ${email}.`);
}
