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
  const objection = str(f, 'objection', 20);
  if (!outcome && !status && !objection && !str(f, 'note') && !str(f, 'contact_name') && !str(f, 'contact_email')) return fail('Pick an outcome or add a note.');
  const { error } = await (await db()).rpc('log_prospect', {
    p_id: str(f, 'id', 64), p_kind: outcome ? 'call' : 'note', p_outcome: outcome, p_note: str(f, 'note', 2000), p_status: status,
    p_next: /^\d{4}-\d{2}-\d{2}$/.test(next) ? `${next}T14:00:00Z` : null,
    p_contact_name: str(f, 'contact_name', 120) || null, p_contact_email: str(f, 'contact_email', 200) || null, p_contact_phone: str(f, 'contact_phone', 40) || null,
    // The business name and address the team confirmed on the call stay on Genovus's own record (shown when Google is paused).
    p_known_name: str(f, 'known_name', 160) || null, p_known_address: str(f, 'known_address', 240) || null,
    p_objection: objection || null,
  });
  revalidatePath('/console/prospects', 'layout');
  return error ? fail(error.message) : done('Saved.');
}

/** Start onboarding: the prospect becomes a client in Consult with a draft record from what the team confirmed
 *  (convert_prospect), and the package they picked is set up right along with it:
 *  - its features switch on as a 30-day trial (the plan itself changes when the upgrade invoice is paid);
 *  - the website starts: a draft site.config.ts from the record, attached to the client, and a "Build the website"
 *    task with the launch checklist. Care billing doesn't start here, and nothing is sent to the client.
 *  Admin or account lead. Running it again changes nothing. Opens the new client. */
export async function startOnboarding(_: ActionResult, f: FormData): Promise<ActionResult> {
  const slug = str(f, 'slug', 64).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const pkg = (['launch', 'growth', 'premium'].includes(str(f, 'package', 10)) ? str(f, 'package', 10) : 'launch') as 'launch' | 'growth' | 'premium';
  const supabase = await db();
  const { data: tid, error } = await supabase.rpc('convert_prospect', {
    p_id: str(f, 'id', 64), p_slug: slug, p_name: str(f, 'name', 160), p_contact: str(f, 'contact', 120) || null, p_email: str(f, 'email', 200) || null,
    p_phone: str(f, 'phone', 40) || null, p_city: str(f, 'city', 80) || null, p_state: str(f, 'state', 2) || null, p_website: str(f, 'website', 200) || null, p_note: str(f, 'note', 300) || null,
    p_package: pkg,
  });
  revalidatePath('/', 'layout');
  if (error || !tid) return fail(error?.message.includes('duplicate') ? 'That client web address is taken; pick another.' : error?.message ?? 'Couldn’t start onboarding.');
  const { data: t } = await supabase.from('tenants').select('slug').eq('id', tid).single();
  const clientSlug = (t?.slug as string) ?? slug;
  const { packageModules } = await import('./site-config');
  const { careName } = await import('./billing');
  const label = pkg[0].toUpperCase() + pkg.slice(1);
  // The package's features, as a trial until the invoice is paid (worked out here from the package, never the form).
  const { data: had } = await supabase.from('module_grants').select('id').eq('tenant_id', tid).like('reason', 'Onboarding:%').limit(1);
  // Launch can start with a 30-day Growth trial: Growth's features for 30 days, on the Launch price.
  const growthTrial = pkg === 'launch' && f.get('trial') === 'growth';
  const keys = packageModules(growthTrial ? 'growth' : pkg);
  if (!had?.length && keys.length) {
    const g = await supabase.rpc('grant_modules', { p_tenant: tid, p_keys: keys, p_until: new Date(Date.now() + 30 * 86_400_000).toISOString(), p_reason: growthTrial ? 'Onboarding: 30-day Growth trial (Launch package)' : `Onboarding: ${label} package (30-day trial until the invoice is paid)` });
    if (g.error) return fail(`The client was created, but its ${label} features couldn’t be switched on: ${g.error.message}`);
  }
  // The office itself: street, ZIP and lines go on the record (the site config reads them) and on the agency profile,
  // which places the office on the map for the package's features (partners, radar, visibility).
  const street = str(f, 'street', 160), zip = str(f, 'zip', 10), lines = f.getAll('lines').map(String).filter((l) => /^[a-z]{2,12}$/.test(l));
  if (street || zip || lines.length || growthTrial) {
    const { data: cur } = await supabase.from('agent_records').select('data').eq('tenant_id', tid).eq('is_current', true).maybeSingle();
    const d = (cur?.data ?? {}) as Record<string, unknown>;
    const city = str(f, 'city', 80) || String(d.city ?? ''), state = (str(f, 'state', 2) || String(d.state ?? '')).toUpperCase();
    const address = [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    const merged = { ...d, ...(street ? { address } : {}), ...(zip ? { zip } : {}), ...(lines.length ? { lines } : {}), ...(growthTrial ? { trial: 'growth', trialEnds: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) } : {}) };
    if (JSON.stringify(merged) !== JSON.stringify(d)) await supabase.rpc('save_agent_record', { p_tenant: tid, p_data: merged, p_note: 'Office address and lines from onboarding' });
    const { saveAgencyProfile } = await import('./growth-actions');
    const prof = await saveAgencyProfile(tid as string, { address: street, city, state, zip, lines, radius: 15, licensed: state, carrier: String(d.carrier ?? ''), phone: str(f, 'phone', 40), website: str(f, 'website', 200) });
    if (prof.err) return fail(`The client was created, but its agency profile didn’t save: ${prof.err}`);
  }
  // The office's own Google listing (the prospect the scanner found) gives the site its review link.
  const { data: pr } = await supabase.from('prospects').select('place_id').eq('tenant_id', tid).maybeSingle();
  if (pr?.place_id && /^[A-Za-z0-9_-]{10,200}$/.test(pr.place_id)) await adminDb().from('agency_profiles').update({ google_place_id: pr.place_id }).eq('tenant_id', tid);
  // The proposal and deposit, drafted from the package and waiting on one tap in Approvals (sending is outward).
  const { ensureDepositDraft, depositCents, proposalToken } = await import('./proposal');
  await ensureDepositDraft(tid as string, pkg);
  const { data: queued } = await supabase.from('approvals').select('id').eq('tenant_id', tid).eq('body->>action', 'send_proposal').limit(1);
  if (!queued?.length) {
    await adminDb().from('approvals').insert({ tenant_id: tid, subject_kind: 'invoice', approver: 'team', lane: 'queued',
      title: `Send the proposal and ${label} deposit`,
      body: { action: 'send_proposal', text: `${label} package. Deposit $${(depositCents(pkg) / 100).toLocaleString('en-US')} (70% of setup). Sends the proposal link to the client's email${proposalToken(tid as string) ? '' : ''} and opens the deposit in Mercury when it's connected.`, channel: 'Email' } });
  }
  // The website starts with the record.
  const admin = adminDb();
  const cfgTitle = 'Website config (draft)';
  const { data: cfg } = await admin.from('assets').select('id').eq('tenant_id', tid).eq('title', cfgTitle).maybeSingle();
  if (!cfg) await admin.from('assets').insert({ tenant_id: tid, kind: 'document', title: cfgTitle, location_kind: 'route', location: `/api/clients/${clientSlug}/site-config`, audience: 'internal', rights_status: 'not_needed', notes: `site.config.ts for the agency site template, written from the record (${label} package). Always matches the current record.` });
  const { data: task } = await supabase.from('care_requests').select('id').eq('tenant_id', tid).eq('title', 'Build the website').limit(1);
  if (!task?.length) await supabase.rpc('create_care_request', { p_tenant: tid, p_kind: 'change', p_title: 'Build the website', p_detail: [
    `${label} package · ${careName[pkg]} after launch.`,
    `1. The site builds itself from the record: open the preview from the client page (Open the website preview). ${label === 'Launch' ? 'Home page.' : label === 'Growth' ? 'Home + up to 4 line pages, with online booking.' : 'Home + up to 7 line pages, with online booking.'}`,
    '2. The client’s checklist fills in their headshot, hours, licensed states and carrier page; name, address and phone must match the carrier’s official agent profile exactly.',
    '3. Polish the copy, clear photo rights, then mark it ready for review.',
    '4. Carrier approval and the client’s approval (gates). Nothing is indexed until both approve the live site.',
  ].join('\n') });
  redirect(`/console/clients/${clientSlug}?ok=${encodeURIComponent(`Onboarding started: ${label} package. Features are on as a 30-day trial, and the website build is underway.`)}`);
}
