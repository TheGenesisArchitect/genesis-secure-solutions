// Google Places API (New). Terms: only place IDs may be stored indefinitely; everything else is fetched live
// when shown (getDetails/getSummary), so nothing here writes Google's content to the database. Every call is
// metered (places_usage) against the monthly budget; once the budget is spent, live lookups pause too.
// Server only; the key is GOOGLE_PLACES_API_KEY. PLACES_API_BASE points tests at a stand-in.
import 'server-only';
import { cache } from 'react';
import { adminDb } from './supabase/admin';

const KEY = () => process.env.GOOGLE_PLACES_API_KEY || '';
const BASE = () => (process.env.PLACES_API_BASE || 'https://places.googleapis.com/v1').replace(/\/$/, '');
export const placesConfigured = () => Boolean(KEY());

// Cost estimates (USD cents per call) for the budget cap, from Google's list prices: Text Search with name and
// types bills as Text Search Pro; details with phone and website as Place Details Enterprise; name+address as
// Place Details Pro. Free monthly allowances are ignored, so the estimate errs high. Recheck when the
// budget changes.
export const COST_CENTS = { text_search: 3.2, details: 2.0, summary: 1.7 } as const;
type Sku = keyof typeof COST_CENTS;

export class PlacesError extends Error {}

export type FoundPlace = { id: string; name: string; types: string[] };

async function meter(sku: Sku) {
  try { await adminDb().rpc('bump_places_usage', { p_sku: sku, p_calls: 1, p_cost_cents: COST_CENTS[sku] }); } catch {}
}

/** This month's Google Places spend in cents (all SKUs), and the budget in cents. */
export const placesBudget = cache(async () => {
  const db = adminDb();
  const [{ data: spent }, { data: setting }] = await Promise.all([
    db.rpc('places_month_cents'),
    db.from('app_settings').select('value').eq('key', 'scan_budget_usd').maybeSingle(),
  ]);
  const budget = Math.round(Number(setting?.value ?? process.env.SCAN_BUDGET_USD ?? 150) * 100);
  return { spent: Number(spent ?? 0), budget };
});

async function call<T>(sku: Sku, path: string, init: { method?: string; body?: unknown; fields: string }): Promise<T> {
  if (!KEY()) throw new PlacesError('Google Places is not connected (GOOGLE_PLACES_API_KEY is not set).');
  const res = await fetch(BASE() + path, {
    method: init.method ?? 'GET',
    headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': init.fields, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  await meter(sku); // billed whether or not the answer is useful
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok) {
    const msg = body.error?.message ?? `HTTP ${res.status}`;
    console.error(`[places] ${path}: ${res.status} ${msg}`);
    throw new PlacesError(`Google Places: ${msg}`);
  }
  return body;
}

export type Rect = { south: number; west: number; north: number; east: number };

/** One page of a text search inside a rectangle (20 results a page, 3 pages at most per query). */
export async function textSearch(q: { query: string; rect: Rect; includedType?: string; pageToken?: string }) {
  const body = {
    textQuery: q.query,
    pageSize: 20,
    locationRestriction: { rectangle: { low: { latitude: q.rect.south, longitude: q.rect.west }, high: { latitude: q.rect.north, longitude: q.rect.east } } },
    ...(q.includedType ? { includedType: q.includedType, strictTypeFiltering: true } : {}),
    ...(q.pageToken ? { pageToken: q.pageToken } : {}),
  };
  const r = await call<{ places?: { id: string; displayName?: { text?: string }; types?: string[] }[]; nextPageToken?: string }>(
    'text_search', '/places:searchText', { method: 'POST', body, fields: 'places.id,places.displayName,places.types,nextPageToken' });
  const places: FoundPlace[] = (r.places ?? []).filter((p) => p.id).map((p) => ({ id: p.id, name: p.displayName?.text ?? '', types: p.types ?? [] }));
  return { places, next: r.nextPageToken };
}

export type PlaceDetails = { name: string; address: string; phone: string | null; website: string | null; mapsUrl: string | null; status: string | null };

/** Live details for display only; one fetch per place per page render; paused when the budget is spent. */
export const getDetails = cache(async (placeId: string): Promise<PlaceDetails | null> => {
  if (!placesConfigured()) return null;
  const b = await placesBudget();
  if (b.spent >= b.budget) return null;
  try {
    const p = await call<{ displayName?: { text?: string }; formattedAddress?: string; nationalPhoneNumber?: string; websiteUri?: string; googleMapsUri?: string; businessStatus?: string }>(
      'details', `/places/${encodeURIComponent(placeId)}`, { fields: 'displayName,formattedAddress,nationalPhoneNumber,websiteUri,googleMapsUri,businessStatus' });
    return { name: p.displayName?.text ?? '', address: p.formattedAddress ?? '', phone: p.nationalPhoneNumber ?? null, website: p.websiteUri ?? null, mapsUrl: p.googleMapsUri ?? null, status: p.businessStatus ?? null };
  } catch {
    return null;
  }
});

/** Name and address only (cheaper tier) for list rows; fetched live, never stored. */
export const getSummary = cache(async (placeId: string): Promise<{ name: string; address: string } | null> => {
  if (!placesConfigured()) return null;
  const b = await placesBudget();
  if (b.spent >= b.budget) return null;
  try {
    const p = await call<{ displayName?: { text?: string }; formattedAddress?: string }>('summary', `/places/${encodeURIComponent(placeId)}`, { fields: 'displayName,formattedAddress' });
    return { name: p.displayName?.text ?? '', address: p.formattedAddress ?? '' };
  } catch {
    return null;
  }
});

/** A website that is the office's own (not the carrier's agent page or a directory listing). */
export function isOwnSite(website: string | null, carrierHosts: string[]): boolean | null {
  if (!website) return false;
  try {
    const host = new URL(website).hostname.replace(/^www\./, '');
    if (carrierHosts.some((h) => host === h || host.endsWith('.' + h))) return false;
    if (/(facebook|instagram|linkedin|yelp|google)\.com$/.test(host)) return false;
    return true;
  } catch { return null; }
}

/** Google Maps attribution, required wherever Places content is shown without a Google map. */
export const GOOGLE_ATTRIBUTION = 'Office names, addresses and phones: Google Maps';
