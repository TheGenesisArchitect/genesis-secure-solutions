import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Tile, Panel, Empty, Chip } from '@/components/ui';
import { MetricChain, type Metrics } from '@/components/MetricChain';
import { Trend } from '@/components/Trend';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';

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
  const { data: leadRows } = await supabase.from('leads').select('source, status, created_at, first_contact_at').eq('tenant_id', ctx.tenant.tenantId).gte('created_at', new Date(Date.now() - 90 * 86_400_000).toISOString()).limit(5000);
  const leads = leadRows ?? [];
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
  const booked = last30.filter((l) => ['booked', 'won'].includes(l.status)).length;
  const wonN = last30.filter((l) => l.status === 'won').length;
  const kpiPanel = access.has('kpis') ? (
    <Panel title="KPI scorecard" sub="Last 30 days · the rates your office runs the week by">
      <div className="grid g3">
        <Tile label="Contact rate" value={pct(reached, last30.length)} hint={`${reached} of ${last30.length} leads reached`} />
        <Tile label="Booked rate" value={pct(booked, last30.length)} hint={`${booked} consults booked`} />
        <Tile label="Win rate" value={pct(wonN, last30.length)} hint={`${wonN} marked won`} />
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
        <Tile label="Won" value={<span className="num">{leads.filter((l) => l.status === 'won').length}</span>} hint="Marked won by your office" />
        <Tile label="Top source" value={bySource[0] ? SOURCE[bySource[0][0]] ?? bySource[0][0] : '—'} hint={bySource[0] ? `${Math.round((bySource[0][1] / leads.length) * 100)}% of leads` : ''} />
      </div>
      {weeks.length > 1 ? <Trend points={weeks} /> : null}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{bySource.map(([src, n]) => <Chip key={src} kind="info">{SOURCE[src] ?? src} · {n}</Chip>)}</div>
    </Panel>
  ) : null;
  return (
    <AgencyShell ctx={ctx} title="Performance" film={film}>
      {kpiPanel}
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
