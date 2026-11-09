// The lead score (docs/LEAD_ENGINE_SPEC.md §4.4): rules first, 0–100, every point with its reason, like partnerFit.
// It only sets order and routing. It never decides eligibility or price and never uses protected traits (Colorado's
// AI Act from 2027-01-01 is one reason to keep it this way). Pure: the minute's run (lib/lead-checks.ts) feeds it.
import { LINES, lineIds, type Line } from './lines';
import { areaCodeState, AREA_CODE_STATES } from './area-codes';

export type LeadForScore = {
  topic: string | null; message: string | null; phone_e164: string | null; asks: number;
  requested_for: string | null; booked_for: string | null; x_date?: string | null;
};
export type ProfileForScore = { lines: string[] | null; licensed_states: string[] | null };
export type Checks = { phone?: boolean | null; line_type?: { ok: boolean | null; type?: string } | null; email?: boolean | null };
export type Score = { score: number; reasons: string[]; outOfLine: boolean; verified: boolean };

const asked = (l: LeadForScore) => `${l.topic ?? ''} ${l.message ?? ''}`;

export function scoreLead(l: LeadForScore, p: ProfileForScore | null, c: Checks): Score {
  const reasons: string[] = [];
  let pts = 0;
  // The line asked about. Only what the agency writes counts; a request only for other lines is flagged, never billable.
  const mine = lineIds(p?.lines);
  const text = asked(l);
  const hits = (Object.values(LINES) as Line[]).filter((x) => x.words.test(text));
  const inLine = hits.filter((x) => mine.includes(x.id));
  let outOfLine = false;
  if (inLine.length) { pts += 30; reasons.push(`+30 asks about ${inLine.map((x) => x.label).join(' and ')}, a line you write`); }
  else if (hits.length && mine.length) { outOfLine = true; reasons.push(`Outside your lines: ${hits.map((x) => x.label).join(', ')}`); }
  else reasons.push('Line not stated');
  // Where they are, from the area code (a hint: numbers move with people).
  const st = areaCodeState(l.phone_e164);
  const licensed = (p?.licensed_states ?? []).map((s) => s.toUpperCase());
  if (st && licensed.includes(st)) { pts += 20; reasons.push(`+20 ${st} area code, a state you're licensed in`); }
  else if (st && AREA_CODE_STATES.includes(st) && licensed.length) reasons.push(`${st} area code, outside your licensed states`);
  // Can they be reached? With the carrier lookup on, its answer decides; otherwise a well-formed number counts for half.
  const lt = c.line_type;
  let phoneOk = false;
  if (lt && lt.ok != null) {
    phoneOk = lt.ok;
    if (lt.ok) { pts += 20; reasons.push(`+20 phone checked with the carrier${lt.type ? ` (${lt.type})` : ''}`); }
    else reasons.push('Phone number is not in service');
  } else if (c.phone) { phoneOk = true; pts += 10; reasons.push('+10 phone number is well-formed (not checked with the carrier)'); }
  else if (c.phone === false) reasons.push('Phone number is not a valid US number');
  if (c.email === true) { pts += 10; reasons.push('+10 email domain takes mail'); }
  else if (c.email === false) reasons.push('Email domain does not take mail');
  // Intent.
  if (l.x_date) {
    const days = (new Date(`${l.x_date}T12:00:00Z`).getTime() - Date.now()) / 86_400_000;
    if (days >= 0 && days <= 60) { pts += 10; reasons.push('+10 renews within 60 days'); }
  }
  if (l.booked_for || l.requested_for) { pts += 10; reasons.push('+10 picked a time'); }
  if (l.asks > 1) { pts += 5; reasons.push(`+5 asked ${l.asks} times`); }
  return { score: outOfLine ? 0 : Math.min(100, pts), reasons, outOfLine, verified: phoneOk || c.email === true };
}
