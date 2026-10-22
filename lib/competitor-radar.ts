// Competitor Radar: the insurance offices around one agency. A capped sweep searches a box around the office (the
// chosen radius) for insurance agencies, splits any area whose search fills all three pages, keeps offices inside
// the radius, and tags each one with the scanner's carrier classifier. Google terms (as lib/places.ts and the partner
// radar): only the place ID is stored, with our own classification (carrier, segment, miles, bearing); names,
// ratings, reviews, addresses and websites are fetched live when shown. Runs in resumable slices (the scan cron) and
// never starts a search that could cross the cap.
import 'server-only';
import { adminDb } from './supabase/admin';
import { COST_CENTS, textSearch, type Rect } from './places';
import { classify, type CarrierRule } from './classify';

const PAGES = 3;
const MIN_SPAN_DEG = 0.03; // ~2 miles: stop splitting below this
const QUERY = 'insurance agency';

type Job = { rect: Rect };
type Point = { lat: number; lng: number };

export const milesBetween = (a: Point, b: Point) => {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
/** Compass bearing from a to b, 0 = north, clockwise, whole degrees. */
export const bearing = (a: Point, b: Point) => {
  const rad = Math.PI / 180, y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return Math.round((Math.atan2(y, x) / rad + 360) % 360) % 360;
};
const boxAround = (lat: number, lng: number, miles: number): Rect => {
  const dLat = miles / 69, dLng = miles / (69 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, north: lat + dLat, west: lng - dLng, east: lng + dLng };
};
const quarters = (r: Rect): Rect[] => {
  const mLat = (r.south + r.north) / 2, mLng = (r.west + r.east) / 2;
  return [{ south: r.south, west: r.west, north: mLat, east: mLng }, { south: r.south, west: mLng, north: mLat, east: r.east }, { south: mLat, west: r.west, north: r.north, east: mLng }, { south: mLat, west: mLng, north: r.north, east: r.east }];
};

export { sweepEstimate } from './radar-estimate';

/** Start (or restart) an agency's competitor sweep out to `radiusMi`. Returns the scan id. */
export async function startCompetitorScan(tenantId: string, radiusMi: number, capCents: number, startedBy: string | null) {
  const db = adminDb();
  const { data: p } = await db.from('agency_profiles').select('lat, lng').eq('tenant_id', tenantId).maybeSingle();
  if (!p?.lat || !p?.lng) throw new Error('Set the office address in the agency profile first (it centers the radar).');
  await db.from('competitor_scans').update({ status: 'stopped', finished_at: new Date().toISOString() }).eq('tenant_id', tenantId).eq('status', 'running');
  const queue: Job[] = [{ rect: boxAround(p.lat, p.lng, radiusMi) }];
  const { data, error } = await db.from('competitor_scans').insert({ tenant_id: tenantId, radius_mi: radiusMi, cap_cents: capCents, queue, started_by: startedBy }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/** Work one running sweep until the deadline, the cap, or the queue is empty. */
export async function runCompetitorSlice(scanId: string, deadlineMs = 40_000) {
  const db = adminDb();
  const t0 = Date.now();
  const { data: s } = await db.from('competitor_scans').select('*').eq('id', scanId).single();
  if (!s || s.status !== 'running') return { status: s?.status ?? 'missing', found: 0, requests: 0, costCents: 0 };
  const { data: p } = await db.from('agency_profiles').select('lat, lng, carrier').eq('tenant_id', s.tenant_id).single();
  const office = { lat: p!.lat as number, lng: p!.lng as number };
  const { data: carriersRaw } = await db.from('carriers').select('id, slug, name, aliases, model, fit_score, fit_reasons');
  const carriers = (carriersRaw ?? []) as (CarrierRule & { name: string })[];
  const own = String(p?.carrier ?? '').toLowerCase();
  const queue = [...(s.queue as Job[])];
  let requests = s.requests as number, cost = Number(s.cost_cents), found = s.found as number, status: string = 'running';
  let ownPlace: string | null = s.own_place_id ?? null;
  while (queue.length) {
    if (Date.now() - t0 > deadlineMs) break;
    if (cost + PAGES * COST_CENTS.text_search > s.cap_cents) { status = 'budget'; break; } // never start a job that could cross the cap
    const job = queue.shift()!;
    const rows: { tenant_id: string; place_id: string; carrier_id: string | null; carrier: string; segment: string; distance_mi: number; bearing_deg: number; last_seen: string }[] = [];
    let token: string | undefined, pages = 0, count = 0;
    try { do {
      const r = await textSearch({ query: QUERY, rect: job.rect, includedType: 'insurance_agency', pageToken: token, withLocation: true });
      requests++; cost += COST_CENTS.text_search; pages++;
      count += r.places.length;
      for (const pl of r.places) {
        if (pl.lat == null || pl.lng == null) continue;
        const c = classify(pl.name, pl.types, carriers);
        if (!c) continue;
        const miles = milesBetween(office, { lat: pl.lat, lng: pl.lng });
        if (miles > s.radius_mi) continue;
        // The agency’s own office (its carrier, within half a mile of the geocoded address; Google’s pin can sit a few
        // hundred yards off) is "you", not a competitor.
        if (miles < 0.5 && own && c.carrier && ((c.carrier as { name?: string }).name ?? c.carrier.slug).toLowerCase().includes(own)) { ownPlace = pl.id; continue; }
        rows.push({ tenant_id: s.tenant_id, place_id: pl.id, carrier_id: c.carrier?.id ?? null, carrier: c.segment === 'independent' ? 'Independent' : (c.carrier as { name?: string } | null)?.name ?? 'Other carrier', segment: c.segment, distance_mi: Math.round(miles * 10) / 10, bearing_deg: bearing(office, { lat: pl.lat, lng: pl.lng }), last_seen: new Date().toISOString() });
      }
      token = r.next;
    } while (token && pages < PAGES); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[competitors] ${msg}`);
      // A search that never ran is not "done": put the area back. No key = a setup problem, so the sweep fails
      // (and says why); anything else (a timeout, a Google hiccup) is retried on the next run.
      if (pages === 0) { queue.unshift(job); status = /not connected|not set/i.test(msg) ? 'failed' : status; break; }
    }
    if (rows.length) {
      const { data: before } = await db.from('competitor_offices').select('place_id').eq('tenant_id', s.tenant_id).in('place_id', rows.map((r) => r.place_id));
      const known = new Set((before ?? []).map((r) => r.place_id));
      await db.from('competitor_offices').upsert(rows, { onConflict: 'tenant_id,place_id' });
      found += rows.filter((r) => !known.has(r.place_id)).length;
    }
    const full = count >= PAGES * 20;
    if (full && job.rect.north - job.rect.south > MIN_SPAN_DEG * 2) queue.push(...quarters(job.rect).map((rect) => ({ rect })));
  }
  if (status === 'running' && !queue.length) status = 'done';
  await db.from('competitor_scans').update({ queue, requests, cost_cents: cost, found, status, own_place_id: ownPlace, ...(status !== 'running' ? { finished_at: new Date().toISOString() } : {}) }).eq('id', scanId);
  return { status, found, requests, costCents: cost };
}

/** Continue every running sweep (called from the scan cron). */
export async function runCompetitorScans(deadlineMs = 15_000) {
  const { data } = await adminDb().from('competitor_scans').select('id').eq('status', 'running').order('started_at').limit(3);
  const out = [];
  for (const r of data ?? []) out.push(await runCompetitorSlice(r.id, deadlineMs / Math.max(1, (data ?? []).length)));
  return out;
}
