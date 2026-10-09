import { VisionShell, Src } from '@/components/vision/VisionShell';
import { Panel, Tile, Chip } from '@/components/ui';

export const metadata = { title: 'Flywheel · Growth Engine vision', robots: { index: false, follow: false } };

const NODES: [string, string, number][] = [
  ['Radar finds', 'Offices by carrier, fit and market', -90],
  ['Story + calls win', 'Studio series, posts, the Call Desk', -18],
  ['Agent goes live', 'Site, profiles, approvals, billing', 54],
  ['Engine runs their marketing', 'Side B: local posts, Reels, consumer ads', 126],
  ['Results become proof', '“Main Street” episodes, case studies', 198],
];

function Wheel() {
  const cx = 280, cy = 280, R = 190;
  const pt = (deg: number, r = R) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  return (
    <svg viewBox="0 0 560 560" className="wheel" role="img" aria-label="The Genovus flywheel">
      <defs>
        <linearGradient id="fw" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ff5a20" /><stop offset="1" stopColor="#ffa31a" /></linearGradient>
        <marker id="ar" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#ffa31a" /></marker>
      </defs>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#ffffff12" strokeWidth="30" />
      <g className="spin"><circle cx={cx} cy={cy} r={R} fill="none" stroke="url(#fw)" strokeWidth="3" strokeDasharray="14 22" /></g>
      {NODES.map(([, , deg], i) => {
        const a = deg + 20, b = NODES[(i + 1) % NODES.length][2] - 20 + (i === NODES.length - 1 ? 360 : 0);
        const [x1, y1] = pt(a), [x2, y2] = pt(b);
        return <path key={i} d={`M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}`} fill="none" stroke="#ffa31a" strokeWidth="2" markerEnd="url(#ar)" opacity=".7" />;
      })}
      <circle cx={cx} cy={cy} r="92" fill="#121419" stroke="#ffffff22" />
      <text x={cx} y={cy - 12} textAnchor="middle" className="fw-c">One engine</text>
      <text x={cx} y={cy + 14} textAnchor="middle" className="fw-s">Side A: Genovus → agents</text>
      <text x={cx} y={cy + 34} textAnchor="middle" className="fw-s">Side B: agents → customers</text>
      {NODES.map(([t, d, deg], i) => {
        const [x, y] = pt(deg);
        return (
          <g key={t}>
            <circle cx={x} cy={y} r="22" fill={i === 3 ? '#3dd691' : '#ff6a2b'} />
            <text x={x} y={y + 5} textAnchor="middle" className="fw-n">{i + 1}</text>
            <text x={x} y={y + (deg > 0 && deg < 180 ? 44 : -34)} textAnchor="middle" className="fw-t">{t}</text>
            <text x={x} y={y + (deg > 0 && deg < 180 ? 60 : -18)} textAnchor="middle" className="fw-d">{d}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function Flywheel() {
  return (
    <VisionShell
      slug="flywheel"
      lede={<>Genovus wins agents with the same engine it sells them. Every client we launch runs <b>Side B</b>, their own local marketing, and their results become the proof that wins the next market. Each turn makes the next one cheaper.</>}
      spec={[
        { title: 'Side B ads (clients’ consumer marketing)', items: [
          { k: 'Meta category', v: <>Insurance ads use Meta’s “Financial products and services” category: no age or gender targeting, 15-mile minimum radius, no lookalikes. <Src href="https://www.jonloomer.com/qvt/financial-products-and-services/">details</Src></> },
          { k: 'Ownership', v: 'Each agent owns their Page, Instagram, ad account and Google profile; Genovus has partner access.' },
          { k: 'Approvals', v: 'Agent approves every public word and every dollar (Lane 3).' },
        ] },
        { title: 'Proof loop', items: [
          { k: 'Main Street', v: 'Real client stories, filmed or AI-assisted only with written consent (a platform gate).' },
          { k: 'Case studies', v: 'Leads, reviews and calls from Side B, aggregated and anonymized unless the client agrees to be named.' },
          { k: 'Tenancy', v: 'Agents act on one tenant at a time; Genovus is the house tenant for Side A.' },
        ] },
      ]}
    >
      <div className="vgrid2" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)' }}>
        <Panel tour="wheel" title="The flywheel" sub="Five steps, one engine, both sides"><Wheel /></Panel>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel tour="java" title="JAVA Agency · Side B" sub="Mendez Hollis, Columbus GA · client #1" actions={<Chip kind="sample">Sample results</Chip>}>
            <div className="grid g2">
              <Tile label="Local reach" value="9,800" hint="Last 30 days" sample />
              <Tile label="Calls from the site" value="23" hint="Tracked" sample />
              <Tile label="New reviews" value="7" hint="4.9★ average" sample />
              <Tile label="Quote clicks" value="41" hint="To his official GEICO page" sample />
            </div>
          </Panel>
          <Panel tour="proof" title="Becomes Side A proof" sub="“Main Street” · Episode 1 (with written consent)">
            <p className="soft" style={{ margin: 0, fontSize: 14 }}>“A GEICO exclusive agent in Columbus went from a carrier page to being found by his neighbors.” Shown to the next 142 Columbus offices, the next 980 in Atlanta.</p>
          </Panel>
        </div>
      </div>
    </VisionShell>
  );
}
