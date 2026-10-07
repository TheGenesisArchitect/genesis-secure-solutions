// The spec's metric chain (reach → engagement → actions → response → outcomes → efficiency), with the
// month-over-month change and the weakest link outlined, so the one improvement is obvious.
import { Chip } from './ui';

export type Metrics = {
  visits?: number; reach?: number; engagement?: number; calls?: number; callbacks?: number; bookings?: number;
  responseMinutes?: number; quotes?: number; policies?: number; leads?: number; spendCents?: number;
};

const n = (x?: number) => (x ?? 0).toLocaleString('en-US');

export function chainLinks(m: Metrics) {
  const actions = (m.calls ?? 0) + (m.callbacks ?? 0) + (m.bookings ?? 0);
  const cpl = m.spendCents && m.leads ? m.spendCents / 100 / m.leads : null;
  return [
    { k: 'Reach', v: n((m.visits ?? 0) + (m.reach ?? 0)), raw: (m.visits ?? 0) + (m.reach ?? 0), sub: `${n(m.visits)} site visits` },
    { k: 'Engagement', v: n(m.engagement), raw: m.engagement ?? 0, sub: 'Post and profile actions' },
    { k: 'Actions', v: n(actions), raw: actions, sub: `${n(m.calls)} calls · ${n(m.callbacks)} callbacks` },
    { k: 'Response', lowerIsBetter: true, v: m.responseMinutes != null ? `${m.responseMinutes}m` : '—', raw: m.responseMinutes != null ? -m.responseMinutes : 0, sub: 'Median time to first reply' },
    { k: 'Outcomes', v: `${n(m.quotes)} / ${n(m.policies)}`, raw: m.policies ?? 0, sub: 'Quotes / policies (staff-logged)' },
    { k: 'Efficiency', lowerIsBetter: true, v: cpl != null ? `$${cpl.toFixed(0)}` : '—', raw: cpl != null ? -cpl : 0, sub: 'Cost per lead' },
  ];
}

export function MetricChain({ m, prev, sample }: { m: Metrics; prev?: Metrics; sample?: boolean }) {
  const links = chainLinks(m);
  const before = prev ? chainLinks(prev) : null;
  // Weakest link = the biggest drop against last month (or none when every link held).
  let weak = -1;
  if (before) {
    let worst = 0;
    links.forEach((l, i) => {
      const b = before[i].raw;
      const change = b ? (l.raw - b) / Math.abs(b) : 0;
      if (change < worst) { worst = change; weak = i; }
    });
  }
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {sample ? <div><Chip kind="sample">Sample numbers</Chip></div> : null}
      <div className="chain">
        {links.map((l, i) => {
          const b = before?.[i].raw;
          const delta = b ? Math.round(((l.raw - b) / Math.abs(b)) * 100) : null;
          return (
            <div key={l.k} className={i === weak ? 'weak' : ''}>
              <span className="k">{l.k}</span>
              <span className="v">{l.v}</span>
              <span className="muted" style={{ fontSize: 12 }}>{l.sub}</span>
              {delta != null && delta !== 0 ? <span style={{ fontSize: 12, color: delta > 0 ? 'var(--done)' : 'var(--bad)' }}>{(l.lowerIsBetter ? delta < 0 : delta > 0) ? '▲' : '▼'} {Math.abs(delta)}% vs last month</span> : null}
            </div>
          );
        })}
      </div>
      {weak >= 0 ? <p className="soft" style={{ fontSize: 14 }}>Weakest link this month: <b>{links[weak].k}</b>. Your monthly report proposes one improvement for it.</p> : null}
    </div>
  );
}
