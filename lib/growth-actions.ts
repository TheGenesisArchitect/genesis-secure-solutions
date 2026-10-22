'use server';
// The Agency Growth Engine's actions. Staff: save the agency profile (the office is placed with the free US Census
// geocoder), buy or release a tracking number, start the partner radar. Agency members: work a partner, record
// what a source cost this month. Every write goes through an audited database function.
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { requireStaff, getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { buyLocalNumber, connectExistingNumber, releaseNumber, twilioConfigured } from '@/lib/twilio';
import { startRadar, runRadarSlice } from '@/lib/radar';
import { startCompetitorScan, runCompetitorSlice } from '@/lib/competitor-radar';
import { placesConfigured } from '@/lib/places';
import { easternIso } from '@/lib/agency-calendar';
import { accessFor } from '@/lib/access';
import { CALLS_OPTION, HOUSE_SLUG, phoneProof } from '@/lib/phone-line';

type Out = { ok?: string; err?: string };
const uuid = /^[0-9a-f-]{36}$/;
const e164 = (s: string) => { const d = s.replace(/\D/g, ''); return d.length === 10 ? `+1${d}` : d.length === 11 && d[0] === '1' ? `+${d}` : null; };

async function geocode(oneLine: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(oneLine)}`, { signal: AbortSignal.timeout(12_000), cache: 'no-store' });
    const j = (await r.json()) as { result?: { addressMatches?: { coordinates: { x: number; y: number } }[] } };
    const c = j.result?.addressMatches?.[0]?.coordinates;
    return c ? { lat: c.y, lng: c.x } : null;
  } catch { return null; }
}

export async function saveAgencyProfile(tenantId: string, p: { address: string; city: string; state: string; zip: string; lines: string[]; radius: number; licensed: string; carrier: string; phone: string; website: string }): Promise<Out> {
  await requireStaff();
  if (!uuid.test(tenantId)) return { err: 'Unknown agency.' };
  const phone = p.phone ? e164(p.phone) : null;
  const website = p.website.trim() ? (/^https?:\/\//.test(p.website.trim()) ? p.website.trim() : `https://${p.website.trim()}`).replace(/^http:/, 'https:') : null;
  if (p.phone && !phone) return { err: 'Main phone: enter a 10-digit US number.' };
  const where = p.address && p.city && p.state ? await geocode(`${p.address}, ${p.city}, ${p.state} ${p.zip}`) : null;
  const { error } = await (await db()).rpc('save_agency_profile', {
    p_tenant: tenantId,
    p: { address: p.address, city: p.city, state: p.state, zip: p.zip, lat: where?.lat ?? null, lng: where?.lng ?? null, lines: p.lines, service_radius_mi: Math.max(3, Math.min(50, Math.round(p.radius || 15))), licensed_states: p.licensed.split(/[\s,]+/).filter(Boolean), carrier: p.carrier, main_phone_e164: phone, website },
  });
  if (error) return { err: error.message };
  revalidatePath('/', 'layout');
  return { ok: where ? 'Profile saved; the office is placed on the map.' : p.address ? 'Profile saved, but the address could not be placed. Check the street, city and ZIP.' : 'Profile saved.' };
}

/** Buy a number (or, with `existingE164`, connect one already in the Twilio account) for this account. */
export async function buyTrackingNumber(tenantId: string, label: string, source: string, areaCode: string, existingE164?: string): Promise<Out> {
  await requireStaff();
  if (!uuid.test(tenantId)) return { err: 'Unknown agency.' };
  if (!twilioConfigured()) return { err: 'Twilio is not connected yet: add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Vercel.' };
  if (!/^[a-z0-9-]{2,40}$/.test(source)) return { err: 'Choose where this number will be shown.' };
  const admin = adminDb();
  const { data: t } = await admin.from('tenants').select('name, slug, plan').eq('id', tenantId).single();
  const house = t?.slug === HOUSE_SLUG;
  const existing = existingE164 ? e164(existingE164) : null;
  if (existingE164 && !existing) return { err: 'Enter the Twilio number as 10 digits.' };
  // Agencies get numbers only after the Genovus line has proven the whole chain, and only with the Call tracking option on.
  if (!house) {
    if (!(await phoneProof(admin)).proven) return { err: 'Prove the phone service on the Genovus line first (Enterprise → Call list → Genovus line): an answered, recorded call with Helix’s note, and a missed call.' };
    if (!(await accessFor(tenantId, t?.plan ?? null, admin)).has(CALLS_OPTION)) return { err: 'Turn on the Call tracking option for this agency first (Modules, above).' };
  }
  const { data: prof } = await admin.from('agency_profiles').select('main_phone_e164').eq('tenant_id', tenantId).maybeSingle();
  if (!prof?.main_phone_e164) return { err: house ? 'Set the phone the Genovus line rings first.' : 'Set the office’s main phone in the agency profile first; calls forward there.' };
  const h = await headers();
  const origin = process.env.APP_ORIGIN || `https://${h.get('x-forwarded-host') ?? h.get('host')}`;
  try {
    const n = existing
      ? await connectExistingNumber(existing, origin, `${t?.name ?? 'Agency'} · ${label}`)
      : await buyLocalNumber(/^\d{3}$/.test(areaCode) ? areaCode : prof.main_phone_e164.slice(2, 5), origin, `${t?.name ?? 'Agency'} · ${label}`);
    const { error } = await admin.rpc('add_tracking_number', { p_tenant: tenantId, p_e164: n.e164, p_sid: n.sid, p_label: label, p_source: source, p_forward: prof.main_phone_e164 });
    // A number we bought is released if it can't be saved; a connected one stays in the account.
    if (error) { if (!existing) await releaseNumber(n.sid); return { err: error.message.includes('duplicate') ? 'That number is already connected.' : error.message }; }
    revalidatePath('/', 'layout');
    return { ok: house ? `Genovus line ${existing ? 'connected' : 'ready'}: ${n.e164}. Call it to start the proof.` : existing ? `Connected ${n.e164}: calls forward to the office and land in Leads.` : `Number ready: ${n.e164}. Calls forward to the office and land in Leads.` };
  } catch (e) {
    return { err: e instanceof Error ? e.message : 'Could not buy a number.' };
  }
}

/** The phone the Genovus line rings (the house account's main phone); live numbers follow it. */
export async function saveHouseForward(phone: string): Promise<Out> {
  await requireStaff();
  const n = e164(phone);
  if (!n) return { err: 'Enter a 10-digit US number.' };
  const admin = adminDb();
  const { data: house } = await admin.from('tenants').select('id').eq('slug', HOUSE_SLUG).single();
  if (!house) return { err: 'The Genovus house account is missing.' };
  const { data: prof } = await admin.from('agency_profiles').select('*').eq('tenant_id', house.id).maybeSingle();
  const { error } = await (await db()).rpc('save_agency_profile', {
    p_tenant: house.id,
    p: { address: prof?.address ?? '', city: prof?.city ?? '', state: prof?.state ?? '', zip: prof?.zip ?? '', lat: prof?.lat ?? null, lng: prof?.lng ?? null, lines: prof?.lines ?? [], service_radius_mi: prof?.service_radius_mi ?? 15, licensed_states: prof?.licensed_states ?? [], carrier: prof?.carrier ?? '', main_phone_e164: n, website: prof?.website ?? 'https://genesis-secure-solutions.vercel.app' },
  });
  if (error) return { err: error.message };
  await admin.from('tracking_numbers').update({ forward_to: n }).eq('tenant_id', house.id).is('released_at', null);
  revalidatePath('/', 'layout');
  return { ok: 'Saved: the Genovus line rings this phone.' };
}

export async function releaseTrackingNumber(id: string): Promise<Out> {
  await requireStaff();
  const admin = adminDb();
  const { data: n } = await admin.from('tracking_numbers').select('tenant_id, twilio_sid, e164, label').eq('id', id).maybeSingle();
  if (!n) return { err: 'Unknown number.' };
  try { if (n.twilio_sid) await releaseNumber(n.twilio_sid); } catch (e) { return { err: e instanceof Error ? e.message : 'Twilio did not release the number.' }; }
  const { error } = await (await db()).rpc('release_tracking_number', { p_id: id });
  if (error) return { err: error.message };
  revalidatePath('/', 'layout');
  return { ok: `${n.e164} released; it no longer rings the office.` };
}

export async function startPartnerRadar(tenantId: string, capDollars: number): Promise<Out> {
  const viewer = await requireStaff();
  if (!uuid.test(tenantId)) return { err: 'Unknown agency.' };
  if (!placesConfigured()) return { err: 'Google Places is not connected (GOOGLE_PLACES_API_KEY).' };
  const cap = Math.round(Math.max(1, Math.min(100, capDollars || 25)) * 100);
  try {
    const id = await startRadar(tenantId, cap, viewer.userId);
    const r = await runRadarSlice(id, 45_000);
    revalidatePath('/', 'layout');
    return { ok: r.status === 'running' ? `Radar started: ${r.found} partners so far ($${(Number(r.costCents) / 100).toFixed(2)}). It keeps going every 10 minutes until done or the $${cap / 100} cap.` : `Radar ${r.status === 'budget' ? 'stopped at the cap' : 'finished'}: ${r.found} partners found for $${(Number(r.costCents) / 100).toFixed(2)}.` };
  } catch (e) {
    return { err: e instanceof Error ? e.message : 'The radar could not start.' };
  }
}

/** Staff: map the agency's competitors out to `radiusMi`, stopping before the cap (spend, so staff only). */
export async function startCompetitorRadar(tenantId: string, radiusMi: number, capDollars: number): Promise<Out> {
  const viewer = await requireStaff();
  if (!uuid.test(tenantId)) return { err: 'Unknown agency.' };
  if (!placesConfigured()) return { err: 'Google Places is not connected (GOOGLE_PLACES_API_KEY).' };
  const radius = Math.round(Math.max(1, Math.min(25, radiusMi || 10)));
  const cap = Math.round(Math.max(1, Math.min(100, capDollars || 25)) * 100);
  try {
    const id = await startCompetitorScan(tenantId, radius, cap, viewer.userId);
    const r = await runCompetitorSlice(id, 45_000);
    revalidatePath('/', 'layout');
    const spent = `$${(Number(r.costCents) / 100).toFixed(2)}`;
    return { ok: r.status === 'running' ? `Competitor sweep started: ${r.found} offices so far (${spent}). It continues every 10 minutes until done or the $${cap / 100} cap.` : `Competitor sweep ${r.status === 'budget' ? 'stopped at the cap' : 'finished'}: ${r.found} new offices within ${radius} mi for ${spent}.` };
  } catch (e) {
    return { err: e instanceof Error ? e.message : 'The sweep could not start.' };
  }
}

/** A member or staff saves the radar's current filters as a named view. */
export async function saveRadarView(tenantId: string, v: { name: string; radius: number; carriers: string[]; zips: string[] }): Promise<Out> {
  if (!uuid.test(tenantId)) return { err: 'Unknown agency.' };
  const { error } = await (await db()).rpc('save_radar_view', { p_tenant: tenantId, p_name: String(v.name ?? '').slice(0, 80), p_radius: Math.round(Number(v.radius)), p_carriers: (v.carriers ?? []).slice(0, 20).map((c) => String(c).slice(0, 60)), p_zips: (v.zips ?? []).slice(0, 30).map((z) => String(z).slice(0, 5)) });
  revalidatePath('/', 'layout');
  return error ? { err: error.message } : { ok: `Saved “${String(v.name).slice(0, 80)}”.` };
}

export async function deleteRadarView(id: string): Promise<Out> {
  if (!uuid.test(id)) return { err: 'Unknown view.' };
  const { error } = await (await db()).rpc('delete_radar_view', { p_id: id });
  revalidatePath('/', 'layout');
  return error ? { err: error.message } : { ok: 'View deleted.' };
}

/** Correct (or clear) the business name on the agency's record of a partner. */
export async function namePartner(id: string, name: string): Promise<Out> {
  if (!(await getViewer().catch(() => null))) return { err: 'Sign in first.' };
  if (!uuid.test(id)) return { err: 'Unknown partner.' };
  const { error } = await (await db()).rpc('set_partner_name', { p_id: id, p_name: String(name ?? '').slice(0, 120) });
  revalidatePath('/', 'layout');
  return error ? { err: error.message } : { ok: name.trim() ? `Saved to your records as ${name.trim().slice(0, 120)}.` : 'Name removed from your records.' };
}

/** A member works a partner: call or visit outcome, status, next step, a contact they confirmed. `name`: the business
 *  name shown on the card they acted on, which becomes the agency's own record of it (migration 0073). */
export async function logPartner(f: { id: string; kind: string; status?: string; note?: string; next?: string; contact?: { name?: string; phone?: string; email?: string }; name?: string }): Promise<Out> {
  if (!(await getViewer().catch(() => null))) return { err: 'Sign in first.' };
  const next = f.next && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f.next) ? easternIso(f.next.slice(0, 10), f.next.slice(11)) : null;
  const { error } = await (await db()).rpc('log_partner', { p_id: f.id, p_kind: f.kind, p_status: f.status ?? null, p_note: f.note ?? null, p_next: next, p_contact: f.contact ?? {} });
  if (error) return { err: error.message === 'not allowed' ? 'That partner isn’t in your agency.' : error.message };
  if (f.name?.trim()) await (await db()).rpc('set_partner_name', { p_id: f.id, p_name: f.name.trim().slice(0, 120) });
  revalidatePath('/', 'layout');
  return { ok: f.status === 'meeting' ? 'Visit booked: it’s on your calendar.' : f.status === 'partner' ? 'New partner! Send them their referral link.' : 'Logged.' };
}

/** What a source cost this month (ad spend, a mailer), so Market can show cost per lead against the $50 vendor price. */
export async function setSourceCost(tenantId: string, source: string, dollars: number): Promise<Out> {
  if (!(await getViewer().catch(() => null))) return { err: 'Sign in first.' };
  const month = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 8) + '01';
  const { error } = await (await db()).rpc('set_source_cost', { p_tenant: tenantId, p_month: month, p_source: source, p_cents: Math.round(Math.max(0, dollars) * 100), p_note: null });
  if (error) return { err: error.message };
  revalidatePath('/', 'layout');
  return { ok: 'Cost saved: cost per lead is updated.' };
}
