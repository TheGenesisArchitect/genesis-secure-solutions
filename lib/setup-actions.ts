'use server';
// Admin-only changes to our own domains and email. Each one re-computes the plan on the server (never
// trusts the form), applies it, and writes an audit entry.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireStaff } from './session';
import { adminDb } from './supabase/admin';
import { addDomain, findDomain, verifyDomain } from './resend-domains';
import { createRecords, deleteRecord } from './ionos';
import { emailPlan, sitePlan, SITE_DOMAINS } from './dns-plan';

const back = (k: 'ok' | 'err', m: string) => redirect(`/console/setup?${k}=${encodeURIComponent(m)}`);

async function admin() {
  const v = await requireStaff();
  if (v.staff.role !== 'admin') back('err', 'Only a platform admin can change domains and email.');
  return v;
}

async function audit(actor: { userId: string; email: string }, action: string, subject: string, after: unknown) {
  await adminDb().from('audit_events').insert({ tenant_id: null, actor: actor.userId, actor_label: actor.email, action, subject, after, prev_hash: '', hash: '' });
}

export async function registerEmailDomain(f: FormData) {
  const v = await admin();
  const domain = String(f.get('domain') ?? 'genovus.io');
  try {
    if (!(await findDomain(domain))) await addDomain(domain);
    await audit(v, 'email.domain.register', domain, { provider: 'Resend' });
  } catch (e) {
    back('err', e instanceof Error ? e.message : 'Resend request failed');
  }
  revalidatePath('/console/setup');
  back('ok', `${domain} registered with Resend. Review the records below, then publish them.`);
}

export async function publishEmailRecords(f: FormData) {
  const v = await admin();
  const domain = String(f.get('domain') ?? 'genovus.io');
  try {
    const { plan, resend } = await emailPlan(domain);
    if (!plan.zoneId || !resend) back('err', plan.note ?? 'Nothing to publish.');
    if (plan.add.length) await createRecords(plan.zoneId!, plan.add);
    await verifyDomain(resend!.id);
    await audit(v, 'dns.email.publish', domain, { added: plan.add });
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    back('err', e instanceof Error ? e.message : 'Publishing failed');
  }
  revalidatePath('/console/setup');
  back('ok', `Email records published for ${domain}. Verification usually completes within minutes.`);
}

export async function verifyEmailDomain(f: FormData) {
  await admin();
  const domain = String(f.get('domain') ?? 'genovus.io');
  try {
    const d = await findDomain(domain);
    if (d) await verifyDomain(d.id);
  } catch (e) {
    back('err', e instanceof Error ? e.message : 'Verification request failed');
  }
  revalidatePath('/console/setup');
  back('ok', 'Verification requested. Refresh in a minute to see the status.');
}

export async function pointSiteDomain(f: FormData) {
  const v = await admin();
  const domain = String(f.get('domain') ?? '');
  const def = SITE_DOMAINS.find((d) => d.domain === domain);
  if (!def) back('err', 'Unknown domain.');
  try {
    const plan = await sitePlan(def!.domain, def!.subs);
    if (!plan.zoneId) back('err', plan.note ?? 'No DNS zone.');
    for (const r of plan.remove) if (r.id) await deleteRecord(plan.zoneId!, r.id);
    if (plan.add.length) await createRecords(plan.zoneId!, plan.add);
    await audit(v, 'dns.site.point', domain, { removed: plan.remove, added: plan.add });
  } catch (e) {
    if ((e as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw e;
    back('err', e instanceof Error ? e.message : 'DNS change failed');
  }
  revalidatePath('/console/setup');
  back('ok', `${domain} now points at Genovus. SSL is issued automatically once DNS spreads (minutes to an hour).`);
}
