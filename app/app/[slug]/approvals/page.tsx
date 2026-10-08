import { ActionForm } from '@/components/ActionForm';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Flash } from '@/components/ConsoleShell';
import { Panel, Chip, Status, Empty, dateTime } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { decideApproval } from '@/lib/actions';

export const metadata = { title: 'Approvals' };

export default async function AgencyApprovals({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await agencyContext(slug);
  const supabase = await db();
  const { data } = await supabase.from('approvals').select('*').eq('tenant_id', ctx.tenant.tenantId).eq('approver', 'client').order('requested_at', { ascending: false });
  const pending = (data ?? []).filter((a) => a.status === 'pending');
  const done = (data ?? []).filter((a) => a.status !== 'pending');
  const canDecide = !ctx.asStaff && ctx.tenant.role === 'owner';
  const here = `/app/${slug}/approvals`;
  return (
    <AgencyShell ctx={ctx} title="Approvals">
      <Flash ok={sp.ok} err={sp.err} />
      <p className="soft">Nothing is posted, published or charged in your name until you approve it here. Ask for changes and tell us what to fix; any edit comes back to you.</p>
      <Panel title="Waiting on you" sub={`${pending.length} item${pending.length === 1 ? '' : 's'}`}>
        {pending.length ? (
          <ul className="list">
            {pending.map((a) => (
              <li key={a.id} style={{ gap: 10 }}>
                <div className="spread"><b>{a.title}</b><span className="row" style={{ gap: 6 }}>{a.is_sample ? <Chip kind="sample">Sample</Chip> : null}<Chip>{a.subject_kind.replace('_', ' ')}</Chip></span></div>
                {typeof a.body?.text === 'string' ? <div className="notice" style={{ whiteSpace: 'pre-wrap' }}>{a.body.text}</div> : null}
                {typeof a.body?.channel === 'string' ? <span className="muted" style={{ fontSize: 13 }}>For {a.body.channel}{typeof a.body?.when === 'string' ? ` · planned ${a.body.when}` : ''}</span> : null}
                {canDecide ? (
                  <ActionForm action={decideApproval} className="form">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="back" value={here} />
                    <input className="input" name="note" placeholder="What should change? (needed only to request changes)" />
                    <div className="row">
                      <button className="btn good" name="decision" value="approved">Approve</button>
                      <button className="btn" name="decision" value="changes_requested">Request changes</button>
                    </div>
                  </ActionForm>
                ) : <span className="muted" style={{ fontSize: 13 }}>{ctx.asStaff ? 'Only the agency owner can decide this.' : 'Your agency owner approves this.'}</span>}
              </li>
            ))}
          </ul>
        ) : <Empty title="Nothing needs your approval">We will email you when something does.</Empty>}
      </Panel>
      <Panel title="Your approval record" sub="Kept with your documents">
        {done.length ? (
          <ul className="list">
            {done.map((a) => (
              <li key={a.id}>
                <div className="spread"><span>{a.title}</span><Status value={a.status} /></div>
                <span className="muted" style={{ fontSize: 13 }}>{dateTime(a.decided_at)}{a.decision_note ? ` · “${a.decision_note}”` : ''}</span>
              </li>
            ))}
          </ul>
        ) : <p className="soft">No decisions yet.</p>}
      </Panel>
    </AgencyShell>
  );
}
