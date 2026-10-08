import { ActionForm } from '@/components/ActionForm';
import Link from 'next/link';
import { ConsoleShell, Flash } from '@/components/ConsoleShell';
import { Panel, Chip, Status, Empty, Tile, dateTime, daysSince } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { setCareStatus } from '@/lib/actions';

export const metadata = { title: 'Care desk' };

// First human response targets by plan (spec: Support response times), in business hours.
const TARGET_HOURS: Record<string, number> = { vip: 16, launch: 16, growth: 8, premium: 4 };

/** Adds business hours (Mon to Fri, 9 to 5 Eastern, approximated in UTC) to a start time. */
function dueBy(startIso: string, hours: number): Date {
  const d = new Date(startIso);
  let left = hours * 60;
  while (left > 0) {
    d.setUTCMinutes(d.getUTCMinutes() + 30);
    const day = d.getUTCDay(), h = d.getUTCHours();
    if (day !== 0 && day !== 6 && h >= 13 && h < 21) left -= 30;
  }
  return d;
}

/** First business day of next month: when monthly reports go out. */
function nextReportDay(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

export default async function Care({ searchParams }: { searchParams: Promise<{ samples?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const samples = sp.samples === '1';
  const supabase = await db();
  let rq = supabase.from('care_requests').select('*').neq('status', 'done').order('created_at');
  let cq = supabase.from('content_items').select('id, tenant_id, channel, copy, status, scheduled_for, is_sample').in('status', ['draft', 'in_review', 'approved', 'scheduled']).order('scheduled_for');
  if (!samples) { rq = rq.eq('is_sample', false); cq = cq.eq('is_sample', false); }
  const [{ data: reqs }, { data: content }, { data: tenants }] = await Promise.all([rq, cq, supabase.from('tenants').select('id, slug, name, stage, plan, care_plan, is_sample')]);
  const t = new Map((tenants ?? []).map((x) => [x.id, x]));
  const inCare = (tenants ?? []).filter((x) => x.stage === 'care' && (samples || !x.is_sample));
  const report = nextReportDay();
  return (
    <ConsoleShell
      title="Care desk"
      crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Care desk' }]}
      actions={<Link className="btn small" href={samples ? '/console/care' : '/console/care?samples=1'}>{samples ? 'Hide samples' : 'Include samples'}</Link>}
    >
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid g4">
        <Tile label="Clients in care" value={<span className="num">{inCare.length}</span>} sample={samples && inCare.some((x) => x.is_sample)} />
        <Tile label="Open requests" value={<span className="num">{reqs?.length ?? 0}</span>} />
        <Tile label="Content in flight" value={<span className="num">{content?.length ?? 0}</span>} hint="Draft, in review, approved or scheduled" />
        <Tile label="Next monthly reports" value={report.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} hint="First business day; an operator reviews each before it sends" />
      </div>
      <Panel title="Requests" sub="From agency dashboards, oldest first">
        {reqs?.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Request</th><th>Client</th><th>Kind</th><th>Reply due</th><th>Status</th></tr></thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.id}>
                    <td><b>{r.title}</b>{r.detail ? <div className="soft" style={{ fontSize: 13 }}>{r.detail}</div> : null}</td>
                    <td><Link href={`/console/clients/${t.get(r.tenant_id)?.slug}?tab=care`}>{t.get(r.tenant_id)?.name}</Link> {r.is_sample ? <Chip kind="sample">Sample</Chip> : null}</td>
                    <td>{r.kind}</td>
                    <td className="num">{(() => { const due = dueBy(r.created_at, TARGET_HOURS[t.get(r.tenant_id)?.plan ?? 'launch'] ?? 16); const late = r.status === 'new' && due.getTime() < Date.now(); return <span style={{ color: late ? 'var(--bad)' : undefined }}>{late ? 'Overdue · ' : ''}{dateTime(due.toISOString())}</span>; })()}</td>
                    <td>
                      <ActionForm action={setCareStatus} className="row" style={{ flexWrap: 'nowrap' }}>
                        <input type="hidden" name="id" value={r.id} />
                        <input type="hidden" name="back" value={'/console/care' + (samples ? '?samples=1' : '')} />
                        <select className="select" name="status" defaultValue={r.status} style={{ width: 'auto' }} aria-label="Status">
                          {['new', 'in_progress', 'waiting_client', 'done'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                        <button className="btn small" type="submit">Save</button>
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No open requests">Requests clients send from their dashboards land here.</Empty>}
      </Panel>
      <Panel title="Content calendar" sub="Every client’s posts in flight. Posting stays manual until Meta App Review clears.">
        {content?.length ? (
          <ul className="list">
            {content.map((c) => (
              <li key={c.id}>
                <div className="spread">
                  <span><b>{t.get(c.tenant_id)?.name}</b> <span className="muted">· {c.channel} · {dateTime(c.scheduled_for)}</span></span>
                  <span className="row" style={{ gap: 6 }}>{c.is_sample ? <Chip kind="sample">Sample</Chip> : null}<Status value={c.status} /></span>
                </div>
                <span className="soft" style={{ fontSize: 14 }}>{c.copy}</span>
              </li>
            ))}
          </ul>
        ) : <Empty title="No content in flight" />}
      </Panel>
    </ConsoleShell>
  );
}
