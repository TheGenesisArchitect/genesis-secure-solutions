// A program for life at a locked monthly rate (migration 0109): a thank-you for founding clients. JAVA Agency
// (Mendez Hollis), our first client, has Growth for life at his launch rate. The Home congratulations card, the
// "Your program" page, the client email (template lifetime_growth) and startCare all read it from here, so the
// numbers the client sees are the same everywhere.
import { MODULES, PROGRAM_NAME, type ProgramId } from './programs';
import { careName, careRate } from './billing';

export type LifetimeRow = {
  lifetime_plan: string | null; lifetime_rate_cents: number | null; lifetime_waived_cents: number | null;
  lifetime_since: string | null; lifetime_seen_at?: string | null;
};
export type Lifetime = {
  program: ProgramId; name: string; careName: string;
  rateCents: number; listCents: number; savedMonthCents: number; savedYearCents: number; waivedCents: number;
  since: string | null; seen: boolean;
  /** What the program adds over Launch, live now (label and blurb). */
  adds: { label: string; blurb: string }[];
};

export const LIFETIME_COLUMNS = 'lifetime_plan, lifetime_rate_cents, lifetime_waived_cents, lifetime_since, lifetime_seen_at';

export const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: c % 100 ? 2 : 0, minimumFractionDigits: c % 100 ? 2 : 0 })}`;

export function lifetimeOf(t: LifetimeRow | null | undefined): Lifetime | null {
  const p = t?.lifetime_plan;
  if (p !== 'growth' && p !== 'premium' || t?.lifetime_rate_cents == null) return null;
  const list = careRate[p];
  const saved = Math.max(0, list - t.lifetime_rate_cents);
  return {
    program: p, name: PROGRAM_NAME[p], careName: careName[p],
    rateCents: t.lifetime_rate_cents, listCents: list, savedMonthCents: saved, savedYearCents: saved * 12,
    waivedCents: t.lifetime_waived_cents ?? 0, since: t.lifetime_since, seen: !!t.lifetime_seen_at,
    adds: MODULES.filter((m) => m.live && !m.option && m.tier !== 'launch' && (p === 'premium' || m.tier === 'growth')).map((m) => ({ label: m.label, blurb: m.blurb })),
  };
}
