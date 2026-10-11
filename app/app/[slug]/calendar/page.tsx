// Calendar (Growth): the agency's week in one place: follow-ups, booked consults and scheduled posts, day by day,
// with a private link to subscribe from Google or Apple Calendar.
import Link from 'next/link';
import { headers } from 'next/headers';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { CopyButton } from '@/components/CopyButton';
import { Panel, Chip } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { businessToday } from '@/lib/billing';
import { accessFor } from '@/lib/access';
import { calendarItems, dayOf, feedEnabled, feedToken } from '@/lib/agency-calendar';

export const metadata = { title: 'Calendar' };
export const dynamic = 'force-dynamic';

const KIND: Record<string, [string, string]> = { 'follow-up': ['Follow-up', 'pending'], consult: ['Consult', 'done'], post: ['Post', 'info'], visit: ['Partner visit', 'done'] };
const add = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const mondayOf = (d: string) => { const x = new Date(`${d}T12:00:00Z`); return add(d, -((x.getUTCDay() + 6) % 7)); };
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export default async function Calendar({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ week?: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  if (!access.has('calendar')) return <AgencyShell ctx={ctx} title="Calendar"><ModuleGate ctx={ctx} moduleKey="calendar" /></AgencyShell>;
  const today = businessToday();
  const wk = (await searchParams).week;
  const start = mondayOf(wk && /^\d{4}-\d{2}-\d{2}$/.test(wk) ? wk : today);
  const days = Array.from({ length: 7 }, (_, i) => add(start, i));
  const items = await calendarItems(await db(), ctx.tenant.tenantId, start, days[6]);
  const h = await headers();
  const feed = `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('x-forwarded-host') ?? h.get('host')}/api/calendar/${slug}?k=${feedToken(ctx.tenant.tenantId)}`;
  const base = `/app/${slug}/calendar`;
  return (
    <AgencyShell ctx={ctx} title="Calendar" actions={<span className="row" style={{ gap: 6 }}><Link className="btn small ghost" href={`${base}?week=${add(start, -7)}`}>← Last week</Link><Link className="btn small ghost" href={base}>This week</Link><Link className="btn small ghost" href={`${base}?week=${add(start, 7)}`}>Next week →</Link></span>}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Week of {dayLabel(start)} · {items.filter((i) => i.kind === 'consult').length} consults, {items.filter((i) => i.kind === 'follow-up').length} follow-ups, {items.filter((i) => i.kind === 'post').length} posts</p>
      <div className="week">
        {days.map((d) => {
          const mine = items.filter((i) => dayOf(i.start) === d);
          return (
            <section key={d} className={'week-day' + (d === today ? ' today' : '')} aria-label={dayLabel(d)}>
              <header><b>{dayLabel(d)}</b>{d === today ? <Chip kind="info">Today</Chip> : null}</header>
              {mine.length ? mine.map((i) => (
                <div key={i.id} className={`cal-item ${i.kind}`}>
                  <span className="row" style={{ gap: 6 }}><Chip kind={KIND[i.kind][1]}>{KIND[i.kind][0]}</Chip><span className="muted" style={{ fontSize: 12 }}>{i.allDay ? 'Any time' : time(i.start)}</span></span>
                  <b style={{ fontSize: 14 }}>{i.title}</b>
                  {i.detail ? <span className="muted" style={{ fontSize: 12 }}>{i.detail}</span> : null}
                </div>
              )) : <span className="muted" style={{ fontSize: 12 }}>Open</span>}
            </section>
          );
        })}
      </div>
      {feedEnabled() ? <Panel title="See it on your phone’s calendar" sub="Subscribe once in Google Calendar (Other calendars → From URL) or Apple Calendar (File → New Calendar Subscription). It updates by itself.">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><code style={{ fontSize: 12, wordBreak: 'break-all', flex: 1 }}>{feed}</code><CopyButton text={feed} label="Copy link" /></div>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Private to your agency: anyone with this link can see your calendar, so share it only with your team.</p>
      </Panel> : null}
    </AgencyShell>
  );
}
