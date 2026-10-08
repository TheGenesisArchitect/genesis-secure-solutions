// The National Network Scanner's sweep. Each state is tiled into cells; every cell is searched once per
// carrier in the catalog (scan_enabled) plus one generic insurance-agency search for independents. A query
// that fills all 3 pages (60 results) may be hiding more, so the cell splits into four and re-queues.
// Runs in short, resumable slices (cron) and stops at the monthly budget. Stores only place IDs and our own
// classification (carrier, segment, and the state whose area was searched); see lib/places.ts for the Google
// terms this follows. Time and budget are checked between areas, so a slice never discards paid-for results.
import 'server-only';
import { adminDb } from './supabase/admin';
import { COST_CENTS, textSearch, type Rect } from './places';
import { classify, fit, type CarrierRule } from './classify';
import { startingCells } from './geo-states';

const MIN_CELL_DEG = 0.04; // ~4 km: stop splitting below this
const PAGES = 3;

export type SliceResult = { run: number; cells: number; requests: number; costCents: number; found: number; status: 'done' | 'more' | 'budget' | 'idle'; note?: string };

export async function scanSettings() {
  const db = adminDb();
  const { data } = await db.from('app_settings').select('key, value').in('key', ['scan_states', 'scan_budget_usd', 'scan_sweep_started']);
  const get = (k: string) => data?.find((r) => r.key === k)?.value;
  const states = String(get('scan_states') ?? process.env.SCAN_STATES ?? 'GA,AL,FL,TX').split(',').map((s: string) => s.trim().toUpperCase()).filter((s: string) => /^[A-Z]{2}$/.test(s));
  const budgetUsd = Number(get('scan_budget_usd') ?? process.env.SCAN_BUDGET_USD ?? 150);
  return { states, budgetCents: Math.round(budgetUsd * 100), sweepStarted: get('scan_sweep_started') ?? null };
}

/** All Google Places spend this month (sweep searches and on-screen lookups), in cents. */
export async function monthSpendCents() {
  const { data } = await adminDb().rpc('places_month_cents');
  return Number(data ?? 0);
}

/** Make sure every focus state has starting cells. */
async function seedCells(states: string[]) {
  const db = adminDb();
  for (const st of states) {
    const { count } = await db.from('scan_cells').select('id', { count: 'exact', head: true }).eq('state', st);
    if (count) continue;
    const rows = startingCells(st).map((c) => ({ state: st, ...c, depth: 0 }));
    if (rows.length) await db.from('scan_cells').upsert(rows, { onConflict: 'state,south,west,north,east', ignoreDuplicates: true });
  }
}

/** Run one slice of the sweep, within `deadlineMs` and the monthly budget. */
export async function runSlice(opts: { deadlineMs?: number; maxRequests?: number } = {}): Promise<SliceResult> {
  const db = adminDb();
  const t0 = Date.now(), deadline = opts.deadlineMs ?? 45_000, maxReq = opts.maxRequests ?? 400;
  const settings = await scanSettings();
  await seedCells(settings.states);

  const { data: carriersRaw } = await db.from('carriers').select('id, slug, aliases, query, model, fit_score, fit_reasons, scan_enabled');
  const carriers = (carriersRaw ?? []) as (CarrierRule & { query: string | null; scan_enabled: boolean })[];
  const queries = carriers.filter((c) => c.scan_enabled && c.query).map((c) => ({ q: c.query!, type: c.model === 'independent' ? 'insurance_agency' : undefined }));
  if (!queries.length) return { run: 0, cells: 0, requests: 0, costCents: 0, found: 0, status: 'idle', note: 'No carriers are switched on for scanning.' };

  const spent = await monthSpendCents();
  if (spent >= settings.budgetCents) return { run: 0, cells: 0, requests: 0, costCents: 0, found: 0, status: 'budget', note: `Monthly scan budget reached ($${(spent / 100).toFixed(2)}).` };

  const { data: run } = await db.from('scan_runs').insert({}).select('id').single();
  const runId = run!.id as number;
  let requests = 0, found = 0, cellsDone = 0;
  let status: SliceResult['status'] = 'more';
  const cost = () => Math.round(requests * COST_CENTS.text_search);
  // Worst case for one area: every query fills all pages.
  const cellWorst = queries.length * PAGES * COST_CENTS.text_search;

  try {
    outer: while (Date.now() - t0 < deadline) {
      const { data: cells } = await db.from('scan_cells').select('*').eq('status', 'pending').in('state', settings.states).order('depth', { ascending: false }).order('id').limit(5);
      if (!cells?.length) { status = 'done'; break; }
      for (const cell of cells) {
        if (spent + cost() + cellWorst > settings.budgetCents) { status = 'budget'; break outer; }
        if (requests >= maxReq || Date.now() - t0 > deadline) break outer;
        const rect: Rect = { south: cell.south, west: cell.west, north: cell.north, east: cell.east };
        let full = false;
        const seen = new Map<string, { carrier: string | null; segment: string }>();
        for (const q of queries) {
          let token: string | undefined;
          let got = 0;
          for (let page = 0; page < PAGES; page++) {
            const r = await textSearch({ query: q.q, rect, includedType: q.type, pageToken: token });
            requests++;
            got += r.places.length;
            for (const p of r.places) {
              const k = classify(p.name, p.types, carriers);
              if (!k) continue;
              const prev = seen.get(p.id);
              // A carrier match wins over "independent" when the same office appears in several searches.
              if (!prev || (prev.segment === 'independent' && k.segment === 'captive')) seen.set(p.id, { carrier: k.carrier?.id ?? null, segment: k.segment });
            }
            token = r.next;
            if (!token) break;
          }
          if (got >= PAGES * 20) full = true;
        }
        // Save what this cell found: place IDs and our classification only.
        const now = new Date().toISOString();
        const ids = [...seen.keys()];
        const { data: existing } = ids.length ? await db.from('prospects').select('place_id').in('place_id', ids) : { data: [] };
        const known = new Set((existing ?? []).map((e) => e.place_id));
        const rows = [...seen.entries()].map(([place_id, v]) => {
          const c = carriers.find((x) => x.id === v.carrier);
          const state = cell.state; // the state whose area we searched (our own data), not a Google coordinate
          // Base fit (carrier + focus state); first-party and live signals refine it on the prospect page.
          const base = fit({ carrierFit: c?.fit_score ?? 50, carrierReasons: [], state, focusStates: settings.states }).score;
          return { place_id, carrier_id: v.carrier, segment: v.segment, state, cell_id: cell.id, last_seen: now, missed_sweeps: 0, fit_score: base };
        });
        if (rows.length) {
          const { error } = await db.from('prospects').upsert(rows, { onConflict: 'place_id' });
          if (error) throw new Error(error.message);
        }
        found += ids.filter((id) => !known.has(id)).length;
        const canSplit = full && cell.north - cell.south > MIN_CELL_DEG * 2 && cell.east - cell.west > MIN_CELL_DEG * 2;
        if (canSplit) {
          const mlat = Math.round(((cell.south + cell.north) / 2) * 1e5) / 1e5, mlon = Math.round(((cell.west + cell.east) / 2) * 1e5) / 1e5;
          const kids = [
            { south: cell.south, north: mlat, west: cell.west, east: mlon }, { south: cell.south, north: mlat, west: mlon, east: cell.east },
            { south: mlat, north: cell.north, west: cell.west, east: mlon }, { south: mlat, north: cell.north, west: mlon, east: cell.east },
          ].map((k) => ({ state: cell.state, depth: cell.depth + 1, ...k }));
          await db.from('scan_cells').upsert(kids, { onConflict: 'state,south,west,north,east', ignoreDuplicates: true });
        }
        await db.from('scan_cells').update({ status: canSplit ? 'split' : 'done', last_scanned: now, results: seen.size }).eq('id', cell.id);
        cellsDone++;
      }
    }
  } catch (e) {
    await db.from('scan_runs').update({ finished_at: new Date().toISOString(), requests, est_cost_cents: cost(), found_new: found, status: 'error', note: e instanceof Error ? e.message.slice(0, 300) : 'error' }).eq('id', runId);
    throw e;
  }
  if (status === 'done') await finishSweep();
  await db.from('scan_runs').update({ finished_at: new Date().toISOString(), requests, est_cost_cents: cost(), found_new: found, status: status === 'more' ? 'done' : status }).eq('id', runId);
  return { run: runId, cells: cellsDone, requests, costCents: cost(), found, status };
}

/** When every cell is done: offices not seen since the sweep began count a miss; two misses = closed. */
async function finishSweep() {
  const db = adminDb();
  const { sweepStarted } = await scanSettings();
  if (!sweepStarted) return;
  const { data: missed } = await db.from('prospects').select('id, missed_sweeps, status').lt('last_seen', sweepStarted);
  for (const p of missed ?? []) {
    const n = p.missed_sweeps + 1;
    await db.from('prospects').update({ missed_sweeps: n, ...(n >= 2 && ['new', 'verified'].includes(p.status) ? { status: 'closed' } : {}) }).eq('id', p.id);
  }
  await db.from('app_settings').delete().eq('key', 'scan_sweep_started');
}

/** Start a fresh sweep (monthly): every leaf cell goes back to pending. */
export async function startSweep() {
  const db = adminDb();
  await db.from('scan_cells').update({ status: 'pending' }).eq('status', 'done');
  await db.from('app_settings').upsert({ key: 'scan_sweep_started', value: new Date().toISOString(), updated_at: new Date().toISOString() });
}
