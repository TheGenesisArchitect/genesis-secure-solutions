import { ActionForm } from '@/components/ActionForm';
import Link from 'next/link';
import { ConsoleShell, Flash } from '@/components/ConsoleShell';
import { Panel, Chip, Empty, dateTime, daysSince } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { decideApproval, bulkApprove } from '@/lib/actions';
import { checkCopy } from '@/lib/copy-checks';

export const metadata = { title: 'Approval queue' };

export default async function Approvals({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const supabase = await db();
  const [{ data }, { data: tenants }] = await Promise.all([
    supabase.from('approvals').select('*').eq('status', 'pending').order('requested_at'),
    supabase.from('tenants').select('id, slug, name'),
  ]);
  const t = new Map((tenants ?? []).map((x) => [x.id, x]));
  const team = (data ?? []).filter((a) => a.approver === 'team');
  // Items that passed every rule and sit in the queued lane can be cleared together (the spec staffing model).
  const clean = team.filter((a) => a.lane === 'queued' && (typeof a.body?.text !== 'string' || checkCopy(a.body.text as string, typeof a.body?.field === 'string' ? (a.body.field as string) : undefined).length === 0));
  const client = (data ?? []).filter((a) => a.approver === 'client');
  return (
    <ConsoleShell title="Approval queue" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Approval queue' }]}>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="soft">Nothing leaves the building without a person. Drafts arrive pre-checked; anything that fails a rule is flagged before you read it.</p>
      <Panel
        title="Waiting on the team"
        sub={`${team.length} item${team.length === 1 ? '' : 's'}, oldest first`}
        actions={clean.length > 1 ? (
          <ActionForm action={bulkApprove}>
            {clean.map((a) => <input key={a.id} type="hidden" name="id" value={a.id} />)}
            <button className="btn good small" type="submit">Approve all {clean.length} that passed every rule</button>
          </ActionForm>
        ) : null}
      >
        {team.length ? (
          <ul className="list">
            {team.map((a) => {
              const text = typeof a.body?.text === 'string' ? (a.body.text as string) : '';
              const flags = text ? checkCopy(text, typeof a.body?.field === 'string' ? (a.body.field as string) : undefined) : [];
              const tenant = t.get(a.tenant_id);
              return (
                <li key={a.id} style={{ gap: 8 }}>
                  <div className="spread">
                    <b>{a.title}</b>
                    <span className="row" style={{ gap: 6 }}>
                      {a.is_sample ? <Chip kind="sample">Sample</Chip> : null}
                      <Chip kind={a.lane}>{a.lane}</Chip>
                      <Chip>{a.subject_kind.replace('_', ' ')}</Chip>
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    <Link href={`/console/clients/${tenant?.slug}?tab=approvals`}>{tenant?.name}</Link> · waiting {daysSince(a.requested_at)}d · {dateTime(a.requested_at)}
                  </span>
                  {text ? <div className="notice" style={{ whiteSpace: 'pre-wrap' }}>{text}</div> : null}
                  {flags.length ? (
                    <div className="row" style={{ gap: 6 }}>{flags.map((f, i) => <Chip key={i} kind={f.hard ? 'bad' : 'pending'}>{f.label}</Chip>)}</div>
                  ) : text ? <Chip kind="done">Passed every rule</Chip> : null}
                  <ActionForm action={decideApproval} className="row">
                    <input type="hidden" name="id" value={a.id} />
                    <input type="hidden" name="back" value="/console/approvals" />
                    <input className="input" name="note" placeholder="Note (required to request changes)" style={{ flex: 1, minWidth: 200 }} />
                    <button className="btn good small" name="decision" value="approved" disabled={flags.some((f) => f.hard)}>Approve</button>
                    <button className="btn small" name="decision" value="changes_requested">Request changes</button>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty title="The team queue is clear" />
        )}
      </Panel>
      <Panel title="Waiting on clients" sub="Only the agency owner can decide these. Nudge if one sits more than two days.">
        {client.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Item</th><th>Client</th><th>Waiting</th><th>Lane</th></tr></thead>
              <tbody>
                {client.map((a) => (
                  <tr key={a.id}>
                    <td>{a.title} {a.is_sample ? <Chip kind="sample">Sample</Chip> : null}</td>
                    <td><Link href={`/console/clients/${t.get(a.tenant_id)?.slug}?tab=approvals`}>{t.get(a.tenant_id)?.name}</Link></td>
                    <td className="num" style={{ color: daysSince(a.requested_at) > 2 ? 'var(--warn)' : undefined }}>{daysSince(a.requested_at)}d</td>
                    <td><Chip kind={a.lane}>{a.lane}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nothing is waiting on clients" />
        )}
      </Panel>
    </ConsoleShell>
  );
}
