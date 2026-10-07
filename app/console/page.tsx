import Link from 'next/link';
import { ConsoleShell, Flash } from '@/components/ConsoleShell';
import { Panel, Tile, Chip, Status, Empty, Bar, STAGES, STAGE_LABEL, money, dateTime, daysSince, type Stage } from '@/components/ui';
import { db } from '@/lib/supabase/server';

export const metadata = { title: 'Enterprise' };
const CARE_RATE: Record<string, number> = { vip: 249, launch: 249, growth: 399, premium: 799 };

export default async function ConsoleHome({ searchParams }: { searchParams: Promise<{ samples?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const samples = sp.samples === '1';
  const supabase = await db();
  let tq = supabase.from('tenants').select('id, slug, name, stage, stage_since, plan, care_plan, is_sample').eq('kind', 'agency');
  if (!samples) tq = tq.eq('is_sample', false);
  const [tenants, inquiries, approvals, care, invoices, gates, audit] = await Promise.all([
    tq,
    supabase.from('inquiries').select('id, kind, org, name, created_at').eq('status', 'new').order('created_at', { ascending: false }).limit(5),
    supabase.from('approvals').select('id, title, lane, approver, requested_at, tenant_id, is_sample').eq('status', 'pending').order('requested_at').limit(50),
    supabase.from('care_requests').select('id, title, status, kind, created_at, tenant_id, is_sample').in('status', ['new', 'in_progress', 'waiting_client']).order('created_at').limit(50),
    supabase.from('invoices').select('amount_cents, status, tenant_id'),
    supabase.from('gates').select('tenant_id, status'),
    supabase.from('audit_events').select('id, action, subject, actor_label, at, tenant_id').order('id', { ascending: false }).limit(8),
  ]);
  const ts = tenants.data ?? [];
  const ids = new Set(ts.map((t) => t.id));
  const byId = new Map(ts.map((t) => [t.id, t]));
  const scoped = <T extends { tenant_id: string | null }>(rows: T[] | null) => (rows ?? []).filter((r) => r.tenant_id && ids.has(r.tenant_id));
  const appr = scoped(approvals.data);
  const careRows = scoped(care.data);
  const paid = scoped(invoices.data).filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount_cents, 0);
  const due = scoped(invoices.data).filter((i) => i.status === 'open').reduce((s, i) => s + i.amount_cents, 0);
  const mrr = ts.filter((t) => t.stage === 'care' && t.care_plan).reduce((s, t) => s + (CARE_RATE[t.plan ?? 'launch'] ?? 0), 0);
  const g = scoped(gates.data);
  const gatesOpen = g.filter((x) => x.status === 'open' || x.status === 'blocked').length;
  const counts = Object.fromEntries(STAGES.map((s) => [s, ts.filter((t) => t.stage === s).length])) as Record<Stage, number>;

  return (
    <ConsoleShell
      title="Overview"
      actions={
        <Link className="btn small" href={samples ? '/console' : '/console?samples=1'}>
          {samples ? 'Hide sample clients' : 'Include sample clients'}
        </Link>
      }
    >
      <Flash ok={sp.ok} err={sp.err} />
      {samples ? <div className="notice sample">Sample clients are included. Their numbers are illustrative and marked Sample.</div> : null}
      <div className="grid g4">
        <Tile label="Clients" value={<span className="num">{ts.length}</span>} hint={`${counts.care} in care · ${ts.length - counts.care} in setup`} />
        <Tile label="New inquiries" value={<span className="num">{inquiries.data?.length ?? 0}</span>} hint="From the website" />
        <Tile label="Waiting on a person" value={<span className="num">{appr.length}</span>} hint={`${appr.filter((a) => a.approver === 'team').length} on the team · ${appr.filter((a) => a.approver === 'client').length} on clients`} />
        <Tile label="Care MRR" value={<span className="num">{money(mrr * 100)}</span>} hint="Clients live on a care plan" sample={samples && mrr > 0} />
        <Tile label="Setup collected" value={<span className="num">{money(paid)}</span>} hint={`${money(due)} open`} sample={samples} />
        <Tile label="Open gates" value={<span className="num">{gatesOpen}</span>} hint="Photo rights, carrier approval, access…" />
      </div>

      <Panel title="Pipeline" sub="Every client by lifecycle stage" actions={<Link className="btn small" href={'/console/pipeline' + (samples ? '?samples=1' : '')}>Open pipeline</Link>}>
        <div className="chain">
          {STAGES.map((s) => (
            <div key={s} className={counts[s] ? '' : 'muted'}>
              <span className="k">{STAGE_LABEL[s]}</span>
              <span className="v num">{counts[s]}</span>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid g2">
        <Panel title="Waiting on a person" sub="Oldest first" actions={<Link className="btn small" href="/console/approvals">Approval queue</Link>}>
          {appr.length ? (
            <ul className="list">
              {appr.slice(0, 6).map((a) => (
                <li key={a.id}>
                  <div className="spread">
                    <b>{a.title}</b>
                    <span className="row" style={{ gap: 6 }}>
                      {a.is_sample ? <Chip kind="sample">Sample</Chip> : null}
                      <Chip kind={a.lane}>{a.lane}</Chip>
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>
                    {byId.get(a.tenant_id)?.name} · waiting on {a.approver === 'team' ? 'the team' : 'the client'} · {daysSince(a.requested_at)}d
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing is waiting">Approvals appear here the moment a draft is ready.</Empty>
          )}
        </Panel>

        <Panel title="Care desk" sub="Monthly maintenance requests" actions={<Link className="btn small" href="/console/care">Care desk</Link>}>
          {careRows.length ? (
            <ul className="list">
              {careRows.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <div className="spread">
                    <b>{c.title}</b>
                    <span className="row" style={{ gap: 6 }}>
                      {c.is_sample ? <Chip kind="sample">Sample</Chip> : null}
                      <Status value={c.status} />
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>{byId.get(c.tenant_id)?.name} · {c.kind} · {daysSince(c.created_at)}d</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No open requests">Client requests from their dashboards land here.</Empty>
          )}
        </Panel>

        <Panel title="New inquiries" actions={<Link className="btn small" href="/console/inquiries">All inquiries</Link>}>
          {inquiries.data?.length ? (
            <ul className="list">
              {inquiries.data.map((i) => (
                <li key={i.id}>
                  <div className="spread">
                    <b>{i.org}</b>
                    <Chip kind={i.kind === 'carrier' ? 'required' : 'info'}>{i.kind}</Chip>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>{i.name} · {dateTime(i.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No new inquiries">The website’s agency and carrier forms land here.</Empty>
          )}
        </Panel>

        <Panel title="Recent activity" sub="From the tamper-evident audit log" actions={<Link className="btn small" href="/console/audit">Audit log</Link>}>
          {audit.data?.length ? (
            <ul className="list">
              {audit.data.map((e) => (
                <li key={e.id}>
                  <div className="spread">
                    <span><b>{e.action}</b> <span className="muted">{e.subject}</span></span>
                    <span className="muted num" style={{ fontSize: 12 }}>#{e.id}</span>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>{e.actor_label} · {dateTime(e.at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No activity yet" />
          )}
        </Panel>
      </div>

      <Panel title="Clients in setup" sub="Gates cleared per client">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Client</th><th>Stage</th><th>Days in stage</th><th style={{ width: '30%' }}>Gates</th></tr>
            </thead>
            <tbody>
              {ts.filter((t) => t.stage !== 'care').map((t) => {
                const tg = g.filter((x) => x.tenant_id === t.id);
                const cleared = tg.filter((x) => x.status === 'cleared' || x.status === 'waived').length;
                return (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/console/clients/${t.slug}`}>{t.name}</Link> {t.is_sample ? <Chip kind="sample">Sample</Chip> : null}
                    </td>
                    <td>{STAGE_LABEL[t.stage as Stage]}</td>
                    <td className="num">{daysSince(t.stage_since)}</td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <div style={{ flex: 1 }}><Bar value={cleared} total={tg.length} done={cleared === tg.length && tg.length > 0} /></div>
                        <span className="muted num" style={{ fontSize: 13 }}>{cleared}/{tg.length}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </ConsoleShell>
  );
}
