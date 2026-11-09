import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Tile, Panel, Empty, Chip } from '@/components/ui';
import { MetricChain, type Metrics } from '@/components/MetricChain';
import { Trend } from '@/components/Trend';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';
import { scoreboard, MIN_LEADS, type BoardLead } from '@/lib/lead-scoreboard';

export const metadata = { title: 'Performance' };

export default async function Performance({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ film?: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const film = (await searchParams).film === '1' && ctx.tenant.isSample;
  const supabase = await db();
  const { data } = await supabase.from('kpi_snapshots').select('period, metrics, is_sample').eq('tenant_id', ctx.tenant.tenantId).order('period');
  const rows = data ?? [];
  const latest = rows.at(-1);
  const month = (p: string) => new Date(p + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' });
  const series = (k: keyof Metrics) => rows.map((r) => ({ label: month(r.period), value: Number((r.metrics as Metrics)[k] ?? 0) }));
  const sample = rows.some((r) => r.is_sample);
  // Real leads from the agency's website, last 90 days: by source, by week, and how fast the office calls back.
  const { data: leadRows } = await supabase.from('leads').select('source, status, created_at, first_contact_at, quoted_at, bound_at, premium_cents, lines_bound, contact_id').eq('tenant_id', ctx.tenant.tenantId).gte('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString()).limit(5000);
  const leads = (leadRows ?? []) as BoardLead[];
  const bySource = Object.entries(leads.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.source]: (acc[l.source] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const weekOf = (iso: string) => { const d = new Date(iso); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const weeks = Object.entries(leads.reduce<Record<string, number>>((acc, l) => ({ ...acc, [weekOf(l.created_at)]: (acc[weekOf(l.created_at)] ?? 0) + 1 }), {})).sort((a, b) => a[0].localeCompare(b[0])).map(([w, n]) => ({ label: new Date(w + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), value: n }));
  const replies = leads.filter((l) => l.first_contact_at).map((l) => (new Date(l.first_contact_at!).getTime() - new Date(l.created_at).getTime()) / 60_000).sort((a, b) => a - b);
  const median = replies.length ? replies[Math.floor(replies.length / 2)] : null;
  const SOURCE: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google', direct: 'Direct' };
  // KPI scorecard (Growth): the rates an agency runs its week by, from its own leads and posts.
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  const { count: posted } = await supabase.from('content_items').select('id', { count: 'exact', head: true }).eq('tenant_id', ctx.tenant.tenantId).eq('status', 'published').gte('scheduled_for', new Date(Date.now() - 30 * 86_400_000).toISOString());
  const last30 = leads.filter((l) => new Date(l.created_at).getTime() > Date.now() - 30 * 86_400_000);
  const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
  const reached = last30.filter((l) => l.status !== 'new').length;
  const booked = last30.filter((l) => ['booked', 'quoted', 'won'].includes(l.status)).length;
  const wonN = last30.filter((l) => l.status === 'won').length;
  const kpiPanel = access.has('kpis') ? (
    <Panel title="KPI scorecard" sub="Last 30 days · the rates your office runs the week by">
      <div className="grid g3">
        <Tile label="Contact rate" value={pct(reached, last30.length)} hint={`${reached} of ${last30.length} leads reached`} />
        <Tile label="Booked rate" value={pct(booked, last30.length)} hint={`${booked} consults booked`} />
        <Tile label="Bound rate" value={pct(wonN, last30.length)} hint={`${wonN} marked bound`} />
        <Tile label="Time to first call" value={median == null ? '—' : median < 60 ? `${Math.round(median)} min` : `${(median / 60).toFixed(1)} h`} hint="Median; under 5 minutes wins the most" />
        <Tile label="Leads per week" value={<span className="num">{(last30.length / (30 / 7)).toFixed(1)}</span>} hint="Average, last 30 days" />
        <Tile label="Posts published" value={<span className="num">{posted ?? 0}</span>} hint="Last 30 days" />
      </div>
    </Panel>
  ) : null;
  const leadPanel = leads.length ? (
    <Panel title="Leads from your website" sub="Last 90 days, by the source of the visit">
      <div className="grid g4">
        <Tile label="Leads" value={<span className="num">{leads.length}</span>} hint="Last 90 days" />
        <Tile label="Time to first call" value={median == null ? '—' : median < 60 ? `${Math.round(median)} min` : `${(median / 60).toFixed(1)} h`} hint="Median" />
        <Tile label="Bound" value={<span className="num">{leads.filter((l) => l.status === 'won').length}</span>} hint="Marked bound by your office" />
        <Tile label="Top source" value={bySource[0] ? SOURCE[bySource[0][0]] ?? bySource[0][0] : '—'} hint={bySource[0] ? `${Math.round((bySource[0][1] / leads.length) * 100)}% of leads` : ''} />
      </div>
      {weeks.length > 1 ? <Trend points={weeks} /> : null}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{bySource.map(([src, n]) => <Chip key={src} kind="info">{SOURCE[src] ?? src} · {n}</Chip>)}</div>
    </Panel>
  ) : null;
  // The lead scoreboard (lib/lead-scoreboard.ts): by source, last 90 days; what each source cost comes from source_costs.
  const since90 = new Date(Date.now() - 90 * 86_400_000);
  const { data: costRows } = await supabase.from('source_costs').select('source, cents').eq('tenant_id', ctx.tenant.tenantId).gte('month', `${since90.toISOString().slice(0, 7)}-01`);
  const board = scoreboard(leads, costRows ?? []);
  const rate = (x: number | null) => (x == null ? null : `${Math.round(x * 100)}%`);
  const money = (c: number | null) => (c == null ? null : `${Math.round(c / 100).toLocaleString('en-US')}`);
  const mins = (m: number | null) => (m == null ? null : m < 60 ? `${Math.round(m)} min` : `${(m / 60).toFixed(1)} h`);
  const NOT_YET = 'not enough data yet';
  const boardPanel = leads.length ? (
    <Panel title="Lead scoreboard" sub={`Last 90 days, by where the lead came from. Rates show once a source has ${MIN_LEADS} leads.`}>
      <div className="grid g4">
        <Tile label="Quote rate" value={rate(board.all.quoteRate) ?? '—'} hint={board.all.enough ? 'Leads quoted, all sources' : NOT_YET} />
        <Tile label="Bound rate" value={rate(board.all.boundRate) ?? '—'} hint={board.all.enough ? `${board.all.bound} bound` : NOT_YET} />
        <Tile label="Premium bound" value={board.all.bound ? money(board.all.premiumCents) : '—'} hint={board.all.bound ? 'From the premiums your office logged' : NOT_YET} />
        <Tile label="Lines per household" value={board.linesPerHousehold == null ? '—' : board.linesPerHousehold.toFixed(1)} hint={board.linesPerHousehold == null ? NOT_YET : `Across ${board.households} households`} />
      </div>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Source</th><th>Leads</th><th>First touch</th><th>Reached</th><th>Quoted</th><th>Bound</th><th>Premium</th><th>Cost per bound</th></tr></thead>
          <tbody>
            {board.rows.map((r) => (
              <tr key={r.source}>
                <td>{SOURCE[r.source] ?? r.source}</td>
                <td className="num">{r.leads}</td>
                {r.enough ? (
                  <>
                    <td>{mins(r.medianMin) ?? '—'}</td><td>{rate(r.contactRate)}</td><td>{rate(r.quoteRate)}</td><td>{rate(r.boundRate)}</td>
                    <td>{r.bound ? money(r.premiumCents) : '—'}</td>
                    <td>{r.costPerBoundCents != null ? money(r.costPerBoundCents) : r.costCents != null ? NOT_YET : 'add what it cost'}</td>
                  </>
                ) : <td colSpan={6} className="muted">{NOT_YET}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  ) : null;
  return (
    <AgencyShell ctx={ctx} title="Performance" film={film}>
      {kpiPanel}
      {boardPanel}
      {leadPanel}
      {latest ? (
        <>
          <Panel title="This month, link by link" sub="Every number traces to a source: site analytics, Meta and Google insights, and the outcomes your office logs">
            <MetricChain m={latest.metrics as Metrics} prev={rows.at(-2)?.metrics as Metrics | undefined} sample={latest.is_sample} />
          </Panel>
          <div className="grid g3">
            <Panel title="Leads" sub="Callbacks, calls and bookings tracked to their source" actions={sample ? <Chip kind="sample">Sample</Chip> : null}><Trend points={series('leads')} /></Panel>
            <Panel title="Time to first reply" sub="Minutes, median; lower is better" actions={sample ? <Chip kind="sample">Sample</Chip> : null}><Trend points={series('responseMinutes')} lowerIsBetter /></Panel>
            <Panel title="Policies logged" sub="Logged by your office; quotes are handed to your carrier" actions={sample ? <Chip kind="sample">Sample</Chip> : null}><Trend points={series('policies')} /></Panel>
          </div>
        </>
      ) : (
        <Panel title="Results start after launch">
          <Empty title="Nothing to measure yet">Once your site and profiles are live, this page shows reach, engagement, calls and callbacks, response time and the outcomes your office logs, every month, with one recommended improvement.</Empty>
        </Panel>
      )}
    </AgencyShell>
  );
}
