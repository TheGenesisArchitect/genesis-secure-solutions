'use server';
// Every dashboard write. Each one calls a database function that checks the caller's permission and
// writes the audit log, so the rules hold even if a form is replayed or forged.
// Writes return a result (shown as a toast) instead of redirecting, so the page updates in place and
// keeps the scroll position. Only actions that move you somewhere new (converting an inquiry) redirect.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from './supabase/server';
import { quoteUpgrade, careName, careRate, monthEnd, daysInMonth, businessToday } from './billing';

export type ActionResult = { ok?: string; err?: string; sticky?: boolean; at: number } | null;

const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? '').trim().slice(0, max);
const done = (ok: string, sticky = false): ActionResult => ({ ok, sticky, at: Date.now() });
const fail = (err: string): ActionResult => ({ err, at: Date.now() });

async function call(fn: string, args: Record<string, unknown>, okMsg: string): Promise<ActionResult> {
  const supabase = await db();
  const { error } = await supabase.rpc(fn, args);
  revalidatePath('/', 'layout');
  return error ? fail(error.message) : done(okMsg);
}

export async function moveStage(_: ActionResult, f: FormData) {
  return call('move_stage', { p_tenant: str(f, 'tenant', 64), p_to: str(f, 'stage', 20), p_note: str(f, 'note', 500) || null }, 'Stage updated');
}

export async function setGate(_: ActionResult, f: FormData) {
  return call('set_gate', { p_tenant: str(f, 'tenant', 64), p_kind: str(f, 'kind', 40), p_status: str(f, 'status', 20), p_evidence: str(f, 'evidence', 1000) || null }, 'Gate updated');
}

export async function decideApproval(_: ActionResult, f: FormData) {
  return call('decide_approval', { p_id: str(f, 'id', 64), p_decision: str(f, 'decision', 30), p_note: str(f, 'note') || null },
    str(f, 'decision', 30) === 'approved' ? 'Approved' : 'Changes requested');
}

export async function createCareRequest(_: ActionResult, f: FormData) {
  return call('create_care_request', { p_tenant: str(f, 'tenant', 64), p_kind: str(f, 'kind', 20), p_title: str(f, 'title', 140), p_detail: str(f, 'detail', 4000) || null },
    'Request sent. The Genovus team will pick it up.');
}

export async function setCareStatus(_: ActionResult, f: FormData) {
  return call('set_care_status', { p_id: str(f, 'id', 64), p_status: str(f, 'status', 30) }, 'Request updated');
}

export async function setInquiryStatus(_: ActionResult, f: FormData) {
  return call('set_inquiry_status', { p_id: str(f, 'id', 64), p_status: str(f, 'status', 20) }, 'Inquiry updated');
}

export async function convertInquiry(_: ActionResult, f: FormData): Promise<ActionResult> {
  const slug = str(f, 'slug', 64).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const supabase = await db();
  const { error } = await supabase.rpc('convert_inquiry', { p_id: str(f, 'id', 64), p_slug: slug });
  revalidatePath('/', 'layout');
  if (error) return fail(error.message.includes('duplicate') ? 'That client address is taken; pick another.' : error.message);
  redirect(`/console/clients/${slug}?ok=${encodeURIComponent('Client created in Consult with a draft record')}`);
}

export async function saveRecord(_: ActionResult, f: FormData) {
  let data: unknown;
  try {
    data = JSON.parse(str(f, 'data', 50_000));
  } catch {
    return fail('The record is not valid JSON');
  }
  return call('save_agent_record', { p_tenant: str(f, 'tenant', 64), p_data: data, p_note: str(f, 'note', 500) || null }, 'New record version saved');
}

/** Issue a welcome-package link for a database client. The full link is shown once; only its hash is kept. */
export async function issueWelcomeLink(_: ActionResult, f: FormData): Promise<ActionResult> {
  const tenant = str(f, 'tenant', 64);
  const supabase = await db();
  const { data: allowed } = await supabase.rpc('has_role', { roles: ['admin', 'account_lead'] });
  if (!allowed) return fail('Only an admin or account lead can issue a welcome link.');
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
  if (error) return fail('The link could not be created.');
  await admin.from('audit_events').insert({ tenant_id: tenant, actor: auth.user?.id ?? null, actor_label: auth.user?.email ?? 'staff', action: 'welcome.link', subject: 'welcome link issued', prev_hash: '', hash: '' });
  revalidatePath('/', 'layout');
  return done(`Welcome link ready (shown once, copy it now): /welcome/${token}`, true);
}

/** Approve every listed team item in one go. Each still goes through decide_approval (role check + audit). */
export async function bulkApprove(_: ActionResult, f: FormData): Promise<ActionResult> {
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
  return errors.size ? fail(`Approved ${ok} of ${ids.length}. ${[...errors].join(' ')}`) : done(`Approved ${ok} item${ok === 1 ? '' : 's'}.`);
}

// ---------- billing (Mercury) ----------
const cents = (v: string) => Math.round(Number(v.replace(/[$,\s]/g, '')) * 100);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dateOr = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + 'T00:00:00Z') : new Date(businessToday() + 'T00:00:00Z'));
const fmt = (c: number) => (c < 0 ? '−' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Deposit, balance, care or a custom ("Other") invoice with up to three line items. */
export async function createInvoice(_: ActionResult, f: FormData): Promise<ActionResult> {
  const kind = str(f, 'kind', 20);
  const lines = [1, 2, 3].map((i) => ({ label: str(f, `line${i}`, 120), cents: cents(str(f, `amount${i}`, 20) || '0') })).filter((l) => l.label && l.cents);
  const amount = lines.length ? lines.reduce((s, l) => s + l.cents, 0) : cents(str(f, 'amount', 20) || '0');
  if (!(amount > 0)) return fail('Enter an amount (or line items) above zero.');
  if (kind === 'custom' && !str(f, 'note', 300) && !lines.length) return fail('Describe the custom invoice.');
  return call('create_invoice', {
    p_tenant: str(f, 'tenant', 64), p_kind: kind, p_amount_cents: amount, p_note: str(f, 'note', 300) || null, p_due: str(f, 'due', 10) || null,
    p_lines: lines,
  }, 'Invoice drafted. Add its Mercury payment link to send it.');
}

export async function createUpgradeInvoice(_: ActionResult, f: FormData): Promise<ActionResult> {
  const tenant = str(f, 'tenant', 64), to = str(f, 'to', 20), on = dateOr(str(f, 'on', 10));
  const supabase = await db();
  const [{ data: t }, { data: paid }] = await Promise.all([
    supabase.from('tenants').select('plan, care_active, care_rate_cents').eq('id', tenant).single(),
    supabase.from('invoices').select('amount_cents, kind, status').eq('tenant_id', tenant).in('kind', ['deposit', 'balance', 'upgrade']),
  ]);
  if (!t) return fail('Client not found.');
  const setupPaid = (paid ?? []).filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount_cents, 0);
  const unpaid = (paid ?? []).filter((i) => i.kind !== 'upgrade' && (i.status === 'draft' || i.status === 'open')).reduce((s, i) => s + i.amount_cents, 0);
  const q = quoteUpgrade(t, setupPaid, to, on, unpaid);
  if (!q) return fail('Pick Growth or Premium.');
  if (q.total <= 0) return fail('Nothing to charge: what they have paid already covers this plan.');
  // The upgrade replaces any unpaid setup invoice. One already sent through Mercury is cancelled there first,
  // so it can never be paid by mistake; one sent by a pasted link must be cancelled in Mercury by hand.
  const { data: superseded } = await supabase.from('invoices').select('id, number, status, mercury_invoice_id').eq('tenant_id', tenant).in('kind', ['deposit', 'balance']).eq('status', 'open');
  const byHand = (superseded ?? []).filter((i) => !i.mercury_invoice_id);
  for (const i of (superseded ?? []).filter((i) => i.mercury_invoice_id)) {
    const { cancelInvoice } = await import('./mercury');
    try {
      await cancelInvoice(i.mercury_invoice_id!);
      const { adminDb } = await import('./supabase/admin');
      await adminDb().from('invoices').update({ mercury_status: 'Cancelled', mercury_synced_at: new Date().toISOString() }).eq('id', i.id);
    } catch (e) { return fail(`Upgrade not drafted: ${i.number ?? 'the open balance'} could not be cancelled in Mercury (${e instanceof Error ? e.message : 'error'}).`); }
  }
  return call('create_upgrade', {
    p_tenant: tenant, p_to: to, p_amount_cents: q.total, p_note: `Upgrade to ${q.plan.name}, effective ${iso(on)}`, p_due: iso(new Date(on.getTime() + 7 * 86_400_000)),
    p_lines: q.lines,
  }, `Upgrade to ${q.plan.name} drafted: ${fmt(q.total)}${unpaid ? `; the unpaid ${fmt(unpaid)} setup balance is retired` : ''}${byHand.length ? `. Cancel ${byHand.map((i) => i.number ?? 'the balance invoice').join(', ')} in Mercury too: it was sent by link` : ''}. Send it from Invoices; the client gets the upgrade email with the pay link.`);
}

/** Start monthly care: plan, rate and start date; the first month is prorated to month end. */
export async function startCare(_: ActionResult, f: FormData): Promise<ActionResult> {
  const tenant = str(f, 'tenant', 64), plan = str(f, 'plan', 20), start = dateOr(str(f, 'start', 10));
  const rate = careRate[plan];
  if (!rate) return fail('Pick a care plan.');
  const dim = daysInMonth(start), left = dim - start.getUTCDate() + 1;
  const first = Math.round((rate * left) / dim);
  const r = await call('start_care', { p_tenant: tenant, p_care: careName[plan], p_rate_cents: rate, p_start: iso(start), p_first_cents: first, p_first_end: iso(monthEnd(start)) },
    `${careName[plan]} started ${iso(start)}: first month ${fmt(first)} (${left} of ${dim} days) drafted; ${fmt(rate)} drafts on the 1st of each month.`);
  if (r?.ok && f.get('autosend') === 'on') await call('set_care_autosend', { p_tenant: tenant, p_on: true }, '');
  return r;
}

export async function stopCare(_: ActionResult, f: FormData) {
  return call('stop_care', { p_tenant: str(f, 'tenant', 64), p_end: str(f, 'end', 10) || businessToday() }, 'Care stopped. Past invoices stay on record.');
}

export async function publishInvoice(_: ActionResult, f: FormData) {
  return call('publish_invoice', { p_id: str(f, 'id', 64), p_pay_url: str(f, 'pay_url', 500), p_number: str(f, 'number', 40) || null, p_due: str(f, 'due', 10) || null },
    'Invoice sent: it is in the client’s Billing page and they get an email.');
}

export async function markInvoicePaid(_: ActionResult, f: FormData) {
  return call('mark_invoice_paid', { p_id: str(f, 'id', 64), p_via: str(f, 'via', 60) || 'Mercury', p_paid_on: str(f, 'paid_on', 10) || businessToday() }, 'Payment recorded.');
}

export async function voidInvoice(_: ActionResult, f: FormData): Promise<ActionResult> {
  const id = str(f, 'id', 64);
  const supabase = await db();
  const { data: allowed } = await supabase.rpc('has_role', { roles: ['admin'] });
  if (!allowed) return fail('Only an admin can void an invoice.');
  const { data: inv } = await supabase.from('invoices').select('mercury_invoice_id, status').eq('id', id).single();
  // Cancel in Mercury first, so the client can never pay an invoice we have voided.
  if (inv?.mercury_invoice_id && inv.status === 'open') {
    const { cancelInvoice } = await import('./mercury');
    try { await cancelInvoice(inv.mercury_invoice_id); } catch (e) { return fail(`Not voided: ${e instanceof Error ? e.message : 'Mercury did not cancel it'}`); }
  }
  return call('void_invoice', { p_id: id }, inv?.mercury_invoice_id ? 'Invoice voided here and cancelled in Mercury.' : 'Invoice voided.');
}

// ---------- Mercury connection ----------
/** Credit the person who clicked: the Mercury steps themselves are logged as "Mercury". */
async function staffNote(invoiceId: string, action: string, subject: string) {
  const supabase = await db();
  const { data: auth } = await supabase.auth.getUser();
  const { adminDb } = await import('./supabase/admin');
  const admin = adminDb();
  const { data: inv } = await admin.from('invoices').select('tenant_id').eq('id', invoiceId).single();
  const { data: st } = await admin.from('staff').select('display_name').eq('user_id', auth.user?.id ?? '').maybeSingle();
  await admin.from('audit_events').insert({ tenant_id: inv?.tenant_id ?? null, actor: auth.user?.id ?? null, actor_label: st?.display_name ?? auth.user?.email ?? 'staff', action, subject, prev_hash: '', hash: '' });
}
async function staffBilling() {
  const supabase = await db();
  const { data } = await supabase.rpc('has_role', { roles: ['admin', 'account_lead'] });
  return Boolean(data);
}

/** Create the draft in Mercury and send it: the client gets our email with the Mercury pay link. */
export async function sendViaMercury(_: ActionResult, f: FormData): Promise<ActionResult> {
  if (!(await staffBilling())) return fail('Only an admin or account lead can send an invoice.');
  const id = str(f, 'id', 64), due = str(f, 'due', 10);
  const { pushInvoice } = await import('./mercury');
  try {
    const r = await pushInvoice(id, due);
    await staffNote(id, 'invoice.send', `${r.number} sent through Mercury`);
    revalidatePath('/', 'layout');
    return done(`${r.number} created in Mercury and sent: the client has the pay link by email and on their Billing page.`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Mercury did not accept the invoice.');
  }
}

export async function learnMercuryPayUrl(_: ActionResult, f: FormData): Promise<ActionResult> {
  const supabase = await db();
  const { data: admin } = await supabase.rpc('has_role', { roles: ['admin'] });
  if (!admin) return fail('Only an admin can change the Mercury connection.');
  const { learnPayUrl } = await import('./mercury');
  try {
    const t = await learnPayUrl(str(f, 'link', 500));
    revalidatePath('/', 'layout');
    return done(`Pay-link format saved: ${t}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Could not read that link.');
  }
}

export async function setCareAutosend(_: ActionResult, f: FormData) {
  const on = str(f, 'on', 5) === 'true';
  return call('set_care_autosend', { p_tenant: str(f, 'tenant', 64), p_on: on },
    on ? 'Monthly care invoices will be created and sent through Mercury automatically.' : 'Monthly care invoices will wait for you to send them.');
}

export async function deleteInvoice(_: ActionResult, f: FormData) {
  return call('delete_invoice', { p_id: str(f, 'id', 64) }, 'Draft removed.');
}

// ---------- Growth & financials (house account) ----------
export async function addExpense(_: ActionResult, f: FormData) {
  const amount = cents(str(f, 'amount', 20) || '0');
  if (!(amount > 0)) return fail('Enter an amount above zero.');
  return call('add_expense', {
    p_on: str(f, 'on', 10) || businessToday(), p_category: str(f, 'category', 20), p_vendor: str(f, 'vendor', 80), p_amount_cents: amount,
    p_recurring: f.get('recurring') === 'on', p_campaign: str(f, 'campaign', 64) || null, p_note: str(f, 'note', 300),
  }, `Expense recorded: ${str(f, 'vendor', 80)} ${fmt(amount)}.`);
}

export async function deleteExpense(_: ActionResult, f: FormData) {
  return call('delete_expense', { p_id: str(f, 'id', 64) }, 'Expense removed.');
}

// ---------- Genovus campaigns (house account) ----------
export async function saveCampaign(_: ActionResult, f: FormData) {
  const slug = str(f, 'slug', 41).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const budget = str(f, 'budget', 20);
  return call('save_campaign', {
    p_slug: slug, p_name: str(f, 'name', 120), p_channel: str(f, 'channel', 20), p_segment: str(f, 'segment', 30), p_carrier: str(f, 'carrier', 40),
    p_status: str(f, 'status', 10) || 'draft', p_starts: str(f, 'starts', 10) || null, p_ends: str(f, 'ends', 10) || null,
    p_budget_cents: budget ? Math.round(Number(budget.replace(/[$,\s]/g, '')) * 100) : null, p_notes: str(f, 'notes', 1000),
  }, `Campaign “${slug}” saved.`);
}

// ---------- Helix notes (from vision tours) ----------
const NOTE_DONE: Record<string, string> = { in_progress: 'Note started.', done: 'Note marked done.', dismissed: 'Note dismissed.', new: 'Note reopened.' };
export async function setHelixNote(_: ActionResult, f: FormData) {
  const status = str(f, 'status', 20);
  return call('set_helix_note_status', { p_id: str(f, 'id', 64), p_status: status }, NOTE_DONE[status] ?? 'Note updated.');
}

export async function handOffHelixNote(_: ActionResult, f: FormData) {
  const { requireStaff } = await import('./session');
  const { handOffNote } = await import('./helix-notes');
  const v = await requireStaff();
  const r = await handOffNote(str(f, 'id', 64), { userId: v.userId, name: v.staff.name });
  revalidatePath('/console/helix');
  return r.ok ? done('Handed to the build agent: the draft plan appears here in a few seconds.') : fail(r.error ?? 'Hand-off failed.');
}

// ---------- Follow-ups (agency reminders) ----------
export async function addFollowUp(_: ActionResult, f: FormData) {
  return call('add_follow_up', { p_tenant: str(f, 'tenant', 64), p_who: str(f, 'who', 120), p_reason: str(f, 'reason', 300), p_due: str(f, 'due', 10) || null, p_at: str(f, 'at', 5) },
    `Follow-up saved for ${str(f, 'due', 10) === businessToday() ? 'today' : str(f, 'due', 10)}.`);
}

export async function updateFollowUp(_: ActionResult, f: FormData) {
  const status = str(f, 'status', 10) || 'open';
  const due = str(f, 'due', 10) || null;
  return call('update_follow_up', { p_id: str(f, 'id', 64), p_status: status, p_due: due }, status === 'done' ? 'Done. Nice.' : due ? 'Moved.' : 'Reopened.');
}

// ---------- Genovus Studio ----------
export async function studioUpdateShot(_: ActionResult, f: FormData) {
  return call('studio_update_shot', { p_id: str(f, 'id', 64), p_status: str(f, 'status', 20), p_take_url: str(f, 'take', 500), p_notes: str(f, 'notes', 1000) }, 'Shot updated.');
}

export async function studioSetEpisode(_: ActionResult, f: FormData) {
  const status = str(f, 'status', 20);
  return call('studio_set_episode', { p_id: str(f, 'id', 64), p_status: status, p_final_url: str(f, 'final', 500) },
    status === 'approved' ? 'Episode approved: this exact render can now be posted.' : `Episode moved to ${status}.`);
}

export async function studioSavePost(_: ActionResult, f: FormData) {
  const when = str(f, 'when', 30);
  return call('studio_save_post', { p_id: str(f, 'id', 64), p_caption: str(f, 'caption', 2200), p_title: str(f, 'title', 100), p_scheduled: when ? new Date(`${when}:00-04:00`).toISOString() : null }, 'Post saved (back to draft for approval).');
}

export async function studioApprovePost(_: ActionResult, f: FormData) {
  return call('studio_approve_post', { p_id: str(f, 'id', 64) }, 'Approved. Publish it on the platform, then record the live link here.');
}

export async function studioMarkPosted(_: ActionResult, f: FormData) {
  return call('studio_mark_posted', { p_id: str(f, 'id', 64), p_url: str(f, 'url', 500), p_ai_label: f.get('ai') === 'on' }, 'Recorded as live. 🎬');
}

// Re-dates the demo agency's follow-ups around today, so the app capture for the Studio always shows a full
// “Tomorrow” list. Sample agency only.
export async function resetDemoFollowUps(_: ActionResult) {
  const { requireStaff } = await import('./session');
  await requireStaff();
  const { adminDb } = await import('./supabase/admin');
  const season = (await import('@/data/studio-season1.json')).default as { demo_follow_ups: { who: string; reason: string; day: number; at: string }[] };
  const admin = adminDb();
  const { data: t } = await admin.from('tenants').select('id, is_sample').eq('slug', 'demo-brooks').maybeSingle();
  if (!t?.is_sample) return fail('The demo agency (demo-brooks) is missing.');
  const today = businessToday();
  const day = (n: number) => { const x = new Date(`${today}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  await admin.from('follow_ups').delete().eq('tenant_id', t.id);
  const { error } = await admin.from('follow_ups').insert(season.demo_follow_ups.map((d) => ({ tenant_id: t.id, who: d.who, reason: d.reason, due_on: day(d.day), due_at: d.at })));
  revalidatePath('/', 'layout');
  return error ? fail(error.message) : done('Demo follow-ups reset: tomorrow’s list is ready to film.');
}

export async function studioChooseTake(_: ActionResult, f: FormData) {
  return call('studio_choose_take', { p_id: str(f, 'id', 64) }, 'Take chosen for the edit.');
}

export async function studioSetCanonical(_: ActionResult, f: FormData) {
  return call('studio_set_canonical', { p_id: str(f, 'id', 64) }, 'This sheet is now the character’s reference for every shot.');
}

export async function studioSetBudget(_: ActionResult, f: FormData) {
  const dollars = (k: string) => Math.round(Number(str(f, k, 12).replace(/[$,\s]/g, '') || '0') * 100);
  return call('studio_set_budget', { p_cap_cents: dollars('cap'), p_approval_cents: dollars('approval') }, 'Studio budget updated.');
}

/** Registers a file the browser uploaded straight to storage: a take for a capture shot, or an episode's final cut. */
export async function studioRegisterUpload(kind: 'take' | 'final', target: string, pathname: string, sha256: string): Promise<ActionResult> {
  const supabase = await db();
  const { error } = kind === 'take'
    ? await supabase.rpc('studio_add_upload_take', { p_shot: target, p_blob: pathname })
    : await supabase.rpc('studio_set_final', { p_episode: target, p_blob: pathname, p_sha256: sha256 });
  revalidatePath('/', 'layout');
  return error ? fail(error.message) : done(kind === 'take' ? 'Recording added as a take.' : 'Final cut uploaded. Review it, then approve.');
}

export async function studioChooseArt(_: ActionResult, f: FormData) {
  return call('studio_choose_art', { p_id: str(f, 'id', 64) }, 'Thumbnail set for every post of this episode.');
}

// ---------- Trend Remix (sources and rights) ----------
export async function studioSaveSource(_: ActionResult, f: FormData) {
  return call('studio_save_source', {
    p_id: str(f, 'id', 64) || null, p_url: str(f, 'url', 500), p_platform: str(f, 'platform', 20) || 'other', p_creator: str(f, 'creator', 80),
    p_title: str(f, 'title', 120) || 'Viral moment', p_route: str(f, 'route', 20) || 'inspired', p_episode: str(f, 'episode', 64) || null, p_notes: str(f, 'notes', 1000),
  }, 'Saved to the trend board.');
}

export async function studioSourceRights(_: ActionResult, f: FormData) {
  const flag = (k: string) => (f.has(k) ? f.get(k) === 'on' || f.get(k) === 'true' : null);
  return call('studio_source_rights', {
    p_id: str(f, 'id', 64), p_remix_allowed: f.has('remix_set') ? f.get('remix') === 'on' : null,
    p_license_status: str(f, 'license', 20) || null, p_license_blob: null, p_attested: f.has('attest_set') ? flag('attest') ?? false : null,
  }, 'Rights updated.');
}

export async function studioSetPostMethod(_: ActionResult, f: FormData) {
  const v = str(f, 'how', 120); // "upload" or "stitch:<source id>" / "remix:<source id>"
  const [method, source] = v.split(':');
  return call('studio_set_post_method', { p_post: str(f, 'id', 64), p_method: method || 'upload', p_source: source || null }, method === 'upload' ? 'Posting as an upload.' : `Posting as a ${method === 'stitch' ? 'Stitch' : 'Remix'} of the source.`);
}

/** Registers a creator's written permission the browser uploaded straight to storage. */
export async function studioRegisterLicense(sourceId: string, pathname: string): Promise<ActionResult> {
  const supabase = await db();
  const { error } = await supabase.rpc('studio_source_rights', { p_id: sourceId, p_remix_allowed: null, p_license_status: 'granted', p_license_blob: pathname, p_attested: null });
  revalidatePath('/', 'layout');
  return error ? fail(error.message) : done('Permission on file: this source is cleared.');
}

// ---------- Cast Character Bible ----------
export async function studioApproveRef(_: ActionResult, f: FormData) {
  return call('studio_approve_ref', { p_id: str(f, 'id', 64), p_reason: str(f, 'reason', 300) }, 'Approved and logged in the bible’s decision record.');
}
