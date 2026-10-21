// A meeting invite as an iCalendar file (RFC 5545 / iTIP): REQUEST adds or updates it on the attendee's calendar
// (Gmail, Outlook and Apple show Yes / No / Maybe), CANCEL removes it. The UID matches the agency's calendar feed,
// so an accepted invite and the subscribed feed are the same event, and SEQUENCE makes a re-send replace the old copy.
import 'server-only';

export type Meeting = { id: string; title: string; starts: string; ends: string; location: string; notes: string; attendees: string[]; sequence: number; cancelled: boolean };

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Lines over 75 octets fold onto continuation lines that start with a space.
const fold = (line: string) => { const out: string[] = []; let s = line; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = ' ' + s.slice(n); } out.push(s); return out.join('\r\n'); };

export function meetingIcs(m: Meeting, organizer: string, organizerName = 'Genovus'): string {
  const method = m.cancelled ? 'CANCEL' : 'REQUEST';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Genovus//Meeting invite//EN', 'CALSCALE:GREGORIAN', `METHOD:${method}`,
    'BEGIN:VEVENT', `UID:ev-${m.id}@genovus.io`, `SEQUENCE:${m.sequence}`, `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(m.starts)}`, `DTEND:${stamp(m.ends)}`, `SUMMARY:${esc(m.title)}`,
    ...(m.location ? [`LOCATION:${esc(m.location)}`] : []), ...(m.notes ? [`DESCRIPTION:${esc(m.notes)}`] : []),
    `ORGANIZER;CN="${organizerName.replace(/["\\;,:\r\n]/g, ' ').trim()}":mailto:${organizer}`,
    ...m.attendees.map((a) => `ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a}`),
    `STATUS:${m.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(m.cancelled ? [] : ['BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${esc(m.title)}`, 'END:VALARM']),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** "Thu, Oct 22 · 10:30 AM – 12:00 PM ET" in the office's time. */
export function meetingWhen(starts: string, ends: string): string {
  const tz = { timeZone: 'America/New_York' } as const;
  const day = new Date(starts).toLocaleDateString('en-US', { ...tz, weekday: 'short', month: 'short', day: 'numeric' });
  const t = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { ...tz, hour: 'numeric', minute: '2-digit' });
  return `${day} · ${t(starts)} – ${t(ends)} ET`;
}
