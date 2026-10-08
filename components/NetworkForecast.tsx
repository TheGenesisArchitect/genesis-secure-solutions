// What the network is worth to Genovus at different levels of adoption, priced from our real rates
// (data/offers.ts) and the plan mix of the offices already live. A projection, labeled as one.
import { PLANS } from '@/data/offers';
import { Panel, Chip, money as fmt } from './ui';

// Whole dollars: a forecast should never look more precise than it is.
const money = (cents: number) => fmt(Math.round(cents / 100) * 100);

type Office = { stage: string; plan: string | null };

const OPERATOR_CAPACITY = 40; // live agencies one content-and-care operator can run (spec staffing model)
const POSTS_PER_AGENCY = 8; // 4 posts x 2 platforms each month

export function NetworkForecast({ offices, sample }: { offices: Office[]; sample: boolean }) {
  const total = offices.length;
  const live = offices.filter((o) => o.stage === 'care');
  const priced = (offices.filter((o) => o.plan).length ? offices.filter((o) => o.plan) : [{ plan: 'launch' }]) as { plan: string }[];
  const mix = (live.length ? live : priced) as { plan: string | null }[];
  const plan = (id: string | null) => PLANS.find((p) => p.id === (id === 'vip' ? 'launch' : id)) ?? PLANS[0];
  const avgSetup = mix.reduce((s, o) => s + (plan(o.plan).setupCents ?? 0), 0) / mix.length;
  const avgCare = mix.reduce((s, o) => s + (plan(o.plan).careCents ?? 0), 0) / mix.length;
  const scenarios = [
    { name: 'Pilot', live: Math.min(10, total), note: '90-day pilot group' },
    { name: 'Today', live: live.length, note: `${Math.round((live.length / Math.max(1, total)) * 100)}% of offices live` },
    { name: 'Half the network', live: Math.round(total / 2), note: '' },
    { name: 'Every office', live: total, note: 'full adoption' },
  ];
  return (
    <Panel
      title="Forecast"
      sub="What this network is worth on Genovus at each level of adoption, priced from our published rates and the plan mix of offices already live"
      actions={<><Chip kind="dev">Projection</Chip>{sample ? <Chip kind="sample">Sample</Chip> : null}</>}
    >
      <div className="table-wrap">
        <table className="t">
          <thead>
            <tr><th>Scenario</th><th>Offices live</th><th>Setup revenue</th><th>Monthly care</th><th>Annual run-rate</th><th>Posts / month</th><th>Care operators</th></tr>
          </thead>
          <tbody>
            {scenarios.map((s) => {
              const mrr = s.live * avgCare;
              return (
                <tr key={s.name} style={s.name === 'Today' ? { background: 'rgba(255,106,43,.07)' } : undefined}>
                  <td><b>{s.name}</b>{s.note ? <div className="muted" style={{ fontSize: 12 }}>{s.note}</div> : null}</td>
                  <td className="num">{s.live.toLocaleString('en-US')}</td>
                  <td className="num">{money(Math.round(s.live * avgSetup))}</td>
                  <td className="num">{money(Math.round(mrr))}</td>
                  <td className="num"><b>{money(Math.round(mrr * 12))}</b></td>
                  <td className="num">{(s.live * POSTS_PER_AGENCY).toLocaleString('en-US')}</td>
                  <td className="num">{Math.max(1, Math.ceil(s.live / OPERATOR_CAPACITY))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Average setup {money(Math.round(avgSetup))} and care {money(Math.round(avgCare))}/month from the current plan mix. Excludes add-ons (ads management, annual prepay, launch kits) and assumes one operator per {OPERATOR_CAPACITY} live agencies. Not a commitment by any carrier.
      </p>
    </Panel>
  );
}
