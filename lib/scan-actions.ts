'use server';
// Console actions for the scanner and prospects. Staff-only checks run as the signed-in person; the scan
// itself and settings writes use the service role after that check.
import { revalidatePath } from 'next/cache';
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
  const now = new Date().toISOString();
  await adminDb().from('app_settings').upsert([{ key: 'scan_states', value: [...new Set(states)].join(','), updated_at: now }, { key: 'scan_budget_usd', value: String(budget), updated_at: now }]);
  const { data: auth } = await (await db()).auth.getUser();
  await adminDb().from('audit_events').insert({ tenant_id: null, actor: auth.user?.id ?? null, actor_label: auth.user?.email ?? 'staff', action: 'scan.settings', subject: states.join(','), after: { states, budget }, prev_hash: '', hash: '' });
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
  });
  revalidatePath('/console/prospects', 'layout');
  return error ? fail(error.message) : done('Saved.');
}
