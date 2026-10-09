// Follow-ups: the office's own reminders, lined up by day. Add one in seconds after a call or a visit; tomorrow's
// list is ready the night before. Reminders only: nothing is sent to the customer from here.
import { ActionForm } from '@/components/ActionForm';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Chip, Empty, Tile } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { businessToday } from '@/lib/billing';
import { addFollowUp, updateFollowUp } from '@/lib/actions';

export const metadata = { title: 'Follow-ups' };
export const dynamic = 'force-dynamic';

type F = { id: string; who: string; reason: string | null; due_on: string; due_at: string | null; status: string; done_at: string | null };

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const timeLabel = (t: string | null) => {
  if (!t) return 'Any time';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

function Row({ f, today, tomorrow }: { f: F; today: string; tomorrow: string }) {
  const done = f.status === 'done';
  return (
    <li className="fu-row" data-done={done || undefined}>
      <span className="fu-time">{f.due_on === today || f.due_on === tomorrow ? timeLabel(f.due_at) : dayLabel(f.due_on)}</span>
      <span className="fu-main"><b>{f.who}</b>{f.reason ? <span className="muted">{f.reason}</span> : null}</span>
      <span className="fu-actions">
        {done ? (
          <ActionForm action={updateFollowUp}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="open" /><button className="btn small ghost" type="submit">Undo</button></ActionForm>
        ) : (
          <>
            {f.due_on <= today ? <ActionForm action={updateFollowUp}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="open" /><input type="hidden" name="due" value={tomorrow} /><button className="btn small ghost" type="submit" title="Move to tomorrow">Tomorrow →</button></ActionForm> : null}
            <ActionForm action={updateFollowUp}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="done" /><button className="btn small primary" type="submit" aria-label={`Done: ${f.who}`}>✓ Done</button></ActionForm>
          </>
        )}
      </span>
    </li>
  );
}

export default async function FollowUps({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const tid = ctx.tenant.tenantId;
  const today = businessToday();
  const tomorrow = addDays(today, 1);
  const supabase = await db();
  const [{ data: open }, { data: recent }] = await Promise.all([
    supabase.from('follow_ups').select('id, who, reason, due_on, due_at, status, done_at').eq('tenant_id', tid).eq('status', 'open').order('due_on').order('due_at', { nullsFirst: false }).limit(300),
    supabase.from('follow_ups').select('id, who, reason, due_on, due_at, status, done_at').eq('tenant_id', tid).eq('status', 'done').order('done_at', { ascending: false }).limit(10),
  ]);
  const all = (open ?? []) as F[];
  const overdue = all.filter((f) => f.due_on < today);
  const todays = all.filter((f) => f.due_on === today);
  const tomorrows = all.filter((f) => f.due_on === tomorrow);
  const later = all.filter((f) => f.due_on > tomorrow);
  const section = (title: string, sub: string, list: F[], empty: string) => (
    <Panel title={`${title} · ${list.length}`} sub={sub}>
      {list.length ? <ul className="fu-list">{list.map((f) => <Row key={f.id} f={f} today={today} tomorrow={tomorrow} />)}</ul> : <p className="muted" style={{ margin: 0, fontSize: 14 }}>{empty}</p>}
    </Panel>
  );
  return (
    <AgencyShell ctx={ctx} title="Follow-ups">
      <div className="grid g3">
        <Tile label="Today" value={<span className="num">{todays.length + overdue.length}</span>} hint={overdue.length ? `${overdue.length} carried over` : 'All on track'} />
        <Tile label="Tomorrow" value={<span className="num">{tomorrows.length}</span>} hint="Ready the night before" />
        <Tile label="Done this week" value={<span className="num">{(recent ?? []).filter((r) => r.done_at && r.done_at.slice(0, 10) >= addDays(today, -6)).length}</span>} hint="Recent wins" />
      </div>
      <div className="fu-grid">
        <div className="grid" style={{ alignContent: 'start' }}>
          {overdue.length ? section('Carried over', 'From earlier days: still worth the call', overdue, '') : null}
          {section('Today', dayLabel(today), todays, 'Nothing due today.')}
          {section('Tomorrow', `${dayLabel(tomorrow)} · your list is ready`, tomorrows, 'Nothing yet for tomorrow.')}
          {later.length ? section('Coming up', 'Later this week and beyond', later, '') : null}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Add a follow-up" sub="After a call, a visit or a text: who, why, and when">
            <ActionForm action={addFollowUp} className="form" resetOnOk>
              <input type="hidden" name="tenant" value={tid} />
              <label className="field"><span>Who</span><input className="input" name="who" required maxLength={120} placeholder="e.g. The Hendersons" autoComplete="off" /></label>
              <label className="field"><span>Why</span><input className="input" name="reason" maxLength={300} placeholder="e.g. Moving next month: review their coverage" autoComplete="off" /></label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <label className="field" style={{ flex: 2 }}><span>Day</span><input className="input" type="date" name="due" required defaultValue={tomorrow} /></label>
                <label className="field" style={{ flex: 1 }}><span>Time</span><input className="input" type="time" name="at" defaultValue="09:30" /></label>
              </div>
              <button className="btn primary" type="submit">Save follow-up</button>
            </ActionForm>
          </Panel>
          {(recent ?? []).length ? (
            <Panel title="Recently done">
              <ul className="fu-list">{(recent as F[]).map((f) => <Row key={f.id} f={f} today={today} tomorrow={tomorrow} />)}</ul>
            </Panel>
          ) : null}
          {!all.length && !(recent ?? []).length ? <Empty title="No follow-ups yet">Add the first one after your next call. Tomorrow’s list builds itself from here.</Empty> : null}
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>Private to {ctx.tenant.name}. Reminders only: nothing is sent to your customers from here.</p>
        </div>
      </div>
      {ctx.asStaff ? <Chip kind="info">Viewing as the Genovus team</Chip> : null}
    </AgencyShell>
  );
}
