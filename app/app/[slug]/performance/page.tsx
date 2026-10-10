import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Empty, Chip } from '@/components/ui';
import { MetricChain, type Metrics } from '@/components/MetricChain';
import { Trend } from '@/components/Trend';
import { db } from '@/lib/supabase/server';

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
  return (
    <AgencyShell ctx={ctx} title="Performance" film={film}>
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
