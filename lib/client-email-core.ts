// Client email, one path for every caller: the client page's Client email panel (lib/client-email.ts, a person's tap)
// and the team's ops endpoint (app/api/ops/client-emails, the ops key, for emails prepared in a working session and
// approved there). Both schedule through the outbox (sent by the outbox cron through Resend from hello@genovus.io),
// with the same checks: a leftover [PLACEHOLDER], bad addresses, the send window, sample clients, and (site review)
// the client being on their dashboard, since every button opens it. dry renders the email without queuing anything.
//  - note (template client_update): a note written freely.
//  - site review (template site_review, lib/email-site-review.ts): the site card, a short note, the ticked open
//    welcome-form items each with a button to that field, reply questions and next steps.
// Each send keeps Resend's message id on the row (data.provider_id, set by the outbox cron): the proof it went out.
import 'server-only';
import { adminDb } from './supabase/admin';
import { easternAt } from './billing';
import { outboxEmail } from './email';

export type Actor = { id: string | null; email: string; label: string };
export type Rendered = { to: string; cc: string[]; subject: string; html: string; text: string; sendAt: string };
export type CoreResult = { ok: true; message: string; outboxId?: number; preview?: Rendered } | { ok: false; error: string };

const str = (f: FormData, k: string, max = 200) => String(f.get(k) ?? '').trim().slice(0, max);
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const PLACEHOLDER = /\[[A-Z][A-Z ]+\]/;
const emails = (s: string) => s.split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
export const etLabel = (d: Date | string) => new Date(d).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const no = (error: string): CoreResult => ({ ok: false, error });

/** Recipients and send time, shared by both kinds. A test goes only to the actor, now. */
function envelope(f: FormData, actor: Actor): { error: string } | { test: boolean; first: string; copy: string[]; sendAt: Date } {
  const test = f.get('intent') === 'test';
  const to = emails(str(f, 'to', 1000)), cc = emails(str(f, 'cc', 2000));
  const bad = [...to, ...cc].find((e) => !EMAIL.test(e));
  if (bad) return { error: `“${bad}” isn’t an email address.` };
  if (!test && !to.length) return { error: 'Add who it goes to.' };
  if (to.length + cc.length > 20) return { error: 'Twenty addresses at most.' };
  if (test && !EMAIL.test(actor.email)) return { error: 'A test needs an address to go to.' };
  let sendAt = new Date();
  if (!test) {
    const when = str(f, 'when', 16);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return { error: 'Pick a send time.' };
    sendAt = easternAt(when);
    if (sendAt.getTime() < Date.now() - 60_000) return { error: 'That time has passed. Pick a later one.' };
    if (sendAt.getTime() > Date.now() + 60 * 86_400_000) return { error: 'Pick a time in the next 60 days.' };
  }
  const [first, ...more] = test ? [actor.email.toLowerCase()] : to;
  const copy = test ? [] : [...new Set([...more, ...cc])].filter((e) => e !== first);
  return { test, first, copy, sendAt };
}

async function tenantOf(id: string) {
  const { data } = await adminDb().from('tenants').select('id, name, slug, is_sample').eq('id', id).maybeSingle();
  return data as { id: string; name: string; slug: string; is_sample: boolean } | null;
}

/** Queue it (or, dry, just render it): one outbox row, its audit entry, and the message the caller shows. */
async function queue(t: { id: string; name: string }, template: 'client_update' | 'site_review', data: Record<string, string>, env: { test: boolean; first: string; copy: string[]; sendAt: Date }, actor: Actor, dry: boolean, extra: Record<string, unknown> = {}): Promise<CoreResult> {
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  const full = { ...data, cc: env.copy.join(', '), by: actor.label, test: env.test ? 'true' : '' };
  const mail = outboxEmail(template, env.first, full, origin);
  if (!mail) return no('That email couldn’t be built.');
  const preview: Rendered = { to: env.first, cc: mail.cc ?? [], subject: mail.subject, html: mail.html, text: mail.text, sendAt: env.sendAt.toISOString() };
  if (dry) return { ok: true, message: `Preview only, nothing queued: to ${env.first}${env.copy.length ? `, cc ${env.copy.join(', ')}` : ''}, ${env.test ? 'now (test)' : `${etLabel(env.sendAt)} Eastern`}.`, preview };
  const admin = adminDb();
  const { data: row, error } = await admin.from('outbox').insert({
    tenant_id: t.id, to_email: env.first, template, send_after: env.sendAt.toISOString(), data: full,
    dedupe_key: `${template === 'site_review' ? 'site-review' : 'client-email'}:${t.id}:${crypto.randomUUID()}`,
  }).select('id').single();
  if (error) return no(error.message);
  await admin.from('audit_events').insert({ tenant_id: t.id, actor: actor.id, actor_label: actor.label, action: env.test ? 'client_email.test' : 'client_email.scheduled', subject: mail.subject, after: { outbox: row.id, template, to: env.first, cc: env.copy, send_after: env.sendAt.toISOString(), ...extra }, prev_hash: '', hash: '' });
  const soon = env.sendAt.getTime() <= Date.now() + 60_000;
  return { ok: true, outboxId: row.id as number, preview,
    message: env.test ? `Test sent to ${env.first}. It arrives within a minute.` : `${soon ? 'Sending now' : `Scheduled for ${etLabel(env.sendAt)} Eastern`}: to ${env.first}${env.copy.length ? `, cc ${env.copy.join(', ')}` : ''}.` };
}

export async function scheduleNote(f: FormData, actor: Actor, dry = false): Promise<CoreResult> {
  const subject = str(f, 'subject', 200), body = String(f.get('body') ?? '').replace(/\r\n/g, '\n').trim().slice(0, 20_000);
  if (!subject) return no('Add a subject.');
  if (!body) return no('Write the email.');
  if (PLACEHOLDER.test(subject + body)) return no(`The email still has a placeholder: ${(subject + body).match(PLACEHOLDER)![0]}`);
  const env = envelope(f, actor);
  if ('error' in env) return no(env.error);
  const t = await tenantOf(str(f, 'tenant', 64));
  if (!t) return no('Client not found.');
  if (t.is_sample && !env.test) return no('This is a sample client: send yourself a test instead.');
  const { postalAddress } = await import('./consult-followups');
  return queue(t, 'client_update', { subject: env.test ? `[Test] ${subject}` : subject, body, address: await postalAddress() }, env, actor, dry);
}

export async function scheduleSiteReview(f: FormData, actor: Actor, dry = false): Promise<CoreResult> {
  const note = String(f.get('note') ?? '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
  const siteUrl = str(f, 'site', 300).replace(/\/$/, '');
  const lines = (k: string) => String(f.get(k) ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 10);
  if (!/^https:\/\/[^\s]+$/.test(siteUrl)) return no('Add the site address (https://…).');
  if (!note) return no('Write a short note.');
  const helps = [...f.keys()].filter((k) => k.startsWith('help_') || k === 'copy_help').map((k) => str(f, k, 300));
  const all = [note, ...lines('reply'), ...lines('next'), ...helps, str(f, 'subject', 200)].join('\n');
  if (PLACEHOLDER.test(all)) return no(`The email still has a placeholder: ${all.match(PLACEHOLDER)![0]}`);
  const env = envelope(f, actor);
  if ('error' in env) return no(env.error);
  const t = await tenantOf(str(f, 'tenant', 64));
  if (!t) return no('Client not found.');
  if (t.is_sample && !env.test) return no('This is a sample client: send yourself a test instead.');
  const admin = adminDb();
  const { count: members } = await admin.from('memberships').select('user_id', { count: 'exact', head: true }).eq('tenant_id', t.id);
  if (!env.test && !dry && !members) return no('Invite the client to their dashboard first (People panel): every button in this email opens it.');
  const { welcomeData } = await import('./welcome');
  const w = await welcomeData(t.id, t.slug);
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  const dashboardUrl = `${origin}/app/${t.slug}/welcome`;
  const picked = new Set(f.getAll('item').map(String));
  const unknown = [...picked].filter((k) => !w.status.items.some((i) => i.key === k));
  if (unknown.length) return no(`Not on the welcome form: ${unknown.join(', ')}.`);
  const asks = [
    ...(f.get('copy') ? [{ label: 'Review your site copy', help: str(f, 'copy_help', 300) || 'Read it through. Reply “approved”, or tell us what to change.', url: siteUrl, cta: 'Review' }] : []),
    ...w.status.items.filter((i) => !i.done && picked.has(i.key)).map((i) => ({ label: i.label, help: str(f, `help_${i.key}`, 300) || i.help, url: `${dashboardUrl}?item=${i.key}#wl-${i.key}` })),
  ];
  const review = {
    first: w.first, agency: t.name, siteUrl, siteImage: f.get('card') ? `${siteUrl}/opengraph-image` : undefined, note, dashboardUrl,
    asks, replyAsks: lines('reply'), done: w.progress.filled, total: w.progress.total, next: lines('next'),
    address: await (await import('./consult-followups')).postalAddress(), sender: str(f, 'sender', 60) || undefined,
  };
  const { siteReviewEmail } = await import('./email-site-review');
  const subject = str(f, 'subject', 200) || siteReviewEmail(review, origin).subject;
  const res = await queue(t, 'site_review', { subject: env.test ? `[Test] ${subject}` : subject, review: JSON.stringify(review) }, env, actor, dry, { asks: asks.map((a) => a.label) });
  // A ticked item that's already answered is left out: say so, so nobody wonders where it went.
  const skipped = [...picked].filter((k) => w.status.items.find((i) => i.key === k)?.done);
  return res.ok && skipped.length ? { ...res, message: `${res.message} Left out (already answered): ${skipped.join(', ')}.` } : res;
}

export async function cancelClientEmail(id: number, tenantId: string | null, actor: Actor): Promise<CoreResult> {
  if (!Number.isFinite(id)) return no('Email not found.');
  const admin = adminDb();
  let q = admin.from('outbox').update({ status: 'skipped', last_error: `canceled by ${actor.label}` })
    .eq('id', id).in('template', ['client_update', 'site_review']).eq('status', 'pending');
  if (tenantId) q = q.eq('tenant_id', tenantId);
  const { data } = await q.select('id, tenant_id, data').maybeSingle();
  if (!data) return no('It already went out (or is going out now), so it can’t be canceled.');
  await admin.from('audit_events').insert({ tenant_id: data.tenant_id, actor: actor.id, actor_label: actor.label, action: 'client_email.canceled', subject: String((data.data as Record<string, string>).subject ?? ''), after: { outbox: id }, prev_hash: '', hash: '' });
  return { ok: true, message: 'Canceled. It won’t go out.' };
}

export type ClientEmailRow = { id: number; template: string; to: string; cc: string; subject: string; test: boolean; status: string; sendAfter: string; sentAt: string | null; attempts: number; error: string | null; providerId: string | null; by: string };

/** A client's recent client emails (tests included), newest first: what's scheduled, sent (with Resend's id) or failed. */
export async function listClientEmails(tenantId: string, limit = 20): Promise<ClientEmailRow[]> {
  const { data } = await adminDb().from('outbox').select('id, template, to_email, data, status, send_after, sent_at, attempts, last_error')
    .eq('tenant_id', tenantId).in('template', ['client_update', 'site_review']).order('id', { ascending: false }).limit(limit);
  return (data ?? []).map((r) => {
    const d = r.data as Record<string, string>;
    return { id: r.id as number, template: r.template as string, to: r.to_email as string, cc: d.cc ?? '', subject: d.subject ?? '', test: d.test === 'true', status: r.status as string, sendAfter: r.send_after as string, sentAt: (r.sent_at as string) ?? null, attempts: r.attempts as number, error: (r.last_error as string) ?? null, providerId: d.provider_id || null, by: d.by ?? '' };
  });
}
