// Consultation reminders (Scale Up workbook: "most no-shows aren't intentional, they just forgot"): a day before and an
// hour before every booked Genovus consultation, to the people on the invitation (not the team, who have the invite).
// Email only: no texts until A2P 10DLC. Queued into the outbox by the every-minute run; each reminder goes once per
// start time (a rescheduled call gets fresh ones), and none goes to someone who booked inside that window.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

const H = 3_600_000;
const et = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString('en-US', { ...o, timeZone: 'America/New_York' });
export const consultWhen = (iso: string) => et(iso, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const LEADS = [
  { lead: '24h', before: 24 * H, bookedBy: 24 * H }, // a day before, if they booked more than a day ahead
  { lead: '1h', before: 70 * 60_000, bookedBy: 3 * H }, // an hour before, unless they booked in the last few hours
] as const;

export async function queueConsultReminders(db: SupabaseClient, now = Date.now()) {
  const { data: rows } = await db.from('consult_invites')
    .select('id, tenant_id, label, emails, minutes, booked_at, inquiry_id, event:calendar_events!consult_invites_event_id_fkey(id, starts_at, status, location)')
    .not('booked_at', 'is', null)
    .gte('expires_at', new Date(now - 30 * 24 * H).toISOString());
  let queued = 0;
  for (const r of rows ?? []) {
    const ev = (Array.isArray(r.event) ? r.event[0] : r.event) as { id: string; starts_at: string; status: string; location: string | null } | null;
    if (!ev || ev.status !== 'scheduled') continue;
    const start = Date.parse(ev.starts_at), booked = Date.parse(r.booked_at as string);
    for (const l of LEADS) {
      if (start - now > l.before || start - now < (l.lead === '24h' ? 3 * H : 0) || start - booked < l.bookedBy) continue;
      const data = { lead: l.lead, first: String(r.label).split(/[ ,]/)[0], when: consultWhen(ev.starts_at), time: et(ev.starts_at, { hour: 'numeric', minute: '2-digit' }), day: et(ev.starts_at, { weekday: 'long' }), first_call: String(Boolean(r.inquiry_id)), minutes: String(r.minutes), place: ev.location ?? '' };
      const rows2 = (r.emails as string[]).map((to) => ({ tenant_id: r.tenant_id, to_email: to, template: 'consult_reminder', data, dedupe_key: `remind:${ev.id}:${start}:${l.lead}:${to}` }));
      const { data: ins } = await db.from('outbox').upsert(rows2, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id');
      queued += ins?.length ?? 0;
    }
  }
  return queued;
}
