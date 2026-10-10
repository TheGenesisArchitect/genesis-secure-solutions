// Real counts from the National Network Scanner for the World page and Helix's tour: aggregates only (never a
// name, address or contact), read with the service client and cached for an hour. Null when the database has
// no prospects (preview) or can't be reached, so callers fall back to copy without figures.
import 'server-only';
import { unstable_cache } from 'next/cache';
import { adminDb } from '@/lib/supabase/admin';

export type WorldStats = {
  offices: number;
  captive: number;
  independent: number;
  highFit: number;
  engaged: number;
  won: number;
  states: number;
  carriers: number;
  asOf: string;
};

const GONE = new Set(['closed', 'opted_out']);
const ENGAGED = new Set(['contacting', 'replied', 'consult', 'proposal']);

async function read(): Promise<WorldStats | null> {
  try {
    const db = adminDb();
    const rows: { state: string | null; carrier_id: string | null; segment: string; status: string; fit_score: number }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('prospects').select('state, carrier_id, segment, status, fit_score').order('id').range(from, from + 999);
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const live = rows.filter((r) => !GONE.has(r.status));
    if (!live.length) return null;
    return {
      offices: live.length,
      captive: live.filter((r) => r.segment === 'captive').length,
      independent: live.filter((r) => r.segment === 'independent').length,
      highFit: live.filter((r) => r.fit_score >= 70).length,
      engaged: live.filter((r) => ENGAGED.has(r.status)).length,
      won: live.filter((r) => r.status === 'won').length,
      states: new Set(live.map((r) => r.state).filter(Boolean)).size,
      carriers: new Set(live.map((r) => r.carrier_id).filter(Boolean)).size,
      asOf: new Date().toISOString(),
    };
  } catch (e) {
    console.error(`[world-stats] ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

export const worldStats = unstable_cache(read, ['world-stats-v1'], { revalidate: 3600 });

/** The 100-agency goal as a share of the offices mapped, and first-year revenue at the Launch and Growth prices. */
export const GOAL_AGENCIES = 100;
export const firstYear = (setup: number, monthly: number, n = GOAL_AGENCIES) => n * (setup + monthly * 12);

/** One sentence of real figures for Helix to quote (and call real). */
export function statsLine(s: WorldStats | null) {
  if (!s) return 'the live scanner has mapped thousands of real agency offices and keeps sweeping';
  const n = (x: number) => x.toLocaleString('en-US');
  return `the live scanner has mapped ${n(s.offices)} real agency offices across ${s.states} states and ${s.carriers} carriers (${n(s.captive)} captive, ${n(s.independent)} independent; ${n(s.highFit)} with a fit score of 70 or more). The goal of ${GOAL_AGENCIES} agencies is ${(GOAL_AGENCIES / s.offices * 100).toFixed(1)} percent of what is already mapped`;
}
