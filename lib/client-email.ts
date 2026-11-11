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
    .eq('id', id).eq('tenant_id', tenantId).in('template', ['client_update', 'site_review']).eq('status', 'pending').select('id, data').maybeSingle();
  if (!data) return fail('It already went out (or is going out now), so it can’t be canceled.');
  await admin.from('audit_events').insert({ tenant_id: tenantId, actor: me.id, actor_label: me.email ?? 'staff', action: 'client_email.canceled', subject: String((data.data as Record<string, string>).subject ?? ''), after: { outbox: id }, prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  return done('Canceled. It won’t go out.');
}

// "Your website is ready for review" (template site_review, lib/email-site-review.ts): the site card, a short note,
// and the welcome-form items the team ticks (each a button to that field on the client's Welcome page), plus
// questions to answer by reply and what happens next. Built from the client's record when it's scheduled.
export async function scheduleSiteReviewAction(_: ActionResult, f: FormData): Promise<ActionResult> {
  const me = await allowed();
  if (!me) return fail('Only an admin or account lead can send client email.');
  const test = f.get('intent') === 'test';
  const tenantId = str(f, 'tenant', 64);
  const to = emails(str(f, 'to', 1000)), cc = emails(str(f, 'cc', 2000));
  const note = String(f.get('note') ?? '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
  const siteUrl = str(f, 'site', 300).replace(/\/$/, '');
  const lines = (k: string) => String(f.get(k) ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 10);
  if (!/^https:\/\/[^\s]+$/.test(siteUrl)) return fail('Add the site address (https://…).');
  if (!note) return fail('Write a short note.');
  const all = `${note}\n${lines('reply').join('\n')}\n${lines('next').join('\n')}`;
  if (/\[[A-Z][A-Z ]+\]/.test(all)) return fail(`The email still has a placeholder: ${all.match(/\[[A-Z][A-Z ]+\]/)![0]}`);
  const bad = [...to, ...cc].find((e) => !EMAIL.test(e));
  if (bad) return fail(`“${bad}” isn’t an email address.`);
  if (!test && !to.length) return fail('Add who it goes to.');
  let sendAt = new Date();
  if (!test) {
    const when = str(f, 'when', 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return fail('Pick a send time.');
    sendAt = easternAt(when);
    if (sendAt.getTime() < Date.now() - 60_000) return fail('That time has passed. Pick a later one.');
    if (sendAt.getTime() > Date.now() + 60 * 86_400_000) return fail('Pick a time in the next 60 days.');
  }
  const admin = adminDb();
  const { data: t } = await admin.from('tenants').select('id, name, slug, is_sample').eq('id', tenantId).maybeSingle();
  if (!t) return fail('Client not found.');
  if (t.is_sample && !test) return fail('This is a sample client: send yourself a test instead.');
  const { count: members } = await admin.from('memberships').select('user_id', { count: 'exact', head: true }).eq('tenant_id', t.id);
  if (!test && !members) return fail('Invite the client to their dashboard first (People panel): every button in this email opens it.');
  const { welcomeData } = await import('./welcome');
  const w = await welcomeData(t.id as string, t.slug as string);
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  const dashboardUrl = `${origin}/app/${t.slug}/welcome`;
  const picked = new Set(f.getAll('item').map(String));
  const asks = [
    ...(f.get('copy') ? [{ label: 'Review your site copy', help: str(f, 'copy_help', 300) || 'Read it through. Reply “approved”, or tell us what to change.', url: siteUrl, cta: 'Review' }] : []),
    ...w.status.items.filter((i) => !i.done && picked.has(i.key)).map((i) => ({ label: i.label, help: str(f, `help_${i.key}`, 300) || i.help, url: `${dashboardUrl}?item=${i.key}#wl-${i.key}` })),
  ];
  const review = {
    first: w.first, agency: t.name as string, siteUrl, siteImage: f.get('card') ? `${siteUrl}/opengraph-image` : undefined, note, dashboardUrl,
    asks, replyAsks: lines('reply'), done: w.progress.filled, total: w.progress.total, next: lines('next'),
    address: await (await import('./consult-followups')).postalAddress(), sender: str(f, 'sender', 60) || undefined,
  };
  const { siteReviewEmail } = await import('./email-site-review');
  const subject = str(f, 'subject', 200) || siteReviewEmail(review, origin).subject;
  const [first, ...more] = test ? [me.email!.toLowerCase()] : to;
  const copy = test ? [] : [...new Set([...more, ...cc])].filter((e) => e !== first);
  const { data: row, error } = await admin.from('outbox').insert({
    tenant_id: t.id, to_email: first, template: 'site_review', send_after: sendAt.toISOString(),
    data: { subject: test ? `[Test] ${subject}` : subject, review: JSON.stringify(review), cc: copy.join(', '), by: me.email ?? '', test: test ? 'true' : '' },
    dedupe_key: `site-review:${t.id}:${crypto.randomUUID()}`,
  }).select('id').single();
  if (error) return fail(error.message);
  await admin.from('audit_events').insert({ tenant_id: t.id, actor: me.id, actor_label: me.email ?? 'staff', action: test ? 'client_email.test' : 'client_email.scheduled', subject, after: { outbox: row.id, to: first, cc: copy, send_after: sendAt.toISOString(), asks: asks.map((a) => a.label) }, prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  if (test) return done(`Test sent to ${first}. It arrives within a minute.`);
  const soon = sendAt.getTime() <= Date.now() + 60_000;
  return done(`${soon ? 'Sending now' : `Scheduled for ${et(sendAt)} Eastern`}: to ${first}${copy.length ? `, cc ${copy.join(', ')}` : ''}.`);
}
