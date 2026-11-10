'use server';
// Upgrade Notes writes (lib/upgrade-notes.ts). The team drafts, edits and queues notes (admins and account leads);
// sending is the approval tap (lib/actions.ts decideApproval). Agency members answer next steps and mark notes read
// through database functions that check membership. Search Console: the team sets each agency's property.
import { revalidatePath } from 'next/cache';
import { db } from './supabase/server';
import { adminDb } from './supabase/admin';
import { businessToday } from './billing';
import type { ActionResult } from './actions';

const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? '').trim().slice(0, max);
const done = (ok: string): ActionResult => ({ ok, at: Date.now() });
const fail = (err: string): ActionResult => ({ err, at: Date.now() });
const lines = (v: string, n: number, len = 240) => v.split('\n').map((s) => s.replace(/^[-•*]\s*/, '').trim()).filter(Boolean).slice(0, n).map((s) => s.slice(0, len));
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

async function team(): Promise<string | null> {
  const supabase = await db();
  const { data: ok } = await supabase.rpc('has_role', { roles: ['admin', 'account_lead'] });
  if (!ok) return null;
  return (await supabase.auth.getUser()).data.user?.id ?? null;
}

export async function draftUpgradeNote(_: ActionResult, f: FormData): Promise<ActionResult> {
  const uid = await team();
  if (!uid) return fail('Only an admin or account lead can write upgrade notes.');
  const tenant = str(f, 'tenant', 64), shipped = str(f, 'shipped', 6000);
  if (shipped.length < 20) return fail('Describe what shipped in a sentence or two first.');
  const { draftNote, stepKey } = await import('./upgrade-notes');
  let d;
  try { d = await draftNote(tenant, shipped); } catch (e) { return fail(`Helix couldn’t draft it: ${e instanceof Error ? e.message : 'try again'}`); }
  const { error } = await adminDb().from('upgrade_notes').insert({
    tenant_id: tenant, title: d.title, summary: d.summary, did: d.did, background: d.background, expect: d.expect,
    steps: d.steps.map((text, i) => ({ key: stepKey(text, i), text })), scales: d.scales, check_back_on: addDays(businessToday(), d.checkBackDays), created_by: uid,
  });
  revalidatePath('/console', 'layout');
  return error ? fail(error.message) : done('Helix drafted it. Read it over, edit, then queue it to send.');
}

export async function saveUpgradeNote(_: ActionResult, f: FormData): Promise<ActionResult> {
  if (!(await team())) return fail('Only an admin or account lead can edit upgrade notes.');
  const { stepKey } = await import('./upgrade-notes');
  const expect = lines(str(f, 'expect', 3000), 5, 260).map((l) => { const [when, ...rest] = l.split('|'); return rest.length ? { when: when.trim().slice(0, 40), what: rest.join('|').trim().slice(0, 200) } : { when: 'Soon', what: when.trim().slice(0, 200) }; });
  const back = str(f, 'check_back_on', 10);
  const { error, count } = await adminDb().from('upgrade_notes').update({
    title: str(f, 'title', 110), summary: str(f, 'summary', 400), did: lines(str(f, 'did', 3000), 6), background: lines(str(f, 'background', 3000), 5),
    expect, steps: lines(str(f, 'steps', 2000), 3, 200).map((text, i) => ({ key: stepKey(text, i), text })), scales: str(f, 'scales', 600),
    check_back_on: /^\d{4}-\d{2}-\d{2}$/.test(back) ? back : null, updated_at: new Date().toISOString(),
  }, { count: 'exact' }).eq('id', str(f, 'id', 64)).eq('status', 'draft');
  revalidatePath('/console', 'layout');
  if (error) return fail(error.message.includes('title') ? 'The title needs 3 to 120 characters.' : error.message);
  return count ? done('Saved.') : fail('Only a draft can be edited. Ask for changes on its approval to edit it again.');
}

export async function queueUpgradeNote(_: ActionResult, f: FormData): Promise<ActionResult> {
  if (!(await team())) return fail('Only an admin or account lead can queue upgrade notes.');
  const { queueNote } = await import('./upgrade-notes');
  const r = await queueNote(str(f, 'id', 64));
  revalidatePath('/console', 'layout');
  return 'err' in r ? fail(r.err) : done(r.ok);
}

export async function deleteUpgradeNote(_: ActionResult, f: FormData): Promise<ActionResult> {
  if (!(await team())) return fail('Only an admin or account lead can delete upgrade notes.');
  const { count } = await adminDb().from('upgrade_notes').delete({ count: 'exact' }).eq('id', str(f, 'id', 64)).eq('status', 'draft');
  revalidatePath('/console', 'layout');
  return count ? done('Draft deleted.') : fail('Only a draft can be deleted.');
}

/** Write the check-back now (or again, after changes were asked) and queue it for the send tap. */
export async function queueCheckBack(_: ActionResult, f: FormData): Promise<ActionResult> {
  if (!(await team())) return fail('Only an admin or account lead can queue a check-back.');
  const admin = adminDb();
  const { data: n } = await admin.from('upgrade_notes').select('id, tenant_id, title, status, sent_at, check_back_status, tenants(name)').eq('id', str(f, 'id', 64)).maybeSingle();
  if (!n || n.status !== 'sent' || !n.sent_at) return fail('A check-back follows a sent note.');
  if (n.check_back_status === 'queued' || n.check_back_status === 'sent') return fail(n.check_back_status === 'sent' ? 'That check-back was already sent.' : 'That check-back is already waiting on its send tap.');
  const { checkBackFor } = await import('./upgrade-notes');
  const cb = await checkBackFor(admin, n.tenant_id as string, n.sent_at as string);
  await admin.from('upgrade_notes').update({ check_back: cb, check_back_status: 'queued', updated_at: new Date().toISOString() }).eq('id', n.id);
  const name = (n.tenants as unknown as { name: string } | null)?.name ?? 'the agency';
  await admin.from('approvals').insert({ tenant_id: n.tenant_id, subject_kind: 'report', approver: 'team', lane: 'queued', title: `Send ${name} the check-back on “${n.title}”`, body: { action: 'send_checkback', note: n.id, text: cb.lines.join(' ') } });
  revalidatePath('/console', 'layout');
  return done('Check-back written with today’s numbers and queued. One tap on Send delivers it.');
}

// ---------- Search Console ----------
export async function saveSearchConsole(_: ActionResult, f: FormData): Promise<ActionResult> {
  if (!(await team())) return fail('Only an admin or account lead can connect Search Console.');
  let p = str(f, 'property', 200).toLowerCase();
  if (p && !p.startsWith('sc-domain:') && !p.startsWith('https://')) p = `sc-domain:${p.replace(/^www\./, '')}`;
  if (p.startsWith('https://') && !p.endsWith('/')) p += '/';
  if (p && !/^(sc-domain:[a-z0-9.-]+\.[a-z]{2,}|https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/)$/.test(p)) return fail('Use the property exactly as Search Console shows it: sc-domain:example.com or https://example.com/');
  const { error } = await adminDb().from('tenants').update({ search_console_site: p || null }).eq('id', str(f, 'tenant', 64));
  revalidatePath('/console', 'layout');
  return error ? fail(error.message) : done(p ? `Saved ${p}. Pull now to check access.` : 'Search Console disconnected.');
}

export async function pullSearchNow(_: ActionResult, f: FormData): Promise<ActionResult> {
  if (!(await team())) return fail('Only an admin or account lead can pull Search Console.');
  const { searchConsoleProblem, pullSearch } = await import('./search-console');
  const problem = searchConsoleProblem();
  if (problem) return fail(problem);
  const { data: t } = await adminDb().from('tenants').select('search_console_site').eq('id', str(f, 'tenant', 64)).maybeSingle();
  if (!t?.search_console_site) return fail('Save the property first.');
  const r = await pullSearch(str(f, 'tenant', 64), t.search_console_site as string);
  revalidatePath('/console', 'layout');
  return r.ok ? done(`Pulled ${r.rows} days of search numbers; ${r.inspected} of ${r.pages} pages checked in Google.`) : fail(`Google said: ${r.errors[0] ?? 'no numbers yet'}. Check the service account is added to this property.`);
}

// ---------- Agency side ----------
export async function answerUpgradeStep(_: ActionResult, f: FormData): Promise<ActionResult> {
  const status = str(f, 'status', 10);
  const { error } = await (await db()).rpc('answer_upgrade_step', { p_note: str(f, 'note', 64), p_step: str(f, 'step', 40), p_status: status });
  revalidatePath('/app', 'layout');
  if (error) return fail('That didn’t save. Try again.');
  return done(status === 'done' ? 'Marked done. Thank you.' : status === 'help' ? 'The Genovus team will reach out to help.' : 'We’ll keep it here for later.');
}

export async function readUpgradeNote(note: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(note)) return;
  await (await db()).rpc('read_upgrade_note', { p_note: note });
}
