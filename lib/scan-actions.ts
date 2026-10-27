'use server';
// Console actions for the scanner and prospects. Staff-only checks run as the signed-in person; the scan
// itself and settings writes use the service role after that check.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from './supabase/server';
import { adminDb } from './supabase/admin';
import type { ActionResult } from './actions';

const str = (f: FormData, k: string, max = 2000) => String(f.get(k) ?? '').trim().slice(0, max);
const done = (ok: string): ActionResult => ({ ok, at: Date.now() });
const fail = (err: string): ActionResult => ({ err, at: Date.now() });

async function role(...roles: string[]) {
  const { data } = await (await db()).rpc('has_role', { roles });
  return Boolean(data);
}

export async function saveCarrier(_: ActionResult, f: FormData): Promise<ActionResult> {
  const { error } = await (await db()).rpc('save_carrier', { p_slug: str(f, 'slug', 41), p_scan: f.get('scan') === 'on', p_fit: Number(str(f, 'fit', 3)) || 0, p_notes: str(f, 'notes', 1000) });
  revalidatePath('/console/carriers');
  return error ? fail(error.message) : done('Carrier saved.');
}

export async function saveScanSettings(_: ActionResult, f: FormData): Promise<ActionResult> {
  if (!(await role('admin'))) return fail('Only an admin can change scan settings.');
  const states = str(f, 'states', 200).toUpperCase().split(/[\s,]+/).filter((s) => /^[A-Z]{2}$/.test(s));
  const budget = Number(str(f, 'budget', 10));
  if (!states.length) return fail('List at least one state, e.g. GA, AL, FL, TX.');
  if (!(budget >= 0 && budget <= 5000)) return fail('Budget must be between $0 and $5,000 a month.');
  const reserveRaw = str(f, 'reserve', 10), reserve = reserveRaw === '' ? null : Number(reserveRaw);
  if (reserve != null && !(reserve >= 0 && reserve <= budget)) return fail('The amount kept for showing names must be between $0 and the monthly budget.');
  const now = new Date().toISOString();
  await adminDb().from('app_settings').upsert([{ key: 'scan_states', value: [...new Set(states)].join(','), updated_at: now }, { key: 'scan_budget_usd', value: String(budget), updated_at: now }, ...(reserve != null ? [{ key: 'places_display_reserve_usd', value: String(reserve), updated_at: now }] : [])]);
  const { data: auth } = await (await db()).auth.getUser();
  await adminDb().from('audit_events').insert({ tenant_id: null, actor: auth.user?.id ?? null, actor_label: auth.user?.email ?? 'staff', action: 'scan.settings', subject: states.join(','), after: { states, budget, reserve }, prev_hash: '', hash: '' });
  revalidatePath('/console/carriers');
  return done(`Scanning ${states.join(', ')} with a $${budget}/month budget.`);
}

export async function runScanNow(_: ActionResult, _f: FormData): Promise<ActionResult> {
  if (!(await role('admin'))) return fail('Only an admin can run the scanner.');
  const { placesConfigured } = await import('./places');
  if (!placesConfigured()) return fail('Google Places is not connected yet: add GOOGLE_PLACES_API_KEY in Vercel.');
  const { runSlice } = await import('./scanner');
  try {
    const r = await runSlice({ deadlineMs: 40_000 });
    revalidatePath('/console/carriers');
    return r.status === 'idle' || r.status === 'budget' ? fail(r.note ?? 'Nothing to scan.') : done(`Scanned ${r.cells} area(s): ${r.found} new offices, ${r.requests} searches (~$${(r.costCents / 100).toFixed(2)}). ${r.status === 'done' ? 'Sweep complete.' : 'More to go: it continues every 10 minutes.'}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'The scan failed.');
  }
}

export async function logProspect(_: ActionResult, f: FormData): Promise<ActionResult> {
  const next = str(f, 'next', 10);
  const outcome = str(f, 'outcome', 40);
  const { OUTCOMES } = await import('./prospects');
  const status = str(f, 'status', 20) || OUTCOMES.find(([o]) => o === outcome)?.[2] || null;
  if (!outcome && !status && !str(f, 'note') && !str(f, 'contact_name') && !str(f, 'contact_email')) return fail('Pick an outcome or add a note.');
  const { error } = await (await db()).rpc('log_prospect', {
    p_id: str(f, 'id', 64), p_kind: outcome ? 'call' : 'note', p_outcome: outcome, p_note: str(f, 'note', 2000), p_status: status,
    p_next: /^\d{4}-\d{2}-\d{2}$/.test(next) ? `${next}T14:00:00Z` : null,
    p_contact_name: str(f, 'contact_name', 120) || null, p_contact_email: str(f, 'contact_email', 200) || null, p_contact_phone: str(f, 'contact_phone', 40) || null,
    // The business name and address the team confirmed on the call stay on Genovus's own record (shown when Google is paused).
    p_known_name: str(f, 'known_name', 160) || null, p_known_address: str(f, 'known_address', 240) || null,
  });
  revalidatePath('/console/prospects', 'layout');
  return error ? fail(error.message) : done('Saved.');
}

/** Start onboarding: the prospect becomes a client in Consult with a draft record from what the team confirmed
 *  (convert_prospect). Admin or account lead. Opens the new client. */
export async function startOnboarding(_: ActionResult, f: FormData): Promise<ActionResult> {
  const slug = str(f, 'slug', 64).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const { error } = await (await db()).rpc('convert_prospect', {
    p_id: str(f, 'id', 64), p_slug: slug, p_name: str(f, 'name', 160), p_contact: str(f, 'contact', 120) || null, p_email: str(f, 'email', 200) || null,
    p_phone: str(f, 'phone', 40) || null, p_city: str(f, 'city', 80) || null, p_state: str(f, 'state', 2) || null, p_website: str(f, 'website', 200) || null, p_note: str(f, 'note', 300) || null,
  });
  revalidatePath('/', 'layout');
  if (error) return fail(error.message.includes('duplicate') ? 'That client web address is taken; pick another.' : error.message);
  redirect(`/console/clients/${slug}?ok=${encodeURIComponent('Onboarding started: the client is in Consult with a draft record')}`);
}
