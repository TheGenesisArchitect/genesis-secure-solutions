import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Flash } from '@/components/ConsoleShell';
import { Panel, Chip, Status, Empty, dateTime } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { createCareRequest } from '@/lib/actions';

export const metadata = { title: 'Monthly care' };

const RESPONSE: Record<string, string> = { vip: '2 business days', launch: '2 business days', growth: '1 business day', premium: '4 business hours' };

export default async function AgencyCare({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await agencyContext(slug);
  const tid = ctx.tenant.tenantId;
  const supabase = await db();
  const [{ data: t }, { data: reqs }, { data: content }] = await Promise.all([
    supabase.from('tenants').select('plan, care_plan, stage').eq('id', tid).single(),
    supabase.from('care_requests').select('*').eq('tenant_id', tid).order('created_at', { ascending: false }),
    supabase.from('content_items').select('*').eq('tenant_id', tid).order('scheduled_for'),
  ]);
  const here = `/app/${slug}/care`;
  return (
    <AgencyShell ctx={ctx} title="Monthly care">
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid g2">
        <Panel title="Ask for a change" sub={`We reply within ${RESPONSE[t?.plan ?? 'launch']}. Site down or a lead form not delivering: within 2 business hours on every plan.`}>
          <form action={createCareRequest} className="form">
            <input type="hidden" name="tenant" value={tid} />
            <input type="hidden" name="back" value={here} />
            <label className="field"><span>What do you need?</span>
              <select className="select" name="kind" defaultValue="change">
                <option value="change">A change to my site or profiles</option>
                <option value="content">A post or promotion</option>
                <option value="report">A question about my results</option>
                <option value="support">Something else</option>
              </select>
            </label>
            <label className="field"><span>Short title</span><input className="input" name="title" required minLength={3} maxLength={140} placeholder="e.g. Update Saturday office hours" /></label>
            <label className="field"><span>Details (optional)</span><textarea className="textarea" name="detail" maxLength={4000} placeholder="Anything that helps us get it right the first time" /></label>
            <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Send request</button>
          </form>
        </Panel>
        <Panel title="Your requests">
          {reqs?.length ? (
            <ul className="list">
              {reqs.map((r) => (
                <li key={r.id}>
                  <div className="spread"><b>{r.title}</b><span className="row" style={{ gap: 6 }}>{r.is_sample ? <Chip kind="sample">Sample</Chip> : null}<Status value={r.status} /></span></div>
                  <span className="muted" style={{ fontSize: 13 }}>{r.kind} · {dateTime(r.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No requests yet" />}
        </Panel>
      </div>
      <Panel title="Content calendar" sub={t?.care_plan ? 'Posts we draft for you each month. You approve each one before it goes out.' : 'Your monthly posts start with your care plan at launch.'}>
        {content?.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>When</th><th>Channel</th><th>Post</th><th>Status</th></tr></thead>
              <tbody>
                {content.map((c) => (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateTime(c.scheduled_for)}</td>
                    <td>{c.channel}</td>
                    <td className="soft">{c.copy}</td>
                    <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>{c.is_sample ? <Chip kind="sample">Sample</Chip> : null}<Status value={c.status} /></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No posts scheduled yet" />}
      </Panel>
    </AgencyShell>
  );
}
