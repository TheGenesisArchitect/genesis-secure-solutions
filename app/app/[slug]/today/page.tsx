// Genovus Mobile "Today": the agency's phone home. New leads to call now (website callbacks, calls and referrals
// not yet contacted, newest first, one tap to call), tomorrow's call list (follow-ups due tomorrow), the client notes
// behind them, and priority follow-ups (overdue or starred), all from the office's own Leads and Follow-ups. Prepared, not
// completed: a list being ready never means the calls happened. Reminders only; nothing is sent to customers.
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { db } from '@/lib/supabase/server';
import { businessToday } from '@/lib/billing';
import { starFollowUp, updateFollowUp, updateLead } from '@/lib/actions';
import { prettyPhone } from '@/lib/twilio';

export const metadata = { title: 'Today' };
export const dynamic = 'force-dynamic';

type F = { id: string; who: string; reason: string | null; due_on: string; due_at: string | null; priority: boolean };
type L = { id: string; name: string; phone: string | null; topic: string | null; source: string; channel: string; created_at: string };
const ago = (t: string) => { const m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000)); return m < 60 ? `${m || 1} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const telOf = (p: string) => p.replace(/[^\d+]/g, '');
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
const time = (t: string | null) => { if (!t) return 'Any time'; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

function Star({ f }: { f: F }) {
  return (
    <ActionForm action={starFollowUp}>
      <input type="hidden" name="id" value={f.id} /><input type="hidden" name="on" value={f.priority ? '0' : '1'} />
      <button className={'today-star' + (f.priority ? ' on' : '')} type="submit" aria-label={f.priority ? `Unstar ${f.who}` : `Star ${f.who} as a priority`} aria-pressed={f.priority}>★</button>
    </ActionForm>
  );
}

export default async function Today({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ film?: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const film = (await searchParams).film === '1' && ctx.tenant.isSample;
  const tid = ctx.tenant.tenantId;
  const today = businessToday();
  const tomorrow = addDays(today, 1);
  const supabase = await db();
  const [{ data }, { data: leadRows }] = await Promise.all([
    supabase.from('follow_ups').select('id, who, reason, due_on, due_at, priority').eq('tenant_id', tid).eq('status', 'open').lte('due_on', addDays(today, 14)).order('due_on').order('due_at', { nullsFirst: false }).limit(200),
    // Every lead nobody has contacted yet: the calls to make first.
    supabase.from('leads').select('id, name, phone, topic, source, channel, created_at').eq('tenant_id', tid).eq('status', 'new').order('created_at', { ascending: false }).limit(25),
  ]);
  const open = (data ?? []) as F[];
  const fresh = (leadRows ?? []) as L[];
  const calls = open.filter((f) => f.due_on === tomorrow);
  const notes = calls.filter((f) => f.reason);
  // A missed call's call-back is due the same day, so it joins the priorities right away.
  const callback = (f: F) => f.due_on <= today && /^Missed call/.test(f.reason ?? '');
  const priority = open.filter((f) => f.due_on < today || f.priority || callback(f));
  const base = `/app/${slug}`;
  return (
    <AgencyShell ctx={ctx} title="Today" film={film}>
      <div className="today">
        <div className="today-head">
          <span className="v-eyebrow">{dayLabel(today)}</span>
          <h2>{fresh.length ? `${fresh.length} new lead${fresh.length === 1 ? '' : 's'} to call.` : calls.length ? 'Tomorrow is ready.' : 'Nothing booked for tomorrow yet.'}</h2>
          <p className="muted">{fresh.length} to call now · {calls.length} on tomorrow’s call list · {priority.length} {priority.length === 1 ? 'priority' : 'priorities'}</p>
        </div>

        <section className="today-card today-now" aria-labelledby="t-now">
          <div className="today-card-head"><span className="today-ic pri" aria-hidden="true">☎</span><h3 id="t-now">Call now</h3><span className="today-count">{fresh.length}</span></div>
          {fresh.length ? (
            <ul className="today-list leads">
              {fresh.map((l) => (
                <li key={l.id}>
                  <span className="today-time">{ago(l.created_at)}</span>
                  <span className="today-lead"><b>{l.name}</b><small>{[l.topic, l.channel === 'call' ? 'called the office' : l.channel === 'partner' ? 'referral partner' : `via ${l.source}`].filter(Boolean).join(' · ')}</small></span>
                  <span className="row" style={{ gap: 6 }}>
                    {l.phone ? <a className="btn small primary" href={`tel:${telOf(l.phone)}`}>Call {l.phone.startsWith('+') ? prettyPhone(l.phone) : l.phone}</a> : <Link className="btn small" href={`${base}/leads`}>Email</Link>}
                    <ActionForm action={updateLead}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value="contacted" /><button className="btn small ghost" type="submit" aria-label={`Called ${l.name}`}>Called</button></ActionForm>
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="muted">New website callbacks, calls and referrals land here the moment they arrive.</p>}
          <span className="today-foot">The sooner you call, the likelier they book. Tap Called once you’ve reached them.</span>
        </section>

        <section className="today-card" aria-labelledby="t-calls">
          <div className="today-card-head"><span className="today-ic ok" aria-hidden="true">✓</span><h3 id="t-calls">Tomorrow’s call list</h3><span className="today-count">{calls.length}</span></div>
          {calls.length ? (
            <ul className="today-list">
              {calls.map((f) => (
                <li key={f.id}><span className="today-time">{time(f.due_at)}</span><b>{f.who}</b><Star f={f} /></li>
              ))}
            </ul>
          ) : <p className="muted">Add a follow-up for tomorrow and it lands here.</p>}
          <span className="today-foot">Ready the night before. You still make the calls.</span>
        </section>

        <section className="today-card" aria-labelledby="t-notes">
          <div className="today-card-head"><span className="today-ic note" aria-hidden="true">✎</span><h3 id="t-notes">Client notes</h3><span className="today-count">{notes.length}</span></div>
          {notes.length ? (
            <ul className="today-list notes">
              {notes.map((f) => <li key={f.id}><b>{f.who}</b><span>{f.reason}</span></li>)}
            </ul>
          ) : <p className="muted">The “why” you save with each follow-up shows up here.</p>}
        </section>

        <section className="today-card" aria-labelledby="t-pri">
          <div className="today-card-head"><span className="today-ic pri" aria-hidden="true">★</span><h3 id="t-pri">Priority follow-ups</h3><span className="today-count">{priority.length}</span></div>
          {priority.length ? (
            <ul className="today-list">
              {priority.map((f) => (
                <li key={f.id}>
                  <span className="today-time">{callback(f) ? 'Call back' : f.due_on < today ? 'Overdue' : time(f.due_at)}</span>
                  <b>{f.who}</b>
                  <ActionForm action={updateFollowUp}><input type="hidden" name="id" value={f.id} /><input type="hidden" name="status" value="done" /><button className="btn small ghost" type="submit" aria-label={`Done: ${f.who}`}>Done</button></ActionForm>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Nothing overdue. Star a follow-up to keep it here.</p>}
        </section>

        <Link className="btn primary today-add" href={`${base}/follow-ups`}>Add or manage follow-ups</Link>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Private to {ctx.tenant.name}. Reminders only: nothing is sent to your customers from here.</p>
      </div>
    </AgencyShell>
  );
}
