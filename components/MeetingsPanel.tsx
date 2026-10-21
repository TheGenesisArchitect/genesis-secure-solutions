// Meetings with a client (Enterprise): schedule one on the agency's calendar, then send the invite. Scheduling is
// internal (Helix may save it after a yes); sending is outward, so Helix only fills it and a person taps Send.
import { ActionForm } from '@/components/ActionForm';
import { Chip, Empty } from '@/components/ui';
import { addEvent, cancelEvent, sendEventInvite } from '@/lib/actions';

export type MeetingRow = { id: string; title: string; starts_at: string; ends_at: string; location: string | null; attendees: string[]; status: string; sequence: number; invited_at: string | null; invited_sequence: number | null };

const tz = { timeZone: 'America/New_York' } as const;
const when = (s: string, e: string) => `${new Date(s).toLocaleDateString('en-US', { ...tz, weekday: 'short', month: 'short', day: 'numeric' })} · ${new Date(s).toLocaleTimeString('en-US', { ...tz, hour: 'numeric', minute: '2-digit' })} – ${new Date(e).toLocaleTimeString('en-US', { ...tz, hour: 'numeric', minute: '2-digit' })} ET`;

export function MeetingsPanel({ tenantId, agency, today, attendees, rows }: { tenantId: string; agency: string; today: string; attendees: string; rows: MeetingRow[] }) {
  return (
    <div className="grid" style={{ gap: 14 }}>
      {rows.length ? (
        <ul className="list">
          {rows.map((m) => {
            const cancelled = m.status === 'cancelled';
            const current = m.invited_at !== null && m.invited_sequence === m.sequence;
            const label = cancelled ? 'Send cancellation' : m.invited_at ? 'Send update' : 'Send invite';
            return (
              <li key={m.id} data-helix-item={m.title} style={{ alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ display: 'grid', gap: 2, minWidth: 0, flex: 1 }}>
                  <b>{m.title}</b>
                  <span className="muted" style={{ fontSize: 13 }}>{when(m.starts_at, m.ends_at)}{m.location ? ` · ${m.location}` : ''}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{m.attendees.length ? m.attendees.join(', ') : 'Nobody to invite yet'}</span>
                </span>
                <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {cancelled ? <Chip kind="blocked">Cancelled</Chip> : null}
                  {current ? <Chip kind="done">{cancelled ? 'Cancellation sent' : 'Invite sent'}</Chip> : m.invited_at ? <Chip kind="pending">Changed since the invite</Chip> : null}
                  {!current && m.attendees.length && !(cancelled && !m.invited_at) ? (
                    <ActionForm action={sendEventInvite} helix="send invite" helixTitle={`${label}: ${m.title}`} lane="outward">
                      <input type="hidden" name="id" value={m.id} />
                      <button className="btn small primary" type="submit">{label}</button>
                    </ActionForm>
                  ) : null}
                  {!cancelled ? (
                    <ActionForm action={cancelEvent} helix="cancel meeting" helixTitle={`Cancel ${m.title}`}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="btn small ghost" type="submit">Cancel</button>
                    </ActionForm>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : <Empty title="No meetings scheduled">Schedule one below. It lands on {agency}’s calendar right away; the invite goes out when you send it.</Empty>}
      <ActionForm action={addEvent} className="form" resetOnOk helix="meeting" helixTitle="Schedule a meeting">
        <input type="hidden" name="tenant" value={tenantId} />
        <label className="field"><span>Meeting</span><input className="input" name="title" required maxLength={160} placeholder="e.g. Carrier setup and back-office training" autoComplete="off" /></label>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="field" style={{ flex: 2, minWidth: 150 }}><span>Day</span><input className="input" type="date" name="day" required defaultValue={today} /></label>
          <label className="field" style={{ flex: 1, minWidth: 110 }}><span>Starts</span><input className="input" type="time" name="start" required defaultValue="10:00" /></label>
          <label className="field" style={{ flex: 1, minWidth: 110 }}><span>Ends</span><input className="input" type="time" name="end" defaultValue="11:00" /></label>
        </div>
        <label className="field"><span>Where</span><input className="input" name="location" maxLength={200} placeholder="The agency’s office, a video link" autoComplete="off" /></label>
        <label className="field"><span>Invite</span><input className="input" name="attendees" maxLength={2200} defaultValue={attendees} placeholder="name@agency.com, you@genovus.io" autoComplete="off" /></label>
        <label className="field"><span>Agenda <span className="muted">(optional)</span></span><input className="input" name="notes" maxLength={1000} placeholder="What you’ll cover, what to have ready" autoComplete="off" /></label>
        <button className="btn primary" type="submit">Schedule</button>
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>Scheduling puts it on the agency’s calendar. Nobody is emailed until you tap Send invite.</p>
      </ActionForm>
    </div>
  );
}
