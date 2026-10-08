import Link from 'next/link';
import { requireNetwork } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { usStates, STATE_NAME } from '@/lib/us-map';
import { Shell } from '@/components/Shell';
import { EcosystemSwitcher } from '@/components/EcosystemSwitcher';
import { NetworkForecast } from '@/components/NetworkForecast';
import { Panel, Tile, Chip, Bar, Empty, STAGES, STAGE_LABEL, PLAN_LABEL, daysSince, type Stage } from '@/components/ui';

export const metadata = { title: 'Network' };
export const dynamic = 'force-dynamic';

type Row = {
  network_id: string; network: string; tenant_name: string; slug: string; state: string | null; stage: Stage; stage_since: string; plan: string | null;
  gates_cleared: number; gates_total: number; approvals_pending: number; approval_hours: number | null; posts_month: number; leads_month: number | null; is_sample: boolean;
};
type SP = { n?: string; state?: string; stage?: string; q?: string; page?: string };
const PAGE = 25;

export default async function NetworkView({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const v = await requireNetwork();
  const supabase = await db();
  const { data: nets } = await supabase.from('networks').select('id, slug, name, is_sample').order('name');
  const networks = nets ?? [];
  // Default to the biggest network the viewer can see.
  const counts = await Promise.all(networks.map(async (n) => (await supabase.from('network_tenants').select('tenant_id', { count: 'exact', head: true }).eq('network_id', n.id)).count ?? 0));
  const current = networks.find((n) => n.slug === sp.n) ?? networks[counts.indexOf(Math.max(...counts, 0))];
  const { data, error } = current ? await supabase.rpc('network_portfolio', { p_network: current.id }) : { data: [], error: null };
  const all = (data ?? []) as Row[];
  const sample = all.some((r) => r.is_sample);

  const link = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    const merged = { n: current?.slug, state: sp.state, stage: sp.stage, q: sp.q, ...patch };
    for (const [k, val] of Object.entries(merged)) if (val) p.set(k, String(val));
    return `/network${p.size ? `?${p}` : ''}`;
  };

  const q = sp.q?.trim().toLowerCase() ?? '';
  const rows = all.filter((r) => (!sp.state || r.state === sp.state) && (!sp.stage || r.stage === sp.stage) && (!q || r.tenant_name.toLowerCase().includes(q)));
  const live = all.filter((r) => r.stage === 'care');
  const hours = all.map((r) => r.approval_hours).filter((x): x is number => x != null).map(Number);
  const avgHours = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null;
  const leads = all.reduce((s, r) => s + (r.leads_month ?? 0), 0);
  const posts = all.reduce((s, r) => s + r.posts_month, 0);
  const waiting = all.reduce((s, r) => s + r.approvals_pending, 0);
  const byStage = STAGES.map((s) => ({ s, n: all.filter((r) => r.stage === s).length }));
  const maxStage = Math.max(1, ...byStage.map((x) => x.n));

  const perState = new Map<string, { total: number; live: number; leads: number }>();
  for (const r of all) {
    if (!r.state) continue;
    const e = perState.get(r.state) ?? { total: 0, live: 0, leads: 0 };
    e.total++;
    if (r.stage === 'care') e.live++;
    e.leads += r.leads_month ?? 0;
    perState.set(r.state, e);
  }
  const maxState = Math.max(1, ...[...perState.values()].map((e) => e.total));
  const { shapes, borders } = usStates();
  const topStates = [...perState.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 8);
  const hasMap = perState.size > 0;

  const page = Math.max(1, Number(sp.page) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = [...rows].sort((a, b) => STAGES.indexOf(b.stage) - STAGES.indexOf(a.stage) || a.tenant_name.localeCompare(b.tenant_name)).slice((page - 1) * PAGE, page * PAGE);

  return (
    <Shell
      surface="Network"
      home="/network"
      title={current?.name ?? 'Network portfolio'}
      who={{ name: v.staff?.name ?? v.email, detail: v.staff ? 'Genovus team' : 'Network partner' }}
      switcher={<EcosystemSwitcher current="carrier" />}
      back={v.staff ? { href: '/console', label: 'Enterprise' } : undefined}
      nav={[{ title: networks.length > 1 ? 'Networks' : undefined, items: networks.map((n) => ({ href: `/network?n=${n.slug}`, label: n.name.replace(' (scenario)', ''), exact: true })) }]}
    >
      {sample ? <div className="notice sample"><b>Scenario.</b> These agencies are fictional, spread across states by population, and every number is illustrative. A real network view starts with a pilot.</div> : null}
      {error ? <div className="notice err">The portfolio could not load: {error.message}</div> : null}

      <div className="grid g4">
        <Tile label="Offices" value={<span className="num">{all.length}</span>} hint={hasMap ? `${perState.size} states` : 'In this network'} sample={sample} />
        <Tile label="Live on Genovus" value={<span className="num">{live.length}</span>} hint={`${Math.round((live.length / Math.max(1, all.length)) * 100)}% of the network`} sample={sample} />
        <Tile label="Approval turnaround" value={avgHours != null ? <span className="num">{avgHours.toFixed(1)}h</span> : '—'} hint={`${waiting} waiting now`} sample={sample} />
        <Tile label="Leads last month" value={<span className="num">{leads.toLocaleString('en-US')}</span>} hint={`${posts} posts published this month`} sample={sample} />
      </div>

      <div className="grid net-top">
        {hasMap ? (
          <Panel title="Offices by state" sub={sp.state ? `Showing ${STATE_NAME[sp.state] ?? sp.state}. Click it again to clear.` : 'Click a state to filter the offices below'} actions={sample ? <Chip kind="sample">Sample</Chip> : null}>
            <svg viewBox="0 0 975 610" className="netmap" role="img" aria-label="Offices by state">
              {shapes.map((s) => {
                const e = perState.get(s.abbr);
                const t = e ? 0.15 + 0.85 * (e.total / maxState) : 0;
                const on = sp.state === s.abbr;
                return (
                  <a key={s.abbr} href={link({ state: on ? undefined : s.abbr, page: undefined })} aria-label={`${s.name}: ${e?.total ?? 0} offices, ${e?.live ?? 0} live`}>
                    <path d={s.d} className={'st' + (on ? ' on' : '')} style={{ fill: e ? `rgba(255,106,43,${t.toFixed(2)})` : 'rgba(255,255,255,.03)' }}>
                      <title>{`${s.name}: ${e?.total ?? 0} offices · ${e?.live ?? 0} live`}</title>
                    </path>
                    {e?.live ? <circle cx={s.cx} cy={s.cy} r={Math.min(14, 3 + e.live * 1.4)} className="st-live" /> : null}
                  </a>
                );
              })}
              <path d={borders} className="st-borders" />
            </svg>
            <div className="row muted" style={{ fontSize: 12, gap: 14 }}>
              <span><i className="legend-swatch" /> More offices</span><span><i className="legend-dot" /> Live on Genovus</span>
            </div>
          </Panel>
        ) : null}
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Where every office is" sub="Click a stage to filter">
            <div style={{ display: 'grid', gap: 7 }}>
              {byStage.map(({ s, n }) => (
                <Link key={s} href={link({ stage: sp.stage === s ? undefined : s, page: undefined })} className={'stage-row' + (sp.stage === s ? ' on' : '')}>
                  <span className="muted" style={{ fontSize: 13 }}>{STAGE_LABEL[s]}</span>
                  <div className="bar"><i style={{ width: `${(n / maxStage) * 100}%` }} /></div>
                  <span className="num" style={{ textAlign: 'right' }}>{n}</span>
                </Link>
              ))}
            </div>
          </Panel>
          {hasMap ? (
            <Panel title="Top states">
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>State</th><th>Offices</th><th>Live</th><th>Leads</th></tr></thead>
                  <tbody>
                    {topStates.map(([st, e]) => (
                      <tr key={st}><td><Link href={link({ state: st, page: undefined })}>{STATE_NAME[st] ?? st}</Link></td><td className="num">{e.total}</td><td className="num">{e.live}</td><td className="num">{e.leads}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>

      <NetworkForecast offices={all} sample={sample} />

      <Panel title="Governance" sub="Planned for carrier pilots" actions={<Chip kind="dev">In development</Chip>}>
        <div className="grid g3">
          <div><b>Your wording rules</b><p className="soft" style={{ fontSize: 14 }}>Required phrases and banned claims, checked on every draft before anyone reads it.</p></div>
          <div><b>Approved template library</b><p className="soft" style={{ fontSize: 14 }}>Your artwork and posts, versioned, with who approved each one.</p></div>
          <div><b>Approval routing</b><p className="soft" style={{ fontSize: 14 }}>Your compliance team signs off where you require it, with a full audit trail.</p></div>
        </div>
      </Panel>

      <Panel
        title="Offices"
        sub={`${rows.length} of ${all.length}${sp.state ? ` in ${STATE_NAME[sp.state] ?? sp.state}` : ''}${sp.stage ? ` · ${STAGE_LABEL[sp.stage as Stage]}` : ''}`}
        actions={sp.state || sp.stage || sp.q ? <Link className="btn small" href={link({ state: undefined, stage: undefined, q: undefined, page: undefined })}>Clear filters</Link> : null}
      >
        <form className="row" role="search" action="/network">
          {current ? <input type="hidden" name="n" value={current.slug} /> : null}
          {sp.state ? <input type="hidden" name="state" value={sp.state} /> : null}
          {sp.stage ? <input type="hidden" name="stage" value={sp.stage} /> : null}
          <input className="input" name="q" defaultValue={sp.q ?? ''} placeholder="Search offices" aria-label="Search offices" style={{ flex: 1, minWidth: 200 }} />
          <button className="btn small" type="submit">Search</button>
        </form>
        {shown.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Agency</th><th>State</th><th>Stage</th><th>Plan</th><th style={{ width: '18%' }}>Launch checklist</th><th>Waiting</th><th>Turnaround</th><th>Posts</th><th>Leads</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.slug}>
                    <td>{v.staff ? <Link href={`/console/clients/${r.slug}`}>{r.tenant_name}</Link> : <b>{r.tenant_name}</b>}</td>
                    <td>{r.state ?? '—'}</td>
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
        ) : <Empty title="No offices match these filters" />}
        {pages > 1 ? (
          <div className="row">
            {page > 1 ? <Link className="btn small" href={link({ page: String(page - 1) })}>Previous</Link> : null}
            <span className="muted" style={{ fontSize: 13 }}>Page {page} of {pages}</span>
            {page < pages ? <Link className="btn small" href={link({ page: String(page + 1) })}>Next</Link> : null}
          </div>
        ) : null}
      </Panel>
    </Shell>
  );
}
