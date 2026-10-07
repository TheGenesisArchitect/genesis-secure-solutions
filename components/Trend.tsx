// A small labelled column chart in inline SVG: one series, month labels, the latest value called out.
// Uses currentColor and tokens so it reads in both themes; no chart library needed.
export function Trend({ points, lowerIsBetter }: { points: { label: string; value: number }[]; lowerIsBetter?: boolean }) {
  if (!points.length) return null;
  const max = Math.max(...points.map((p) => p.value), 1);
  const w = 320, h = 120, pad = 18, gap = 8;
  const bw = (w - gap * (points.length - 1)) / points.length;
  const last = points.at(-1)!;
  const prev = points.at(-2);
  const better = prev ? (lowerIsBetter ? last.value < prev.value : last.value > prev.value) : null;
  return (
    <figure style={{ margin: 0, display: 'grid', gap: 8 }}>
      <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
        <span style={{ font: '800 26px var(--display)' }} className="num">{last.value.toLocaleString('en-US')}</span>
        {prev && better !== null && last.value !== prev.value ? (
          <span style={{ fontSize: 13, color: better ? 'var(--done)' : 'var(--bad)' }}>{last.value > prev.value ? '▲' : '▼'} from {prev.value.toLocaleString('en-US')}</span>
        ) : null}
      </div>
      <svg viewBox={`0 0 ${w} ${h + pad}`} role="img" aria-label={points.map((p) => `${p.label} ${p.value}`).join(', ')} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {points.map((p, i) => {
          const bh = Math.max(2, (p.value / max) * (h - 4));
          const x = i * (bw + gap);
          const isLast = i === points.length - 1;
          return (
            <g key={i}>
              <rect x={x} y={h - bh} width={bw} height={bh} rx={4} fill={isLast ? 'var(--accent)' : 'var(--line-2)'} />
              <text x={x + bw / 2} y={h + 14} textAnchor="middle" fontSize="11" fill="var(--muted)" fontFamily="var(--body)">{p.label}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
