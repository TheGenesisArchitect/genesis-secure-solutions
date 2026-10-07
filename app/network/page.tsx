import Link from 'next/link';
import { requireNetwork } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { Shell } from '@/components/Shell';
import { Panel, Tile, Chip, Bar, Empty, STAGES, STAGE_LABEL, PLAN_LABEL, daysSince, type Stage } from '@/components/ui';

export const metadata = { title: 'Network' };
export const dynamic = 'force-dynamic';

type Row = {
  network: string; tenant_name: string; slug: string; stage: Stage; stage_since: string; plan: string | null;
  gates_cleared: number; gates_total: number; approvals_pending: number; approval_hours: number | null;
  posts_month: number; leads_month: number | null; is_sample: boolean;
};

export default async function NetworkView() {
  const v = await requireNetwork();
  const supabase = await db();
  const { data, error } = await supabase.rpc('network_portfolio');
  const rows = (data ?? []) as Row[];
  const networks = [...new Set(rows.map((r) => r.network))];
  const sample = rows.some((r) => r.is_sample);
  const live = rows.filter((r) => r.stage === 'care').length;
  const hours = rows.map((r) => r.approval_hours).filter((x): x is number => x != null);
  const avgHours = hours.length ? hours.reduce((a, b) => a + Number(b), 0) / hours.length : null;
  const leads = rows.reduce((s, r) => s + (r.leads_month ?? 0), 0);
  const posts = rows.reduce((s, r) => s + r.posts_month, 0);
  const byStage = STAGES.map((s) => ({ s, n: rows.filter((r) => r.stage === s).length }));
  const maxStage = Math.max(1, ...byStage.map((x) => x.n));
  return (
    <Shell
      surface="Network"
      home="/network"
      title={networks.length === 1 ? networks[0] : 'Network portfolio'}
      who={{ name: v.staff?.name ?? v.email, detail: v.staff ? 'Genovus team' : 'Network partner' }}
      nav={[
        { items: [{ href: '/network', label: 'Portfolio', exact: true }] },
        ...(v.staff ? [{ title: 'Genovus team', items: [{ href: '/console', label: 'Back to console' }] }] : []),
      ]}
    >
      {sample ? <div className="notice sample"><b>Sample network.</b> These agencies are fictional and every number is illustrative. A real network view starts with a pilot.</div> : null}
      {error ? <div className="notice err">The portfolio could not load: {error.message}</div> : null}
      <p className="soft">Every office in your network at a glance: who is live, what is approved, how fast approvals turn around and where growth comes from. Aggregates only; leads and client records stay with each agency.</p>
      <div className="grid g4">
        <Tile label="Agencies" value={<span className="num">{rows.length}</span>} hint={`${live} live in monthly care`} sample={sample} />
        <Tile label="Approval turnaround" value={avgHours != null ? <span className="num">{avgHours.toFixed(1)}h</span> : '—'} hint="Average, request to decision" sample={sample} />
        <Tile label="Posts this month" value={<span className="num">{posts}</span>} hint="Published from approved templates" sample={sample} />
        <Tile label="Leads last month" value={<span className="num">{leads}</span>} hint="Tracked to their source" sample={sample} />
      </div>
      <div className="grid g2">
        <Panel title="Where every office is" sub="Agencies by lifecycle stage" actions={sample ? <Chip kind="sample">Sample</Chip> : null}>
          <div style={{ display: 'grid', gap: 8 }}>
            {byStage.map(({ s, n }) => (
              <div key={s} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 28px', gap: 10, alignItems: 'center' }}>
                <span className="muted" style={{ fontSize: 13 }}>{STAGE_LABEL[s]}</span>
                <div className="bar"><i style={{ width: `${(n / maxStage) * 100}%` }} /></div>
                <span className="num" style={{ textAlign: 'right' }}>{n}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Governance" sub="Planned for carrier pilots" actions={<Chip kind="dev">In development</Chip>}>
          <ul className="list">
            <li><b>Your wording rules</b><span className="soft">Required phrases and banned claims, checked on every draft before anyone reads it.</span></li>
            <li><b>Approved template library</b><span className="soft">Your artwork and posts, versioned, with who approved each one.</span></li>
            <li><b>Approval routing</b><span className="soft">Your compliance team signs off where you require it, with a full audit trail.</span></li>
          </ul>
        </Panel>
      </div>
      <Panel title="Offices" sub="Sorted by stage">
        {rows.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Agency</th><th>Stage</th><th>Plan</th><th style={{ width: '22%' }}>Launch checklist</th><th>Waiting</th><th>Turnaround</th><th>Posts</th><th>Leads</th></tr></thead>
              <tbody>
                {[...rows].sort((a, b) => STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage)).map((r) => (
                  <tr key={r.slug}>
                    <td>
                      {v.staff ? <Link href={`/console/clients/${r.slug}`}>{r.tenant_name}</Link> : <b>{r.tenant_name}</b>}{' '}
                      {r.is_sample ? <Chip kind="sample">Sample</Chip> : null}
                    </td>
                    <td>{STAGE_LABEL[r.stage]}<div className="muted" style={{ fontSize: 12 }}>{daysSince(r.stage_since)}d</div></td>
                    <td>{r.plan ? PLAN_LABEL[r.plan] : '—'}</td>
                    <td>
                      <div className="row" style={{ flexWrap: 'nowrap' }}>
                        <div style={{ flex: 1 }}><Bar value={r.gates_cleared} total={r.gates_total} done={r.gates_cleared === r.gates_total && r.gates_total > 0} /></div>
                        <span className="muted num" style={{ fontSize: 12 }}>{r.gates_cleared}/{r.gates_total}</span>
                      </div>
                    </td>
                    <td className="num">{r.approvals_pending}</td>
                    <td className="num">{r.approval_hours != null ? `${Number(r.approval_hours).toFixed(1)}h` : '—'}</td>
                    <td className="num">{r.posts_month}</td>
                    <td className="num">{r.leads_month ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No offices yet">Agencies appear here as they join your network.</Empty>}
      </Panel>
    </Shell>
  );
}
