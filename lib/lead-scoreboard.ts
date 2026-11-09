// The lead scoreboard (docs/LEAD_ENGINE_SPEC.md §4.8): by source, how fast the office reaches people and how many
// are quoted and bound, for what premium and at what cost. A figure built on too few leads says "not enough data yet",
// never 0. Pure and import-free, so the verify script can run it directly.

export type BoardLead = { source: string; status: string; created_at: string; first_contact_at: string | null; quoted_at?: string | null;
  bound_at?: string | null; premium_cents?: number | null; lines_bound?: string[] | null; contact_id?: string | null };
export type BoardCost = { source: string; cents: number };
export type BoardRow = {
  source: string; leads: number; enough: boolean;
  medianMin: number | null; contactRate: number | null; quoteRate: number | null; boundRate: number | null;
  bound: number; premiumCents: number; costCents: number | null; costPerBoundCents: number | null;
};

/** Fewer leads than this from a source: its rates aren't shown. */
export const MIN_LEADS = 5;

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const isQuoted = (l: BoardLead) => l.status === 'quoted' || l.status === 'won' || !!l.quoted_at;
const isBound = (l: BoardLead) => l.status === 'won';

export function scoreboard(leads: BoardLead[], costs: BoardCost[]): { rows: BoardRow[]; all: BoardRow; linesPerHousehold: number | null; households: number } {
  const row = (source: string, ls: BoardLead[]): BoardRow => {
    const n = ls.length, enough = n >= MIN_LEADS;
    const bound = ls.filter(isBound);
    const cost = costs.filter((c) => source === '*' || c.source === source).reduce((s, c) => s + c.cents, 0);
    const hasCost = costs.some((c) => source === '*' || c.source === source);
    return {
      source, leads: n, enough,
      medianMin: enough ? median(ls.filter((l) => l.first_contact_at).map((l) => (new Date(l.first_contact_at!).getTime() - new Date(l.created_at).getTime()) / 60_000)) : null,
      contactRate: enough ? ls.filter((l) => l.status !== 'new' || l.first_contact_at).length / n : null,
      quoteRate: enough ? ls.filter(isQuoted).length / n : null,
      boundRate: enough ? bound.length / n : null,
      bound: bound.length,
      premiumCents: bound.reduce((s, l) => s + (l.premium_cents ?? 0), 0),
      costCents: hasCost ? cost : null,
      costPerBoundCents: hasCost && bound.length ? Math.round(cost / bound.length) : null,
    };
  };
  const bySource = new Map<string, BoardLead[]>();
  for (const l of leads) bySource.set(l.source, [...(bySource.get(l.source) ?? []), l]);
  const rows = [...bySource.entries()].map(([s, ls]) => row(s, ls)).sort((a, b) => b.leads - a.leads);
  // Lines per household: the distinct lines bound per person (contact), across everyone who bound anything.
  const homes = new Map<string, Set<string>>();
  for (const l of leads.filter(isBound)) {
    const k = l.contact_id ?? `lead:${l.created_at}:${l.source}`;
    const set = homes.get(k) ?? new Set<string>();
    for (const x of l.lines_bound ?? []) set.add(x);
    homes.set(k, set);
  }
  const counted = [...homes.values()].filter((s) => s.size);
  return { rows, all: row('*', leads), linesPerHousehold: counted.length >= MIN_LEADS ? counted.reduce((s, x) => s + x.size, 0) / counted.length : null, households: counted.length };
}
