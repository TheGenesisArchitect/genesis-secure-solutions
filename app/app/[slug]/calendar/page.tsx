// Calendar (Growth): the agency's week in one place: events (meetings), follow-ups, booked consults, scheduled posts and
// partner visits, day by day, with a private link to subscribe from Google or Apple Calendar. The team (or Helix, with a
// yes) adds and cancels events here.
import Link from 'next/link';
import { headers } from 'next/headers';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { CopyButton } from '@/components/CopyButton';
import { Panel, Chip } from '@/components/ui';
import { ActionForm } from '@/components/ActionForm';
import { addEvent, cancelEvent } from '@/lib/actions';
import { BookingPanel } from '@/components/BookingPanel';
import { openTimes } from '@/lib/helix-lookups';
import { getSummary } from '@/lib/places';
import { partnerCategories } from '@/lib/lines';
import { db } from '@/lib/supabase/server';
import { businessToday } from '@/lib/billing';
import { accessFor } from '@/lib/access';
import { calendarItems, dayOf, feedEnabled, feedToken } from '@/lib/agency-calendar';

export const metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

const KIND: Record<string, [string, string]> = { event: ['Event', 'info'],'follow-up': ['Follow-up', 'pending'], consult: ['Consult', 'done'], post: ['Post', 'info'], visit: ['Partner visit', 'done'] };
const add = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d: string) => { const x = new Date(`${d}T12:00:00Z`); return add(d, -((x.getUTCDay() + 6) % 7)); };
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export default async function Calendar({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ week?: string; book?: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  if (!access.has('calendar')) return <AgencyShell ctx={ctx} title="Calendar"><ModuleGate ctx={ctx} moduleKey="calendar" /></AgencyShell>;
  const today = businessToday();
  const sp = await searchParams;
  const wk = sp.week;
  const start = mondayOf(wk && /^\d{4}-\d{2}-\d{2}$/.test(wk) ? wk : today);
  const days = Array.from({ length: 7 }, (_, i) => add(start, i));
  const supabase = await db();
  const items = await calendarItems(supabase, ctx.tenant.tenantId, start, days[6]);
  // Booking from a partner card or a lead (?book=partner:<id> or lead:<id>): who, and the open times to suggest.
  const [bookKind, bookId] = String(sp.book ?? '').split(':');
  const booking = (bookKind === 'partner' || bookKind === 'lead') && /^[0-9a-f-]{36}$/.test(bookId ?? '') ? await (async () => {
    if (bookKind === 'partner') {
      const { data: p } = await supabase.from('partner_targets').select('id, place_id, category, status, next_action_at').eq('tenant_id', ctx.tenant.tenantId).eq('id', bookId).maybeSingle();
      if (!p) return null;
      const { data: prof } = await supabase.from('agency_profiles').select('lines').eq('tenant_id', ctx.tenant.tenantId).maybeSingle();
      const name = (await getSummary(p.place_id))?.name || partnerCategories(prof?.lines).find((c) => c.key === p.category)?.label || 'this partner';
      return { kind: 'partner' as const, who: name, done: p.status === 'meeting' && p.next_action_at ? new Date(p.next_action_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : null };
    }
    const { data: l } = await supabase.from('leads').select('id, name, status, booked_for').eq('tenant_id', ctx.tenant.tenantId).eq('id', bookId).maybeSingle();
    if (!l) return null;
    return { kind: 'lead' as const, who: l.name, done: l.status === 'booked' && l.booked_for ? new Date(l.booked_for).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : null };
  })() : null;
  const slots = booking ? (await openTimes(supabase, ctx.tenant.tenantId, { minutes: 60, days: 5 })).slots : [];
  const h = await headers();
  const feed = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}/api/calendar/${slug}?k=${feedToken(ctx.tenant.tenantId)}`;
  const base = `/app/${slug}/calendar`;
  return (
    <AgencyShell ctx={ctx} title="Calendar" actions={<span className="row" style={{ gap: 6 }}><Link className="btn small ghost" href={`${base}?week=${add(start, -7)}`}>← Last week</Link><Link className="btn small ghost" href={base}>This week</Link><Link className="btn small ghost" href={`${base}?week=${add(start, 7)}`}>Next week →</Link></span>}>
      {booking ? (
        <Panel title={`Book a ${booking.kind === 'partner' ? 'visit' : 'consult'} with ${booking.who}`} sub="Helix checked your calendar for open times. Pick one, or choose your own.">
          <BookingPanel target={`${booking.kind}:${bookId}`} who={booking.who} kind={booking.kind} slots={slots} done={booking.done} />
        </Panel>
      ) : null}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Week of {dayLabel(start)} · {items.filter((i) => i.kind === 'event').length} events, {items.filter((i) => i.kind === 'consult').length} consults, {items.filter((i) => i.kind === 'follow-up').length} follow-ups, {items.filter((i) => i.kind === 'post').length} posts</p>
      <div className="week">
        {days.map((d) => {
          const mine = items.filter((i) => dayOf(i.start) === d);
          return (
            <section key={d} className={'week-day' + (d === today ? ' today' : '')} aria-label={dayLabel(d)}>
              <header><b>{dayLabel(d)}</b>{d === today ? <Chip kind="info">Today</Chip> : null}</header>
              {mine.length ? mine.map((i) => (
                <div key={i.id} className={`cal-item ${i.kind}`} data-helix-item={i.kind === 'event' ? i.title : undefined}>
                  <span className="row" style={{ gap: 6 }}><Chip kind={KIND[i.kind][1]}>{KIND[i.kind][0]}</Chip><span className="muted" style={{ fontSize: 12 }}>{i.allDay ? 'Any time' : i.end ? `${time(i.start)} – ${time(i.end)}` : time(i.start)}</span>{i.host === 'genovus' ? <Chip kind="done">With Genovus</Chip> : null}</span>
                  <b style={{ fontSize: 14 }}>{i.title}</b>
                  {i.location ? <span className="muted" style={{ fontSize: 12 }}>{i.location}</span> : null}
                  {i.detail ? <span className="muted" style={{ fontSize: 12 }}>{i.detail}</span> : null}
                  {i.kind === 'event' && i.eventId ? (
                    <ActionForm action={cancelEvent} helix="cancel event" helixTitle={`Cancel ${i.title}`}>
                      <input type="hidden" name="id" value={i.eventId} />
                      <button className="btn small ghost" type="submit" style={{ padding: '2px 8px', fontSize: 12 }}>Cancel event</button>
                    </ActionForm>
                  ) : null}
                </div>
              )) : <span className="muted" style={{ fontSize: 12 }}>Open</span>}
            </section>
          );
        })}
      </div>
      <Panel title="Add an event" sub="A meeting, a training, a partner lunch, in office time. Or ask Helix: “put carrier training on Thursday at 10:30”.">
        <ActionForm action={addEvent} className="form" resetOnOk helix="event" helixTitle="New event">
          <input type="hidden" name="tenant" value={ctx.tenant.tenantId} />
          <label className="field"><span>What</span><input className="input" name="title" required maxLength={160} placeholder="e.g. Carrier setup with Genovus" autoComplete="off" /></label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: 2, minWidth: 150 }}><span>Day</span><input className="input" type="date" name="day" required defaultValue={today} /></label>
            <label className="field" style={{ flex: 1, minWidth: 110 }}><span>Starts</span><input className="input" type="time" name="start" required defaultValue="10:00" /></label>
            <label className="field" style={{ flex: 1, minWidth: 110 }}><span>Ends</span><input className="input" type="time" name="end" defaultValue="11:00" /></label>
          </div>
          <label className="field"><span>Where <span className="muted">(optional)</span></span><input className="input" name="location" maxLength={200} placeholder="The office, a video link, an address" autoComplete="off" /></label>
          <label className="field"><span>Notes <span className="muted">(optional)</span></span><input className="input" name="notes" maxLength={1000} placeholder="What to bring or prepare" autoComplete="off" /></label>
          <button className="btn primary" type="submit">Add to the calendar</button>
        </ActionForm>
      </Panel>
      {feedEnabled() ? <Panel title="See it on your phone’s calendar" sub="Subscribe once in Google Calendar (Other calendars → From URL) or Apple Calendar (File → New Calendar Subscription). It updates by itself.">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><code style={{ fontSize: 12, wordBreak: 'break-all', flex: 1 }}>{feed}</code><CopyButton text={feed} label="Copy link" /></div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Private to your agency: anyone with this link can see your calendar, so share it only with your team.</p>
      </Panel> : null}
    </AgencyShell>
  );
}
