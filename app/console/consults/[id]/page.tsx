// One consultation, for whoever runs the call: who they are and what they want from it, the consult guide (discovery,
// qualifying questions, objections; data/consult-guide.ts, Scale Up workbook pp. 57–63), then how it went: the
// one-tap outcome and what came up (the objection key feeds the Growth page's top objections).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { ConsultOutcome } from '@/components/ConsultOutcome';
import { Panel, Chip } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { saveConsultNotes } from '@/lib/actions';
import { DISCOVERY, PREQUAL, OBJECTIONS, OBJECTION_LABEL, OBJECTION_KEYS } from '@/data/consult-guide';

export const metadata = { title: 'Consultation' };
export const dynamic = 'force-dynamic';

type One<T> = T | T[] | null;
const one = <T,>(x: One<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x);
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const OUTCOME: Record<string, string> = { showed: 'Showed', no_show: 'No-show', rescheduled: 'Rescheduled' };
const DETAIL: Record<string, string> = { carrier: 'Carrier', states: 'States', presence: 'Online today', plan: 'Plan interest', goals: '#1 goal for the call', role: 'Role', agencies: 'Agencies', regions: 'Regions' };

export default async function Consult({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { data: c } = await (await db()).from('consult_invites')
    .select('id, label, emails, minutes, booked_at, outcome, objection, call_note, created_by, event:calendar_events!consult_invites_event_id_fkey(starts_at, ends_at, status, location), inquiry:inquiries(id, kind, org, name, phone, details, status), prospect:prospects(code, known_name, state, segment, carriers(name))')
    .eq('id', id).maybeSingle();
  if (!c) notFound();
  const ev = one(c.event as One<{ starts_at: string; ends_at: string; status: string; location: string | null }>);
  const inq = one(c.inquiry as One<{ id: string; kind: string; org: string; name: string; phone: string | null; details: Record<string, string> | null; status: string }>);
  const pr = one(c.prospect as One<{ code: string; known_name: string | null; state: string | null; segment: string; carriers: One<{ name: string }> }>);
  const past = ev ? Date.parse(ev.ends_at) < Date.now() : false;
  const first = c.label.split(/[ ,]/)[0];
  const details = Object.entries(inq?.details ?? {}).filter(([k, v]) => v && k !== 'goals');
  const goal = inq?.details?.goals;
  const title = `Consultation: ${c.label}`;
  return (
    <ConsoleShell title={title} crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/inquiries', label: 'Inquiries' }, { label: c.label }]}>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="The call" sub={ev ? `${when(ev.starts_at)} ET · ${c.minutes} minutes` : 'Not booked yet: they haven’t picked a time'} helixItem="The call"
            actions={ev?.status === 'cancelled' ? <Chip kind="pending">Cancelled</Chip> : c.outcome ? <Chip kind={c.outcome === 'showed' ? 'done' : 'pending'}>{OUTCOME[c.outcome]}</Chip> : ev ? <Chip kind="info">{past ? 'Needs an outcome' : 'Booked'}</Chip> : null}>
            <dl className="kv">
              <dt>Who</dt><dd>{c.label}</dd>
              <dt>Invited</dt><dd style={{ overflowWrap: 'anywhere' }}>{(c.emails as string[]).join(', ')}</dd>
              {inq?.phone ? <><dt>Phone</dt><dd><a href={`tel:${inq.phone}`}>{inq.phone}</a></dd></> : null}
              {ev?.location ? <><dt>Where</dt><dd style={{ overflowWrap: 'anywhere' }}>{/^https?:\/\//.test(ev.location) ? <a href={ev.location} target="_blank" rel="noreferrer">{ev.location}</a> : ev.location}</dd></> : null}
              <dt>Came from</dt><dd>{inq ? `The website (${inq.kind} inquiry)` : pr ? 'A prospect the team called' : 'A link the team sent'}</dd>
              {pr ? <><dt>Office</dt><dd>{pr.known_name ?? `Office ${pr.code}`} · {one(pr.carriers)?.name ?? 'Independent'} · {pr.state ?? 'state unknown'}</dd></> : null}
              {details.flatMap(([k, v]) => [<dt key={k}>{DETAIL[k] ?? k}</dt>, <dd key={`${k}v`}>{String(v)}</dd>])}
            </dl>
            {goal ? <div className="notice"><b>What {first} wants from this call:</b> {goal}</div> : inq ? <p className="muted" style={{ margin: 0 }}>They didn’t say what they want from the call. Ask early (step 4 below).</p> : null}
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {pr ? <Link className="btn small" href={`/console/prospects/${pr.code}`}>Open the prospect</Link> : null}
              {inq ? <Link className="btn small" href="/console/inquiries">Open Inquiries</Link> : null}
            </div>
          </Panel>
          {ev && ev.status !== 'cancelled' ? (
            <Panel title="How did it go?" sub={past ? 'One tap keeps show rate and close rate honest (Growth page)' : 'Mark it after the call'} helixItem="How did it go">
              <ConsultOutcome invite={c.id} current={c.outcome} />
              <ActionForm action={saveConsultNotes} helix="consult notes" helixTitle="What came up on the call" className="form">
                <input type="hidden" name="invite" value={c.id} />
                <label className="field"><span>Main objection (the top ones become content and ads)</span>
                  <select className="select" name="objection" defaultValue={c.objection ?? ''}>
                    <option value="">Not recorded yet</option>
                    {OBJECTION_KEYS.map((k) => <option key={k} value={k}>{OBJECTION_LABEL[k]}</option>)}
                  </select>
                </label>
                <label className="field"><span>Call note (their answers to the qualifying questions, next step)</span><textarea className="textarea" name="note" maxLength={2000} defaultValue={c.call_note ?? ''} /></label>
                <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Save</button>
              </ActionForm>
            </Panel>
          ) : null}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Consult guide" sub="Discovery, in order. Talk less than a fifth of the time." helixItem="Consult guide">
            <ol className="guide-steps">
              {DISCOVERY.map((d) => <li key={d.step}><b>{d.step}</b><span className="soft">{d.how}</span></li>)}
            </ol>
          </Panel>
          <Panel title="Qualifying questions" sub="Ask in your own words; put the answers in the call note" helixItem="Qualifying questions">
            <ul className="list">
              {PREQUAL.map((q) => <li key={q.ask} style={{ gap: 2 }}><b style={{ fontSize: 14 }}>{q.ask}</b><span className="muted" style={{ fontSize: 13 }}>{q.why}</span></li>)}
            </ul>
          </Panel>
          <Panel title="If they say…" sub="Find the real reason, then answer that one" helixItem="Objections">
            <div className="guide-objections">
              {OBJECTIONS.map((o) => (
                <details key={o.key}>
                  <summary>{o.say}</summary>
                  <p><b>Ask:</b> {o.ask}</p>
                  <p className="muted">{o.listen}</p>
                </details>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </ConsoleShell>
  );
}
