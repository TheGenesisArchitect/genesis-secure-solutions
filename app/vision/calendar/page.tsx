import { VisionShell, Src } from '@/components/vision/VisionShell';
import { Panel, Chip } from '@/components/ui';
import { CALENDAR } from '@/data/vision';

export const metadata = { title: 'Calendar · Growth Engine vision', robots: { index: false, follow: false } };

const KIND: Record<string, string> = { post: 'Post', short: 'Studio short', calls: 'Call block', consult: 'Consult', launch: 'Client launch', care: 'Care billing', carrier: 'Carrier event' };
const COLOR: Record<string, string> = { post: '#ff6a2b', short: '#a48bff', calls: '#6aa8ff', consult: '#3dd691', launch: '#ffb020', care: '#8b909a', carrier: '#ff5d5d' };

export default function CalendarPage() {
  // October 2026 starts on a Thursday; show Sunday–Saturday weeks.
  const first = new Date(Date.UTC(2026, 9, 1)).getUTCDay();
  const cells = Array.from({ length: 35 }, (_, i) => i - first + 1);
  const today = 8;
  return (
    <VisionShell
      slug="calendar"
      lede={<>One calendar runs the whole business: every post and short, every call block, every consult, launch and care cycle, tied to its market, its campaign and its approval. If it isn’t on the calendar, it isn’t happening.</>}
      spec={[
        { title: 'Model', items: [
          { k: 'Table', v: <><code>calendar_items</code> (kind, starts_at, ends_at, market_id, campaign_id, ref, lane, owner), generated from posts, missions, call blocks, invoices and launches.</> },
          { k: 'Booking', v: 'Native booking page for consults: slots from call-block availability; confirmation + reminder emails through the outbox.' },
        ] },
        { title: 'Sync', items: [
          { k: 'ICS feed', v: 'A private iCalendar feed per person so it shows in Google Calendar or Outlook (read-only).' },
          { k: 'Time zones', v: 'Calls scheduled in the office’s local time (already in the call list).' },
        ] },
        { title: 'Agent', items: [
          { k: 'Scheduler', v: 'Places call blocks and content into open slots; a person approves the week.' },
          { k: 'Reference', v: <>Patterns from GoHighLevel calendars and HubSpot meetings, built native. <Src href="https://ecosire.com/guides/platform/gohighlevel-complete-guide">GHL overview</Src></> },
        ] },
      ]}
    >
      <div className="spread"><b style={{ font: '800 20px var(--display)' }}>October 2026</b><div className="row" style={{ gap: 8 }}><Chip kind="info">Columbus</Chip><Chip kind="info">Atlanta</Chip><Chip kind="sample">Sample</Chip></div></div>
      <div className="cal" role="grid" aria-label="October 2026">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="dow">{d}</div>)}
        {cells.map((d, i) => {
          const inMonth = d >= 1 && d <= 31;
          const items = inMonth ? CALENDAR.filter((c) => c.day === d) : [];
          return (
            <div key={i} className={'day' + (inMonth ? '' : ' day-out') + (d === today ? ' today' : '')}>
              <span className="num">{inMonth ? d : d < 1 ? 30 + d : d - 31}</span>
              {items.map((it, k) => <span key={k} className={`ev ev-${it.kind}`} title={`${KIND[it.kind]}: ${it.label}`}>{it.label}</span>)}
            </div>
          );
        })}
      </div>
      <div className="cal-legend">{Object.entries(KIND).map(([k, l]) => <span key={k}><i style={{ background: COLOR[k] }} />{l}</span>)}</div>
      <div className="vgrid3">
        <Panel title="This week" sub="Thursday, October 8">
          <ul className="list">
            <li>10:00–12:00 · Call block · Columbus (2 callers)</li>
            <li>2:00 · Consult: Peachtree office (booked from yesterday’s call)</li>
            <li>6:00 PM · Post: “One local brand” on LinkedIn · <span className="vlane l3">LANE 3</span></li>
          </ul>
        </Panel>
        <Panel title="Booking page" sub="genovus.io/book">
          <div className="row" style={{ gap: 8 }}>{['Tue 10:00', 'Tue 10:30', 'Tue 2:00', 'Thu 11:00', 'Thu 3:30'].map((s) => <span key={s} className="chip done">{s}</span>)}</div>
          <span className="muted" style={{ fontSize: 13 }}>Open slots come from call-block availability; booked consults land here and on the team’s phone.</span>
        </Panel>
        <Panel title="Load" sub="What the month asks of the team">
          <dl className="kv lines"><dt>Posts</dt><dd>{CALENDAR.filter((c) => c.kind === 'post').length}</dd><dt>Studio shorts</dt><dd>{CALENDAR.filter((c) => c.kind === 'short').length}</dd><dt>Call blocks</dt><dd>{CALENDAR.filter((c) => c.kind === 'calls').length}</dd><dt>Consults</dt><dd>{CALENDAR.filter((c) => c.kind === 'consult').length}</dd></dl>
        </Panel>
      </div>
    </VisionShell>
  );
}
