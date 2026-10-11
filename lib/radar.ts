// The referral partner radar: Genovus's National Network Scanner, pointed at one agency's market. It searches a
// box around the office (the profile's radius) once per partner category that fits the agency's lines (car dealers
// for Auto, realtors and lenders for Home, marinas for Boat, ...), splits any area whose search fills all three
// pages, and keeps only businesses inside the radius. Google terms: only the place ID is stored, plus our own
// classification (line, category, a distance in miles, a fit score); names and phones are fetched live when shown.
// Runs in resumable slices from the scan cron and stops at the agency's cap (default $25) before going over it.
import 'server-only';
import { adminDb } from './supabase/admin';
import { COST_CENTS, textSearch, type Rect } from './places';
import { partnerCategories } from './lines';

const PAGES = 3;
const MIN_SPAN_DEG = 0.03; // ~2 miles: stop splitting below this

type Job = { cat: string; line: string; query: string; type?: string; weight: number; rect: Rect };

const milesBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const boxAround = (lat: number, lng: number, miles: number): Rect => {
  const dLat = miles / 69, dLng = miles / (69 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
};
const quarters = (r: Rect): Rect[] => {
  const mLat = (r.south + r.north) / 2, mLng = (r.west + r.east) / 2;
  return [{ south: r.south, west: r.west, north: mLat, east: mLng }, { south: r.south, west: mLng, north: mLat, east: r.east }, { south: mLat, west: r.west, north: r.north, east: mLng }, { south: mLat, west: mLng, north: r.north, east: r.east }];
};
/** Fit: how much the category's customers need the agency's lines, plus closeness. Season is added when shown. */
export const partnerFit = (weight: number, miles: number) => Math.min(100, Math.round(weight + (miles <= 3 ? 40 : miles <= 7 ? 30 : miles <= 12 ? 20 : 10) + 20));

/** Start (or restart) an agency's radar from its profile. Returns the scan id. */
export async function startRadar(tenantId: string, capCents = 2500, startedBy: string | null = null) {
  const db = adminDb();
  const { data: p } = await db.from('agency_profiles').select('lat, lng, lines, service_radius_mi').eq('tenant_id', tenantId).maybeSingle();
  if (!p?.lat || !p?.lng) throw new Error('Set the office address in the agency profile first (it places the radar).');
  const cats = partnerCategories(p.lines);
  if (!cats.length) throw new Error('Choose the agency’s lines of business first; the radar only looks for partners that fit them.');
  await db.from('partner_scans').update({ status: 'stopped', finished_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('status', 'running');
  const rect = boxAround(p.lat, p.lng, p.service_radius_mi);
  const queue: Job[] = cats.map((c) => ({ cat: c.key, line: c.line, query: c.query, type: c.includedType, weight: c.weight, rect }));
  const { data, error } = await db.from('partner_scans').insert({ tenant_id: tenantId, cap_cents: capCents, radius_mi: p.service_radius_mi, queue, started_by: startedBy }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Work one running scan until the deadline, the cap, or the queue is empty. */
export async function runRadarSlice(scanId: string, deadlineMs = 40_000) {
  const db = adminDb();
  const t0 = Date.now();
  const { data: s } = await db.from('partner_scans').select('*').eq('id', scanId).single();
  if (!s || s.status !== 'running') return { status: s?.status ?? 'missing', found: 0 };
  const { data: p } = await db.from('agency_profiles').select('lat, lng, service_radius_mi').eq('tenant_id', s.tenant_id).single();
  const office = { lat: p!.lat as number, lng: p!.lng as number };
  const queue = [...(s.queue as Job[])];
  let requests = s.requests as number, cost = Number(s.cost_cents), found = s.found as number, status: string = 'running';
  const { data: sup } = await db.from('suppression').select('place_id').not('place_id', 'is', null);
  const suppressed = new Set((sup ?? []).map((r) => r.place_id as string));
  while (queue.length) {
    if (Date.now() - t0 > deadlineMs) break;
    if (cost + PAGES * COST_CENTS.text_search > s.cap_cents) { status = 'budget'; break; } // never start a job that could cross the cap
    const job = queue.shift()!;
    const seen: { id: string; miles: number }[] = [];
    let token: string | undefined, pages = 0, count = 0;
    try { do {
      const r = await textSearch({ query: job.query, rect: job.rect, includedType: job.type, pageToken: token, withLocation: true });
      requests++; cost += COST_CENTS.text_search; pages++;
      count += r.places.length;
      for (const pl of r.places) {
        if (pl.lat == null || pl.lng == null || suppressed.has(pl.id)) continue;
        if (pl.types.includes('insurance_agency')) continue; // another agency is never a referral partner
        const miles = milesBetween(office, { lat: pl.lat, lng: pl.lng });
        if (miles <= s.radius_mi) seen.push({ id: pl.id, miles: Math.round(miles * 10) / 10 });
      }
      token = r.next;
    } while (token && pages < PAGES); } catch (e) { console.error(`[radar] ${job.cat}: ${e instanceof Error ? e.message : e}`); }
    if (seen.length) {
      const rows = seen.map((x) => ({ tenant_id: s.tenant_id, place_id: x.id, line: job.line, category: job.cat, distance_mi: x.miles, fit: partnerFit(job.weight, x.miles) }));
      const { data: ins } = await db.from('partner_targets').upsert(rows, { onConflict: 'tenant_id,place_id', ignoreDuplicates: true }).select('id');
      found += ins?.length ?? 0;
    }
    const full = count >= PAGES * 20;
    if (full && job.rect.north - job.rect.south > MIN_SPAN_DEG * 2) queue.push(...quarters(job.rect).map((rect) => ({ ...job, rect })));
  }
  if (status === 'running' && !queue.length) status = 'done';
  await db.from('partner_scans').update({ queue, requests, cost_cents: cost, found, status, ...(status !== 'running' ? { finished_at: new Date().toISOString() } : {}) }).eq('id', scanId);
  return { status, found, requests, costCents: cost };
}

/** Continue every running radar (called from the scan cron). */
export async function runRadars(deadlineMs = 40_000) {
  const { data } = await adminDb().from('partner_scans').select('id').eq('status', 'running').order('started_at').limit(3);
  const out = [];
  for (const r of data ?? []) out.push(await runRadarSlice(r.id, deadlineMs / Math.max(1, (data ?? []).length)));
  return out;
}
