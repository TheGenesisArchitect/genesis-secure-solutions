// Pure rules the scanner and the prospect views share: which carrier an office belongs to (from its name and
// types, at scan time) and how well it fits Genovus. No I/O, so it is unit-tested directly.

export type CarrierRule = { id: string; slug: string; aliases: string[]; model: string; fit_score: number; fit_reasons: string[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Match an office name to a carrier by its aliases (whole words, any case). Independents never match. */
export function classify(name: string, types: string[] | undefined, carriers: CarrierRule[]):
  { carrier: CarrierRule | null; segment: 'captive' | 'independent' } | null {
  const n = ` ${name.replace(/\s+/g, ' ').trim()} `;
  // A carrier's name inside a business name is not enough ("Allstate Plumbing", "State Farm Road Diner"):
  // the place must also be an insurance business, by Google's type or its own name.
  const insurance = Boolean(types?.includes('insurance_agency')) || /\b(insurance|agent|agency|financial)\b/i.test(name);
  if (!insurance) return null;
  for (const c of carriers) {
    if (!c.aliases.length || c.model === 'independent') continue;
    if (c.aliases.some((a) => new RegExp(`(^|[^A-Za-z0-9])${esc(a)}([^A-Za-z0-9]|$)`, 'i').test(n))) return { carrier: c, segment: 'captive' };
  }
  // Not a carrier's office: keep it only if Google types it as an insurance agency.
  if (types?.includes('insurance_agency')) return { carrier: carriers.find((c) => c.slug === 'independent') ?? null, segment: 'independent' };
  return null;
}

export type FitInput = {
  carrierFit: number; carrierReasons: string[]; state: string | null; focusStates: string[];
  hasOwnSite?: boolean | null; contactKnown?: boolean; status?: string;
};

/** Fit score 0–100 with plain reasons. Live Google signals (own website) are passed in when known. */
export function fit(i: FitInput): { score: number; reasons: string[] } {
  let score = i.carrierFit;
  const reasons = [...i.carrierReasons];
  if (i.state && i.focusStates.includes(i.state)) { score += 5; reasons.push(`In a focus state (${i.state})`); }
  if (i.hasOwnSite === false) { score += 8; reasons.push('No website of its own: only a carrier page or none'); }
  if (i.hasOwnSite === true) { score -= 4; reasons.push('Already has its own website'); }
  if (i.contactKnown) { score += 2; reasons.push('A contact is on file'); }
  if (i.status === 'opted_out' || i.status === 'closed') { score = 0; reasons.unshift(i.status === 'opted_out' ? 'Opted out: never contact' : 'Office closed'); }
  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}
