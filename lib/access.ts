// What one agency can use right now: everything its program includes, plus any module Genovus staff granted it
// (indefinitely, or as a trial until a date). One shell, scaled by these switches. Read once per request.
import 'server-only';
import { cache } from 'react';
import { db } from '@/lib/supabase/server';
import { MODULES, includes, programOf, type ProgramId, type ProgramModule } from '@/lib/programs';

export type Access = {
  program: ProgramId;
  /** Module keys the agency can open. */
  keys: Set<string>;
  /** Granted modules beyond the program, with their end date (null = no end). */
  grants: Map<string, string | null>;
  has: (key: string) => boolean;
  /** The soonest-ending trial, for the "trial · N days left" note. */
  trial: { until: string; days: number; keys: string[] } | null;
};

export const accessFor = cache(async (tenantId: string, plan: string | null): Promise<Access> => {
  const program = programOf(plan);
  const { data } = await (await db()).from('module_grants').select('module_key, until').eq('tenant_id', tenantId).is('revoked_at', null);
  const now = Date.now();
  const grants = new Map<string, string | null>();
  for (const g of data ?? []) if (!g.until || new Date(g.until).getTime() > now) grants.set(g.module_key, g.until);
  const keys = new Set(MODULES.filter((m) => includes(program, m) || grants.has(m.key)).map((m) => m.key));
  const timed = [...grants.entries()].filter(([k, u]) => u && !MODULES.some((m) => m.key === k && includes(program, m))) as [string, string][];
  const soonest = timed.sort((a, b) => a[1].localeCompare(b[1]))[0];
  const trial = soonest ? { until: soonest[1], days: Math.max(0, Math.ceil((new Date(soonest[1]).getTime() - now) / 86_400_000)), keys: timed.filter(([, u]) => u === soonest[1]).map(([k]) => k) } : null;
  return { program, keys, grants, has: (k) => keys.has(k), trial };
});

/** Modules the agency can open that are live in the product. */
export const liveModules = (a: Access): ProgramModule[] => MODULES.filter((m) => m.live && a.keys.has(m.key));
