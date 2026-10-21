// An agency's calendar: events (meetings the team, Genovus or Helix added), follow-ups (with their time), booked
// consults (from the pipeline), scheduled posts and partner visits, in one list per day. The dashboard page and the subscribe feed (iCal) read the same items. The feed link is signed
// per agency (HMAC of its id), so only someone holding it can read the calendar.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type CalItem = {
  id: string; kind: 'event' | 'follow-up' | 'consult' | 'post' | 'visit'; title: string; detail: string | null; start: string; allDay: boolean;
  /** Events only: when it ends, where, its id, who set it up (agency or genovus) and whether invites went out. */
  end?: string; location?: string | null; eventId?: string; host?: string; invited?: boolean;
};

const secret = () => process.env.CALENDAR_FEED_SECRET || process.env.CRON_SECRET || '';
export const feedEnabled = () => Boolean(secret());
export const feedToken = (tenantId: string) => createHmac('sha256', secret()).update(`calendar:${tenantId}`).digest('hex').slice(0, 40);
export function feedTokenOk(tenantId: string, token: string): boolean {
  if (!secret() || !/^[0-9a-f]{40}$/.test(token)) return false;
  return timingSafeEqual(Buffer.from(feedToken(tenantId)), Buffer.from(token));
}

/** Eastern wall time "YYYY-MM-DD" + "HH:MM" → an ISO instant (the office's clock, DST-aware). */
export function easternIso(day: string, time: string): string {
  // Read the wall time as if it were UTC, see what New York shows for that instant, and shift by the difference.
  // Computed from Intl parts so it is right whatever timezone the server runs in.
  const [y, m, d] = day.split('-').map(Number), [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(guess + (guess - shown)).toISOString();
}

export async function calendarItems(db: SupabaseClient, tenantId: string, from: string, to: string): Promise<CalItem[]> {
  const [ev, fu, leads, posts, visits] = await Promise.all([
    db.from('calendar_events').select('id, title, starts_at, ends_at, location, notes, host, invited_at').eq('tenant_id', tenantId).eq('status', 'scheduled').gte('starts_at', `${from}T00:00:00Z`).lte('starts_at', `${to}T23:59:59Z`).limit(300),
    db.from('follow_ups').select('id, who, reason, due_on, due_at').eq('tenant_id', tenantId).eq('status', 'open').gte('due_on', from).lte('due_on', to).limit(500),
    db.from('leads').select('id, name, topic, phone, booked_for').eq('tenant_id', tenantId).eq('status', 'booked').gte('booked_for', `${from}T00:00:00Z`).lte('booked_for', `${to}T23:59:59Z`).limit(500),
    db.from('content_items').select('id, channel, copy, status, scheduled_for').eq('tenant_id', tenantId).in('status', ['approved', 'scheduled', 'published']).gte('scheduled_for', `${from}T00:00:00Z`).lte('scheduled_for', `${to}T23:59:59Z`).limit(200),
    db.from('partner_targets').select('id, category, contact_name, next_action_at').eq('tenant_id', tenantId).eq('status', 'meeting').gte('next_action_at', `${from}T00:00:00Z`).lte('next_action_at', `${to}T23:59:59Z`).limit(100),
  ]);
  const items: CalItem[] = [];
  for (const e of ev.data ?? []) items.push({ id: `ev-${e.id}`, kind: 'event', title: e.title, detail: e.notes, start: e.starts_at, end: e.ends_at, allDay: false, location: e.location, eventId: e.id, host: e.host, invited: Boolean(e.invited_at) });
  for (const f of fu.data ?? []) items.push({ id: `fu-${f.id}`, kind: 'follow-up', title: `Call ${f.who}`, detail: f.reason, start: f.due_at ? easternIso(f.due_on, String(f.due_at).slice(0, 5)) : `${f.due_on}T12:00:00.000Z`, allDay: !f.due_at });
  for (const l of leads.data ?? []) items.push({ id: `cs-${l.id}`, kind: 'consult', title: `Consult: ${l.name}`, detail: [l.topic, l.phone].filter(Boolean).join(' · ') || null, start: l.booked_for!, allDay: false });
  for (const p of posts.data ?? []) items.push({ id: `po-${p.id}`, kind: 'post', title: `${p.channel[0].toUpperCase()}${p.channel.slice(1)} post (${p.status})`, detail: String(p.copy ?? '').slice(0, 140), start: p.scheduled_for!, allDay: false });
  for (const v of visits.data ?? []) items.push({ id: `pv-${v.id}`, kind: 'visit', title: `Partner visit${v.contact_name ? `: ${v.contact_name}` : ''}`, detail: v.category.replace(/-/g, ' '), start: v.next_action_at!, allDay: false });
  return items.sort((a, b) => a.start.localeCompare(b.start));
}

/** The office's calendar day of an instant (Eastern). */
export const dayOf = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

/** iCalendar text for a set of items (RFC 5545, minimal and widely accepted). */
export function toIcs(name: string, items: CalItem[]): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const now = stamp(new Date().toISOString());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Genovus//Agency Calendar//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  for (const it of items) {
    const end = it.end ?? new Date(new Date(it.start).getTime() + (it.kind === 'consult' || it.kind === 'visit' ? 60 : 15) * 60_000).toISOString();
    lines.push('BEGIN:VEVENT', `UID:${it.id}@genovus.io`, `DTSTAMP:${now}`);
    if (it.allDay) { const d = dayOf(it.start).replace(/-/g, ''); lines.push(`DTSTART;VALUE=DATE:${d}`); }
    else lines.push(`DTSTART:${stamp(it.start)}`, `DTEND:${stamp(end)}`);
    lines.push(`SUMMARY:${esc(it.title)}`, ...(it.detail ? [`DESCRIPTION:${esc(it.detail)}`] : []), ...(it.location ? [`LOCATION:${esc(it.location)}`] : []), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
