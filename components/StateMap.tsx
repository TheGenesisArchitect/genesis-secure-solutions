// A clickable US map shaded by a number per state (server-rendered SVG from lib/us-map.ts).
import { usStates } from '@/lib/us-map';

export function StateMap({ values, selected, href, unit, dots }: {
  values: Map<string, number>; selected?: string; href: (abbr: string | undefined) => string; unit: string; dots?: Map<string, number>;
}) {
  const { shapes, borders } = usStates();
  const max = Math.max(1, ...values.values());
  return (
    <svg viewBox="0 0 975 610" className="netmap" role="img" aria-label={`${unit} by state`}>
      {shapes.map((s) => {
        const n = values.get(s.abbr) ?? 0;
        const t = n ? 0.15 + 0.85 * (n / max) : 0;
        const on = selected === s.abbr;
        const d = dots?.get(s.abbr) ?? 0;
        return (
          <a key={s.abbr} href={href(on ? undefined : s.abbr)} aria-label={`${s.name}: ${n} ${unit}`}>
            <path d={s.d} className={'st' + (on ? ' on' : '')} style={{ fill: n ? `rgba(255,106,43,${t.toFixed(2)})` : 'rgba(255,255,255,.03)' }}>
              <title>{`${s.name}: ${n.toLocaleString('en-US')} ${unit}${d ? ` · ${d} in conversation` : ''}`}</title>
            </path>
            {d ? <circle cx={s.cx} cy={s.cy} r={Math.min(14, 3 + d * 1.4)} className="st-live" /> : null}
          </a>
        );
      })}
      <path d={borders} className="st-borders" />
    </svg>
  );
}
