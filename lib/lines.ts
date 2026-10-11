// Lines of business: what an agency actually sells. The agency profile lists its lines, and everything that finds
// or talks to customers reads them: the partner radar's categories, Market's seasonal moments, campaign offers,
// Helix's hard lines and the copy check. Nothing outside an agency's lines is ever proposed. Pure data, no I/O.

export type LineId = 'auto' | 'home' | 'renters' | 'boat' | 'rv' | 'motorcycle' | 'condo' | 'umbrella' | 'life' | 'commercial';

/** A kind of local business whose customers buy this line, so it can refer them. */
export type PartnerCategory = { key: string; label: string; query: string; includedType?: string; weight: number; pitch: string };
/** A moment in the year when people need this line (months 1-12). */
export type Moment = { months: number[]; label: string; why: string };

export type Line = { id: LineId; label: string; words: RegExp; partners: PartnerCategory[]; moments: Moment[]; offers: string[] };

export const LINES: Record<LineId, Line> = {
  auto: {
    id: 'auto', label: 'Auto', words: /\b(auto|car|vehicle|driver)s?\b/i,
    partners: [
      { key: 'car-dealer', label: 'Car dealership', query: 'car dealership', includedType: 'car_dealer', weight: 30, pitch: 'Every car they sell drives off needing insurance; we answer their buyers the same day.' },
      { key: 'auto-repair', label: 'Auto repair or body shop', query: 'auto body shop', weight: 18, pitch: 'Customers after an accident often want a second look at their coverage.' },
    ],
    moments: [
      { months: [5, 6, 7, 8], label: 'Teen drivers', why: 'School is out and new drivers get licensed: families add a driver.' },
      { months: [2, 3, 4], label: 'Tax refund car buying', why: 'Refund season is the busiest time for used-car purchases.' },
      { months: [10, 11, 12], label: 'Year-end deals', why: 'Dealers push year-end sales, and new cars need a policy.' },
    ],
    offers: ['Auto quote review', 'New teen driver'],
  },
  home: {
    id: 'home', label: 'Home', words: /\b(home|homeowners?|house|dwelling)\b/i,
    partners: [
      { key: 'realtor', label: 'Real estate agent', query: 'real estate agency', includedType: 'real_estate_agency', weight: 30, pitch: 'Every closing needs proof of home insurance; a fast binder-ready contact helps their deals close.' },
      { key: 'mortgage', label: 'Mortgage lender', query: 'mortgage lender', weight: 24, pitch: 'Lenders need insurance in place before closing; a responsive agent keeps their timeline.' },
      { key: 'title', label: 'Title company', query: 'title company', weight: 16, pitch: 'Title officers see every closing and the last-minute insurance scramble.' },
      { key: 'builder', label: 'Home builder', query: 'home builder', weight: 14, pitch: 'New construction buyers need a policy at move-in.' },
    ],
    moments: [
      { months: [4, 5, 6, 7, 8], label: 'Moving season', why: 'Most home purchases close in spring and summer: new homeowners need a policy.' },
      { months: [6, 7, 8, 9, 10], label: 'Storm season', why: 'Hurricane and storm season gets people reviewing their home coverage.' },
    ],
    offers: ['Bundle home and auto', 'New homeowners'],
  },
  renters: {
    id: 'renters', label: 'Renters', words: /\brent(ers?|al)\b/i,
    partners: [
      { key: 'apartments', label: 'Apartment community', query: 'apartment complex', includedType: 'apartment_complex', weight: 22, pitch: 'Many leases require renters insurance; residents need a quick, local option.' },
      { key: 'property-manager', label: 'Property manager', query: 'property management company', weight: 18, pitch: 'Managers want every tenant covered from move-in day.' },
    ],
    moments: [{ months: [5, 6, 7, 8], label: 'Lease season', why: 'Summer is peak move-in season, and leases ask for renters insurance.' }],
    offers: ['Renters: move-in ready'],
  },
  boat: {
    id: 'boat', label: 'Boat', words: /\b(boat|watercraft|jet ?ski|pontoon)s?\b/i,
    partners: [
      { key: 'boat-dealer', label: 'Boat dealer', query: 'boat dealer', weight: 30, pitch: 'Every boat they sell needs coverage before it hits the water.' },
      { key: 'marina', label: 'Marina or boat storage', query: 'marina', weight: 20, pitch: 'Slip and storage contracts often require proof of boat insurance.' },
    ],
    moments: [{ months: [3, 4, 5, 6], label: 'Boating season', why: 'Boats come out of storage in spring: owners buy or renew coverage.' }],
    offers: ['Boating season'],
  },
  rv: {
    id: 'rv', label: 'RV', words: /\b(rv|motorhome|camper|travel trailer)s?\b/i,
    partners: [
      { key: 'rv-dealer', label: 'RV dealer', query: 'RV dealer', weight: 30, pitch: 'Every RV sold or traded needs a policy before the first trip.' },
      { key: 'rv-park', label: 'RV park or campground', query: 'RV park', includedType: 'rv_park', weight: 16, pitch: 'Long-stay guests and full-timers need coverage that fits how they live.' },
      { key: 'rv-storage', label: 'RV storage', query: 'RV storage', weight: 12, pitch: 'Stored RVs still need coverage, and owners often ask about it.' },
    ],
    moments: [{ months: [3, 4, 5, 6], label: 'RV season', why: 'Spring is when RVs get bought and taken out for the year.' }],
    offers: ['RV season'],
  },
  motorcycle: {
    id: 'motorcycle', label: 'Motorcycle', words: /\b(motorcycles?|bikes?|scooters?)\b/i,
    partners: [{ key: 'moto-dealer', label: 'Motorcycle dealer', query: 'motorcycle dealer', weight: 24, pitch: 'Every bike they sell needs coverage before the ride home.' }],
    moments: [{ months: [3, 4, 5], label: 'Riding season', why: 'Bikes come out in spring: new riders and renewals.' }],
    offers: ['Riding season'],
  },
  condo: { id: 'condo', label: 'Condo', words: /\bcondo(minium)?s?\b/i, partners: [], moments: [], offers: [] },
  umbrella: { id: 'umbrella', label: 'Umbrella', words: /\bumbrella\b/i, partners: [], moments: [], offers: [] },
  life: { id: 'life', label: 'Life', words: /\blife (insurance|policy|coverage)\b/i, partners: [], moments: [], offers: [] },
  commercial: { id: 'commercial', label: 'Commercial', words: /\b(commercial|business insurance|workers'? comp|general liability)\b/i, partners: [], moments: [], offers: [] },
};

export const lineIds = (lines: string[] | null | undefined): LineId[] => (lines ?? []).filter((l): l is LineId => l in LINES);
export const lineLabels = (lines: string[] | null | undefined) => lineIds(lines).map((l) => LINES[l].label);

/** The partner categories an agency's radar searches: only those whose customers buy its lines. */
export const partnerCategories = (lines: string[] | null | undefined) => lineIds(lines).flatMap((l) => LINES[l].partners.map((p) => ({ ...p, line: l })));

/** What's happening in the agency's market this month (and next), for its lines only. */
export function momentsNow(lines: string[] | null | undefined, month = new Date().getMonth() + 1) {
  const next = (month % 12) + 1;
  return lineIds(lines).flatMap((l) => LINES[l].moments.filter((m) => m.months.includes(month) || m.months.includes(next)).map((m) => ({ ...m, line: l, label: m.label, starting: !m.months.includes(month) })));
}

/** Lines mentioned in some copy that the agency does not sell (for the compliance check and Helix's guard). */
export function offLineMentions(text: string, lines: string[] | null | undefined): string[] {
  const mine = new Set(lineIds(lines));
  if (!mine.size) return [];
  return (Object.values(LINES) as Line[]).filter((l) => !mine.has(l.id) && l.words.test(text)).map((l) => l.label);
}
