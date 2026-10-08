// Shared prospect helpers for the console pages: labels, a state's main time zone (for calling hours), and
// the carrier hosts that do not count as an office's own website.
import 'server-only';

export const STATUS_LABEL: Record<string, string> = {
  new: 'New', verified: 'Verified', contacting: 'Contacting', replied: 'Replied', consult: 'Consult booked', proposal: 'Proposal',
  won: 'Won', not_now: 'Not now', opted_out: 'Opted out', closed: 'Closed',
};
export const OPEN_STATUSES = ['new', 'verified', 'contacting', 'replied', 'consult', 'proposal'];

export const OUTCOMES: [string, string, string | null][] = [
  // [outcome, label, status it sets]
  ['no_answer', 'No answer', 'contacting'],
  ['voicemail', 'Left voicemail', 'contacting'],
  ['interested', 'Talked: interested', 'replied'],
  ['consult', 'Booked a consult', 'consult'],
  ['not_now', 'Not now', 'not_now'],
  ['wrong_number', 'Wrong number / not an agent', 'closed'],
  ['opt_out', 'Asked not to be contacted', 'opted_out'],
];

// Carrier agent-page hosts: a site on these is the carrier's page, not the office's own.
export const CARRIER_HOSTS = ['statefarm.com', 'allstate.com', 'agents.allstate.com', 'farmers.com', 'agents.farmers.com', 'geico.com', 'amfam.com', 'fbfs.com', 'countryfinancial.com', 'shelterinsurance.com'];

const TZ: Record<string, string> = {
  CT: 'America/New_York', DE: 'America/New_York', DC: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', IN: 'America/Indiana/Indianapolis',
  KY: 'America/New_York', ME: 'America/New_York', MD: 'America/New_York', MA: 'America/New_York', MI: 'America/Detroit', NH: 'America/New_York',
  NJ: 'America/New_York', NY: 'America/New_York', NC: 'America/New_York', OH: 'America/New_York', PA: 'America/New_York', RI: 'America/New_York',
  SC: 'America/New_York', VT: 'America/New_York', VA: 'America/New_York', WV: 'America/New_York',
  AL: 'America/Chicago', AR: 'America/Chicago', IL: 'America/Chicago', IA: 'America/Chicago', KS: 'America/Chicago', LA: 'America/Chicago', MN: 'America/Chicago',
  MS: 'America/Chicago', MO: 'America/Chicago', NE: 'America/Chicago', ND: 'America/Chicago', OK: 'America/Chicago', SD: 'America/Chicago', TN: 'America/Chicago',
  TX: 'America/Chicago', WI: 'America/Chicago',
  AZ: 'America/Phoenix', CO: 'America/Denver', ID: 'America/Boise', MT: 'America/Denver', NM: 'America/Denver', UT: 'America/Denver', WY: 'America/Denver',
  CA: 'America/Los_Angeles', NV: 'America/Los_Angeles', OR: 'America/Los_Angeles', WA: 'America/Los_Angeles', AK: 'America/Anchorage', HI: 'Pacific/Honolulu',
};

/** Local time at the office and whether it is a good time to call (weekday, 9:30–4:30). */
export function officeClock(state: string | null, now = new Date()) {
  const tz = TZ[state ?? ''] ?? 'America/New_York';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: false }).formatToParts(now).map((p) => [p.type, p.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const weekday = !['Sat', 'Sun'].includes(parts.weekday);
  return {
    label: new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(now),
    callable: weekday && minutes >= 570 && minutes <= 990,
  };
}
