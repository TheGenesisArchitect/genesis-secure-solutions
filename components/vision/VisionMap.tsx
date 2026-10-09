'use client';
// Chapter 1: Radar sweeps the country and markets light up one by one, sized by offices and colored by
// where each sits in the funnel. Tap a market for its card. Respects reduced motion (everything shown at once).
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Shape = { abbr: string; d: string };
type Pt = { slug: string; name: string; state: string; x: number; y: number; offices: number; captive: number; fit: number; status: string };
const COLOR: Record<string, string> = { live: '#3dd691', warming: '#6aa8ff', next: '#ffb020', radar: '#ff6a2b' };
const LABEL: Record<string, string> = { live: 'Live campaign', warming: 'Warming (organic)', next: 'Up next', radar: 'On Radar' };

export function VisionMap({ shapes, borders, points }: { shapes: Shape[]; borders: string; points: Pt[] }) {
  const [shown, setShown] = useState(0);
  const [sel, setSel] = useState<Pt | null>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(points.length); return; }
    let n = 0;
    const t = setInterval(() => { n++; setShown(n); if (n >= points.length) clearInterval(t); }, 260);
    return () => clearInterval(t);
  }, [points.length]);
  const visible = points.slice(0, shown);
  const total = useMemo(() => visible.reduce((a, p) => a + p.offices, 0), [visible]);
  const max = Math.max(...points.map((p) => p.offices));
  const states = new Set(points.map((p) => p.state));
  return (
    <div className="vmap-wrap">
      <div className="vmap">
        <svg viewBox="0 0 975 610" role="img" aria-label="Markets found by Radar">
          <defs>
            <radialGradient id="vglow"><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
            <linearGradient id="vsweep" x1="0" x2="1"><stop offset="0" stopColor="#ff6a2b" stopOpacity="0" /><stop offset=".85" stopColor="#ff6a2b" stopOpacity=".18" /><stop offset="1" stopColor="#ffd9a8" stopOpacity=".55" /></linearGradient>
          </defs>
          {shapes.map((s) => <path key={s.abbr} d={s.d} className={'vst' + (states.has(s.abbr) ? ' on' : '')} />)}
          <path d={borders} className="st-borders" />
          <g className="vsweep" pointerEvents="none"><rect x="0" y="0" width="140" height="610" fill="url(#vsweep)" /><rect x="138" y="0" width="2" height="610" fill="#ffd9a8" opacity=".7" /></g>
          {visible.map((p) => {
            const r = 4 + 11 * Math.sqrt(p.offices / max);
            return (
              <g key={p.slug} className="vdot" onClick={() => setSel(p)} role="button" tabIndex={0} aria-label={`${p.name}, ${p.state}: ${p.offices} offices`}
                onKeyDown={(e) => { if (e.key === 'Enter') setSel(p); }}>
                <circle cx={p.x} cy={p.y} r={r * 2.2} fill={COLOR[p.status]} opacity=".12" className="vpulse" />
                <circle cx={p.x} cy={p.y} r={r} fill={COLOR[p.status]} opacity=".9" stroke={sel?.slug === p.slug ? '#fff' : 'none'} strokeWidth="2" />
                {p.status === 'live' || p.status === 'warming' || p.offices >= 600 ? <text x={p.state === 'GA' ? p.x : p.x + r + 4} y={p.status === 'live' ? p.y + r + 14 : p.state === 'GA' ? p.y - r - 6 : p.y + 4} textAnchor={p.state === 'GA' ? 'middle' : 'start'} className="vlabel">{p.name}</text> : null}
              </g>
            );
          })}
        </svg>
        <div className="vlegend">{Object.entries(LABEL).map(([k, l]) => <span key={k}><i style={{ background: COLOR[k] }} />{l}</span>)}</div>
      </div>
      <aside className="vmap-side">
        <div className="tile">
          <span className="label">Offices found</span>
          <span className="value num">{total.toLocaleString('en-US')}</span>
          <span className="hint">{shown} of {points.length} markets lit · <b className="chip sample" style={{ padding: '1px 6px' }}>Sample</b></span>
        </div>
        {sel ? (
          <div className="vcard">
            <span className="v-eyebrow">{LABEL[sel.status]}</span>
            <h3>{sel.name}, {sel.state}</h3>
            <dl className="kv lines"><dt>Offices</dt><dd>{sel.offices.toLocaleString('en-US')}</dd><dt>Captive / exclusive</dt><dd>{sel.captive.toLocaleString('en-US')}</dd><dt>Average fit</dt><dd>{sel.fit}/100</dd></dl>
            {sel.slug === 'columbus-ga' ? <Link className="btn primary small" href="/vision/market">Open the market brief →</Link> : <span className="muted" style={{ fontSize: 13 }}>Brief opens when this market reaches the top of the queue.</span>}
          </div>
        ) : (
          <div className="vcard muted"><span className="v-eyebrow">Tap a market</span><p style={{ margin: 0 }}>Each dot is a metro the scanner mapped. Size = offices; color = where it is in the funnel. Start with <b style={{ color: 'var(--ink)' }}>Columbus</b>, our home market.</p></div>
        )}
      </aside>
    </div>
  );
}
