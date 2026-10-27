// Daily social reach and views for the Visibility board: two lines over the last 28 days, the latest values called
// out. Server-rendered SVG on the dashboard tokens, so it reads in both themes.
const short = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export function VisibilityChart({ days }: { days: { day: string; reach: number; views: number }[] }) {
  if (days.length < 2) return null;
  const W = 640, H = 200, L = 44, R = 14, T = 16, B = 26;
  const max = Math.max(1, ...days.map((d) => Math.max(d.reach, d.views)));
  const step = (() => { const raw = max / 4, p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map((x) => x * p).find((s) => s >= raw) ?? raw; })();
  const top = step * 4;
  const x = (i: number) => L + ((W - L - R) * i) / (days.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const line = (k: 'reach' | 'views') => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(d[k]).toFixed(1)}`).join(' ');
  const area = (k: 'reach' | 'views') => `${line(k)} L${x(days.length - 1).toFixed(1)} ${y(0)} L${x(0).toFixed(1)} ${y(0)} Z`;
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1];
  const last = days.at(-1)!;
  return (
    <figure className="vis-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`Daily reach and views, ${short(days[0].day)} to ${short(last.day)}`}>
        <defs>
          <linearGradient id="vis-area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--accent)" stopOpacity=".35" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></linearGradient>
        </defs>
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}><line x1={L} x2={W - R} y1={y(step * i)} y2={y(step * i)} className="grid-line" /><text x={L - 8} y={y(step * i) + 4} textAnchor="end" className="axis">{Math.round(step * i).toLocaleString('en-US')}</text></g>
        ))}
        <path d={area('views')} fill="url(#vis-area)" />
        <path d={line('views')} fill="none" stroke="var(--accent-2)" strokeWidth="2.25" strokeLinejoin="round" />
        <path d={line('reach')} fill="none" stroke="var(--info)" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
        <circle cx={x(days.length - 1)} cy={y(last.views)} r="4.5" fill="var(--accent-2)" />
        {ticks.map((i) => <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'} className="axis">{short(days[i].day)}</text>)}
      </svg>
      <figcaption className="vis-legend"><span><i style={{ background: 'var(--accent-2)' }} />Views</span><span><i style={{ background: 'var(--info)' }} />People reached (Instagram)</span></figcaption>
    </figure>
  );
}
