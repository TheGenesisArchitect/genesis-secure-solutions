// Pick-a-time consultations (migration 0084): the team sends a private link; the client sees the Genovus calendar's
// open times (weekdays 9 to 5 office time, nothing else about the calendar) and picks one; the session lands on the
// Genovus calendar and the meeting invite goes to everyone on the invitation. Website bookings (migration 0086) are
// first calls: they come from the intake form, not a team member. Server only.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminDb } from './supabase/admin';
import { openTimes } from './helix-lookups';
import { easternIso } from './agency-calendar';

const SECRET = () => process.env.CONSULT_LINK_SECRET || process.env.PROPOSAL_LINK_SECRET || process.env.MEDIA_LINK_SECRET || process.env.CRON_SECRET || '';
const sig = (id: string) => createHmac('sha256', SECRET()).update(`consult:${id}`).digest('base64url').slice(0, 24);
export const consultToken = (id: string) => (SECRET() ? `${id}.${sig(id)}` : null);
export function consultFrom(token: string): string | null {
  const [id, s] = token.split('.');
  if (!SECRET() || !id || !s || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const want = Buffer.from(sig(id)), got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

export type Invite = { id: string; label: string; minutes: number; emails: string[]; expired: boolean; bookedAt: string | null; eventStart: string | null; houseId: string; firstCall: boolean };
export async function inviteFor(token: string): Promise<Invite | null> {
  const id = consultFrom(token);
  if (!id) return null;
  const db = adminDb();
  const { data: ci } = await db.from('consult_invites').select('id, tenant_id, label, minutes, emails, expires_at, booked_at, event_id, inquiry_id').eq('id', id).maybeSingle();
  if (!ci) return null;
  const ev = ci.event_id ? (await db.from('calendar_events').select('starts_at').eq('id', ci.event_id).maybeSingle()).data : null;
  return { id: ci.id, label: ci.label, minutes: ci.minutes, emails: ci.emails, expired: Date.parse(ci.expires_at) < Date.now(), bookedAt: ci.booked_at, eventStart: ev?.starts_at ?? null, houseId: ci.tenant_id, firstCall: Boolean(ci.inquiry_id) };
}

/** Every open half-hour start for this consultation's length over the next two weeks: the instants and labels only. */
export async function consultSlots(inv: Invite): Promise<{ iso: string; label: string }[]> {
  const open = await openTimes(adminDb(), inv.houseId, { minutes: inv.minutes, days: 10, perDay: 16, max: 120 });
  return open.slots.map((x: { day: string; time: string; label: string }) => ({ iso: easternIso(x.day, x.time), label: x.label }));
}

export const whenLabel = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
