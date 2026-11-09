// US area codes by state, for the states Genovus agencies are licensed in today (GA, AL, FL). A lead's area code is
// a hint, not an address (people keep their number when they move), so it adds to the score but never subtracts.
// Add a state here when an agency licensed there signs on; an unknown area code scores as "unknown", never as out of area.
const BY_STATE: Record<string, number[]> = {
  GA: [229, 404, 470, 478, 678, 706, 762, 770, 912, 943],
  AL: [205, 251, 256, 334, 659, 938],
  FL: [239, 305, 321, 324, 352, 386, 407, 448, 561, 645, 656, 689, 727, 728, 754, 772, 786, 813, 850, 863, 904, 941, 954],
};

const STATE_OF = new Map<number, string>(Object.entries(BY_STATE).flatMap(([st, codes]) => codes.map((c) => [c, st] as [number, string])));

/** The state of a +1 number's area code, or null when it isn't in the table. */
export function areaCodeState(e164: string | null | undefined): string | null {
  const m = /^\+1(\d{3})\d{7}$/.exec(e164 ?? '');
  return m ? STATE_OF.get(Number(m[1])) ?? null : null;
}

/** States the table covers, so "outside" is only said about a state we actually know. */
export const AREA_CODE_STATES = Object.keys(BY_STATE);
