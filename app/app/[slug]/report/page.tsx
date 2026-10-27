// The monthly report (Growth and Premium): last month's numbers, how they compare with the month before, where
// customers came from, and the one improvement for next month. Written on the 1st (lib/monthly-report.ts).
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { Panel, Tile, Empty } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';
import { sourceLabel } from '@/lib/visibility';
import type { ReportMetrics } from '@/lib/monthly-report';

export const metadata = { title: 'Monthly report' };
export const dynamic = 'force-dynamic';

const month = (p: string) => new Date(`${p}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const delta = (a?: number, b?: number) => (a == null || b == null || b === 0 ? null : Math.round(((a - b) / b) * 100));

export default async function Report({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  if (!access.has('report')) return <AgencyShell ctx={ctx} title="Monthly report"><ModuleGate ctx={ctx} moduleKey="report" /></AgencyShell>;
  const { data } = await (await db()).from('kpi_snapshots').select('period, metrics').eq('tenant_id', ctx.tenant.tenantId).eq('is_sample', false).order('period', { ascending: false }).limit(12);
  const reports = (data ?? []).filter((r) => (r.metrics as Partial<ReportMetrics>)?.improvement);
  if (!reports.length) return <AgencyShell ctx={ctx} title="Monthly report"><Empty title="Your first report arrives on the 1st">Each month: your leads, how fast you answered, bookings, new customers, posts and reach, and the one thing to do next.</Empty></AgencyShell>;
  const [cur, prev] = reports;
  const m = cur.metrics as ReportMetrics, p = prev?.metrics as ReportMetrics | undefined;
  const tile = (label: string, v: number | undefined, pv: number | undefined, hint: string) => {
    const d = delta(v, pv);
    return <Tile label={label} value={<span className="num">{v == null ? '—' : v.toLocaleString('en-US')}</span>} hint={d == null ? hint : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% vs ${month(prev!.period).split(' ')[0]}`} />;
  };
  return (
    <AgencyShell ctx={ctx} title="Monthly report">
      <section className="vis-move" aria-label="Next month's one move">
        <div className="vis-egg" aria-hidden="true" />
        <div className="vis-move-body">
          <span className="eyebrow">{month(cur.period)} · next month, one thing</span>
          <h2>{m.improvement}</h2>
          <p className="soft">{m.why}</p>
        </div>
      </section>
      <Panel title={`${month(cur.period)} at a glance`} sub="From your Leads, content calendar and social accounts">
        <div className="grid g4">
          {tile('Leads', m.leads, p?.leads, 'New this month')}
          {tile('Booked', m.bookings, p?.bookings, 'Consults booked')}
          {tile('Won', m.policies, p?.policies, 'Marked won')}
          <Tile label="Time to first call" value={m.responseMinutes == null ? '—' : m.responseMinutes < 60 ? `${m.responseMinutes} min` : `${(m.responseMinutes / 60).toFixed(1)} h`} hint="Median" />
          {tile('Posts published', m.posts, p?.posts, 'On Facebook and Instagram')}
          {m.views != null ? tile('Social views', m.views, p?.views, 'Facebook and Instagram') : null}
          {m.reach != null ? tile('People reached', m.reach, p?.reach, 'Instagram') : null}
          {tile('Reviews asked', m.reviewsAsked, p?.reviewsAsked, 'Of new customers')}
        </div>
      </Panel>
      {m.bySource.length ? (
        <Panel title="Where your leads came from">
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Source</th><th className="num">Leads</th><th className="num">Won</th></tr></thead>
            <tbody>{m.bySource.map((s) => <tr key={s.source}><td>{sourceLabel(s.source)}</td><td className="num">{s.leads}</td><td className="num">{s.won}</td></tr>)}</tbody>
          </table></div>
        </Panel>
      ) : null}
      {reports.length > 1 ? <p className="muted" style={{ fontSize: 13 }}>Earlier reports: {reports.slice(1).map((r) => month(r.period)).join(' · ')}</p> : null}
    </AgencyShell>
  );
}
