'use server';
// The client page's "Client email" panel: a note to a client written by a person on the team (a site that's up for
// review, what we need next), sent through the same outbox and Resend as every other Genovus email, now or at a set
// Eastern time. Outward: an admin or account lead taps Schedule. Until the outbox picks it up, Cancel stops it.
//  - scheduleClientEmailAction: one outbox row (template client_update); the first To is the recipient, any other
//    To and every Cc ride along as Cc. "Send me a test" sends the same email to the person tapping, now, without Cc.
//  - cancelClientEmailAction: a pending one becomes skipped (a send already under way can't be stopped).
import { revalidatePath } from 'next/cache';
import { db } from './supabase/server';
import { adminDb } from './supabase/admin';
import { easternAt } from './billing';
import type { ActionResult } from './actions';

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? '').trim().slice(0, max);
const done = (ok: string): ActionResult => ({ ok, at: Date.now() });
const fail = (err: string): ActionResult => ({ err, at: Date.now() });
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const emails = (s: string) => s.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
const et = (d: Date) => d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

async function allowed() {
  const supabase = await db();
  const { data } = await supabase.rpc('has_role', { roles: ['admin', 'account_lead'] });
  const { data: me } = await supabase.auth.getUser();
  return data ? me.user : null;
}

export async function scheduleClientEmailAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const me = await allowed();
  if (!me) return fail('Only an admin or account lead can send client email.');
  const test = f.get('intent') === 'test';
  const tenantId = str(f, 'tenant', 64);
  const subject = str(f, 'subject', 200), body = String(f.get('body') ?? '').replace(/\r\n/g, '\n').trim().slice(0, 20_000);
  const to = emails(str(f, 'to', 1000)), cc = emails(str(f, 'cc', 2000));
  if (!subject) return fail('Add a subject.');
  if (!body) return fail('Write the email.');
  if (/\[[A-Z][A-Z ]+\]/.test(subject + body)) return fail(`The email still has a placeholder: ${(subject + body).match(/\[[A-Z][A-Z ]+\]/)![0]}`);
  const bad = [...to, ...cc].find((e) => !EMAIL.test(e));
  if (bad) return fail(`“${bad}” isn’t an email address.`);
  if (!test && !to.length) return fail('Add who it goes to.');
  if (to.length + cc.length > 20) return fail('Twenty addresses at most.');
  let sendAt = new Date();
  if (!test) {
    const when = str(f, 'when', 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return fail('Pick a send time.');
    sendAt = easternAt(when);
    if (sendAt.getTime() < Date.now() - 60_000) return fail('That time has passed. Pick a later one.');
    if (sendAt.getTime() > Date.now() + 60 * 86_400_000) return fail('Pick a time in the next 60 days.');
  }
  const admin = adminDb();
  const { data: t } = await admin.from('tenants').select('id, name, is_sample').eq('id', tenantId).maybeSingle();
  if (!t) return fail('Client not found.');
  if (t.is_sample && !test) return fail('This is a sample client: send yourself a test instead.');
  const { postalAddress } = await import('./consult-followups');
  const [first, ...more] = test ? [me.email!.toLowerCase()] : to;
  const copy = test ? [] : [...new Set([...more, ...cc])].filter((e) => e !== first);
  const { data: row, error } = await admin.from('outbox').insert({
    tenant_id: t.id, to_email: first, template: 'client_update', send_after: sendAt.toISOString(),
    data: { subject: test ? `[Test] ${subject}` : subject, body, cc: copy.join(', '), address: await postalAddress(), by: me.email ?? '', test: test ? 'true' : '' },
    dedupe_key: `client-email:${t.id}:${crypto.randomUUID()}`,
  }).select('id').single();
  if (error) return fail(error.message);
  await admin.from('audit_events').insert({ tenant_id: t.id, actor: me.id, actor_label: me.email ?? 'staff', action: test ? 'client_email.test' : 'client_email.scheduled', subject, after: { outbox: row.id, to: first, cc: copy, send_after: sendAt.toISOString() }, prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  if (test) return done(`Test sent to ${first}. It arrives within a minute.`);
  const soon = sendAt.getTime() <= Date.now() + 60_000;
  return done(`${soon ? 'Sending now' : `Scheduled for ${et(sendAt)} Eastern`}: to ${first}${copy.length ? `, cc ${copy.join(', ')}` : ''}.`);
}

export async function cancelClientEmailAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const me = await allowed();
  if (!me) return fail('Only an admin or account lead can cancel client email.');
  const id = Number(str(f, 'id', 20)), tenantId = str(f, 'tenant', 64);
  if (!Number.isFinite(id)) return fail('Email not found.');
  const admin = adminDb();
  const { data } = await admin.from('outbox').update({ status: 'skipped', last_error: `canceled by ${me.email ?? 'staff'}` })
    .eq('id', id).eq('tenant_id', tenantId).eq('template', 'client_update').eq('status', 'pending').select('id, data').maybeSingle();
  if (!data) return fail('It already went out (or is going out now), so it can’t be canceled.');
  await admin.from('audit_events').insert({ tenant_id: tenantId, actor: me.id, actor_label: me.email ?? 'staff', action: 'client_email.canceled', subject: String((data.data as Record<string, string>).subject ?? ''), after: { outbox: id }, prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  return done('Canceled. It won’t go out.');
}
