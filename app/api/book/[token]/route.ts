// The client's pick from their private consultation link: only one of the times still open, once; it books the
// session on the Genovus calendar and sends everyone the invite (migration 0084 book_consult).
import { adminDb } from '@/lib/supabase/admin';
import { consultSlots, inviteFor, whenLabel } from '@/lib/consult';
import { consultWhen } from '@/lib/consult-reminders';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return Response.json({ ok: false, error: 'Not allowed.' }, { status: 403 });
  const inv = await inviteFor((await ctx.params).token);
  if (!inv) return Response.json({ ok: false, error: 'This link isn’t valid.' }, { status: 404 });
  if (inv.bookedAt) return Response.json({ ok: false, error: `This consultation is already booked${inv.eventStart ? ` for ${whenLabel(inv.eventStart)}` : ''}.` }, { status: 409 });
  if (inv.expired) return Response.json({ ok: false, error: 'This link has expired. Reply to the email and we’ll send a new one.' }, { status: 410 });
  const b = (await req.json().catch(() => ({}))) as { iso?: string };
  const slots = await consultSlots(inv);
  if (!b.iso || !slots.some((s) => s.iso === b.iso)) return Response.json({ ok: false, error: 'That time was just taken. Please pick another.' }, { status: 409 });
  const { data: eventId, error } = await adminDb().rpc('book_consult', { p_invite: inv.id, p_start: b.iso });
  if (error) return Response.json({ ok: false, error: /taken|another/.test(error.message) ? 'That time was just taken. Please pick another.' : /already/.test(error.message) ? 'This consultation is already booked.' : 'We couldn’t book that. Please try again.' }, { status: 409 });
  // A booking from the website: tell the team's phones too (outbox team_push; the calendar invite is on its way).
  if (inv.firstCall) {
    // The confirmation (lib/email.ts consult_confirm): what the call is for, one question, and the film.
    const ev = (await adminDb().from('calendar_events').select('location').eq('id', eventId).maybeSingle()).data;
    const data = { first: inv.label.split(/[ ,]/)[0], when: consultWhen(b.iso), minutes: String(inv.minutes), place: ev?.location ?? '' };
    await adminDb().from('outbox').upsert(inv.emails.map((to) => ({ tenant_id: inv.houseId, to_email: to, template: 'consult_confirm', data, dedupe_key: `consult-confirm:${inv.id}:${to}` })), { onConflict: 'dedupe_key', ignoreDuplicates: true });
    await adminDb().from('outbox').insert({ tenant_id: inv.houseId, to_email: 'push', template: 'team_push', dedupe_key: `consult-push:${inv.id}`,
      data: { title: `Consultation booked · ${inv.label}`, body: `${whenLabel(b.iso)} (Eastern), booked on genovus.io.`, url: '/console/inquiries', tag: `consult-${inv.id.slice(0, 24)}` } });
  }
  return Response.json({ ok: true, message: `You’re booked for ${whenLabel(b.iso)} (Eastern). The calendar invite is on its way to ${inv.emails.join(', ')}.` });
}
