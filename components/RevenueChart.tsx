// Monthly revenue (setup + care, stacked) beside spend (acquisition + operating, stacked), one pair per month.
// Server-rendered SVG; hover a bar for its exact figures.
type M = { month: string; setup: number; care: number; acquisition: number; operating: number };

const usd = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US');
const label = (m: string) => new Date(m + '-01T12:00:00Z').toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

export function RevenueChart({ series }: { series: M[] }) {
  const W = 900, H = 260, L = 56, B = 28, T = 12;
  const max = Math.max(1, ...series.map((s) => Math.max(s.setup + s.care, s.acquisition + s.operating)));
  const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max / 100))); const steps = [1, 2, 2.5, 5, 10].map((x) => x * p * 100); return steps.find((s) => s * 4 >= max) ?? max; })();
  const top = nice * 4;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const slot = (W - L) / series.length, bw = Math.min(22, slot / 3);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Monthly revenue and spend">
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line x1={L} x2={W} y1={y(nice * i)} y2={y(nice * i)} className="grid-line" />
          <text x={L - 8} y={y(nice * i) + 4} textAnchor="end" className="axis">{usd(nice * i)}</text>
        </g>
      ))}
      {series.map((s, i) => {
        const x = L + slot * i + slot / 2;
        const bars: [number, number, string, string][] = [
          [x - bw - 2, s.setup, 'rev-setup', `Setup ${usd(s.setup)}`], [x - bw - 2, s.care, 'rev-care', `Care ${usd(s.care)}`],
          [x + 2, s.acquisition, 'sp-acq', `Acquisition ${usd(s.acquisition)}`], [x + 2, s.operating, 'sp-op', `Operating ${usd(s.operating)}`],
        ];
        const stack = (base: number, v: number) => ({ y: y(base + v), h: y(base) - y(base + v) });
        const a = stack(0, s.setup), b = stack(s.setup, s.care), c = stack(0, s.acquisition), d = stack(s.acquisition, s.operating);
        const rects = [a, b, c, d];
        return (
          <g key={s.month}>
            {bars.map(([bx, v, cls, t], k) => v ? <rect key={k} x={bx} width={bw} y={rects[k].y} height={Math.max(1, rects[k].h)} className={cls} rx={2}><title>{`${label(s.month)}: ${t}`}</title></rect> : null)}
            <text x={x} y={H - 8} textAnchor="middle" className="axis">{label(s.month)}</text>
          </g>
        );
      })}
    </svg>
  );
}
