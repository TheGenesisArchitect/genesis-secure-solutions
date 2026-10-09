import { VisionShell, Src } from '@/components/vision/VisionShell';
import { RevenueChart } from '@/components/RevenueChart';
import { Panel, Tile, Chip, money } from '@/components/ui';
import { FUNNEL, GATE, MARKET_PNL } from '@/data/vision';

export const metadata = { title: 'Funnel & BI · Growth Engine vision', robots: { index: false, follow: false } };

const SERIES = [
  { month: '2026-07', setup: 0, care: 0, acquisition: 12000, operating: 41000 },
  { month: '2026-08', setup: 150000, care: 0, acquisition: 18000, operating: 41000 },
  { month: '2026-09', setup: 300000, care: 24900, acquisition: 26000, operating: 44500 },
  { month: '2026-10', setup: 450000, care: 74700, acquisition: 32000, operating: 54500 },
  { month: '2026-11', setup: 600000, care: 149400, acquisition: 61000, operating: 54500 },
  { month: '2026-12', setup: 750000, care: 224100, acquisition: 98000, operating: 54500 },
];

export default function Funnel() {
  const top = FUNNEL[0].n;
  const unlocked = GATE.actual >= GATE.threshold;
  return (
    <VisionShell
      slug="funnel"
      lede={<>The platform shows the team the <b>money</b>: what each market is worth, what it costs to win, where people drop off, and when a market has earned paid ads. Paid spend unlocks per market, only after organic and calls prove the conversion.</>}
      spec={[
        { title: 'Built today', items: [
          { k: 'Finance', v: 'Growth & financials: revenue from paid invoices, MRR from care, CAC, payback, margin (lib/finance.ts).' },
          { k: 'Funnel', v: 'Real network: offices → contacting → replied → consult → proposal → won (prospect_counts).' },
          { k: 'Snapshots', v: 'Monthly KPIs saved to kpi_snapshots for trends.' },
        ] },
        { title: 'Next', items: [
          { k: 'Per market', v: 'Every expense, call, post and inquiry carries market_id; the board groups by market.' },
          { k: 'Paid gate', v: 'A market setting: consults per 100 conversations ≥ threshold opens paid; spend stays Lane 3 under a budget.' },
          { k: 'Reach', v: 'Organic reach and engagement from Graph API insights and YouTube Analytics.' },
        ] },
        { title: 'Paid channels (after the gate)', items: [
          { k: 'LinkedIn', v: <>Job title + company + metro; API needs Marketing Developer Platform approval (weeks to months). <Src href="https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers">tiers</Src></> },
          { k: 'Google Ads', v: <>Basic access ~2 business days, Standard ~10. <Src href="https://developers.google.com/google-ads/api/docs/access-levels">access</Src></> },
          { k: 'Meta', v: 'Geo radius + site retargeting; uploaded audiences only from consented contacts.' },
        ] },
      ]}
    >
      <div className="grid g4">
        <Tile label="Clients won" value={<span className="num">5</span>} hint="Columbus 3 · Atlanta 2" sample />
        <Tile label="CAC" value="$364" hint="Acquisition spend ÷ new clients" sample />
        <Tile label="Payback" value="At setup" hint="Setup covers CAC; care is margin" sample />
        <Tile label="MRR" value="$1,395" hint="ARR $16,740" sample />
      </div>
      <div className="vgrid2" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
        <Panel tour="funnel" title="The funnel" sub="Columbus + Atlanta · last 60 days" actions={<Chip kind="sample">Sample</Chip>}>
          <div className="vfunnel">
            {FUNNEL.map((f, i) => (
              <div key={f.stage} className="row">
                <span>{f.stage}</span>
                <span><span className="bar" style={{ width: `${Math.max(6, 100 * Math.sqrt(f.n / top))}%`, animationDelay: `${i * 70}ms` }}>{f.n.toLocaleString('en-US')}</span></span>
                <span className="muted">{i ? `${((100 * f.n) / FUNNEL[i - 1].n).toFixed(f.n / FUNNEL[i - 1].n < 0.1 ? 1 : 0)}%` : 'reach'}</span>
              </div>
            ))}
          </div>
          <div className="gate" data-tour="gate">
            <span style={{ font: '800 26px var(--display)', color: unlocked ? 'var(--done)' : 'var(--warn)' }}>{unlocked ? '🔓' : '🔒'}</span>
            <span style={{ flex: 1 }}><b>Paid gate · Columbus</b><br /><span className="muted" style={{ fontSize: 13 }}>{GATE.metric}: <b style={{ color: 'var(--ink)' }}>{GATE.actual}</b> vs {GATE.threshold} needed</span></span>
            <span className={'chip ' + (unlocked ? 'done' : 'pending')}>{unlocked ? 'Paid unlocked' : 'Organic + calls'}</span>
          </div>
        </Panel>
        <Panel tour="markets-table" title="Markets" sub="What each market cost and earned" actions={<Chip kind="sample">Sample</Chip>}>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Market</th><th>Spend</th><th>Clients</th><th>MRR</th><th>CAC</th></tr></thead>
              <tbody>{MARKET_PNL.map((m) => <tr key={m.market}><td>{m.market}</td><td className="num">{money(m.spend * 100)}</td><td className="num">{m.clients}</td><td className="num">{money(m.mrr * 100)}</td><td className="num">{m.cac == null ? '—' : money(m.cac * 100)}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>
      </div>
      <Panel tour="revenue-chart" title="Revenue vs spend" sub="Setup and care against acquisition and operating cost, by month" actions={<Chip kind="dev">Projection</Chip>}>
        <RevenueChart series={SERIES} />
      </Panel>
    </VisionShell>
  );
}
