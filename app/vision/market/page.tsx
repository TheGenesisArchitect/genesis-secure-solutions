import Link from 'next/link';
import { VisionShell, Src } from '@/components/vision/VisionShell';
import { Panel, Tile, Chip } from '@/components/ui';
import { COLUMBUS, MARKETS } from '@/data/vision';

export const metadata = { title: 'Market brief · Growth Engine vision', robots: { index: false, follow: false } };

// A deterministic scatter of offices around the market center (Sample), colored by fit band.
function MarketRadar() {
  const pts = Array.from({ length: 142 }, (_, i) => {
    const a = (i * 137.508 * Math.PI) / 180, r = 18 + 150 * Math.sqrt(((i * 7919) % 142) / 142);
    const fit = 95 - ((i * 31) % 40);
    return { x: 200 + r * Math.cos(a), y: 190 + r * Math.sin(a) * 0.85, fit };
  });
  const col = (f: number) => (f >= 90 ? '#3dd691' : f >= 80 ? '#6aa8ff' : f >= 70 ? '#ffb020' : '#8b909a');
  return (
    <svg viewBox="0 0 400 380" className="mradar" role="img" aria-label="Offices around Columbus by fit">
      <defs><radialGradient id="mr"><stop offset="0" stopColor="#ff6a2b" stopOpacity=".18" /><stop offset="1" stopColor="#ff6a2b" stopOpacity="0" /></radialGradient></defs>
      <circle cx="200" cy="190" r="175" fill="url(#mr)" />
      {[60, 115, 170].map((r, k) => <circle key={r} cx="200" cy="190" r={r} fill="none" stroke="#ffffff1a" strokeDasharray="3 5"><title>{['5 mi', '10 mi', '15 mi'][k]}</title></circle>)}
      {[['5 mi', 60], ['10 mi', 115], ['15 mi', 170]].map(([l, r]) => <text key={String(l)} x={200} y={190 - Number(r) * 0.85 - 4} className="mr-l" textAnchor="middle">{l}</text>)}
      {pts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3.2" fill={col(p.fit)} opacity=".9" className="mr-dot" style={{ animationDelay: `${(i % 30) * 40}ms` }} />)}
      <circle cx="200" cy="190" r="7" fill="#fff" /><text x="212" y="176" className="mr-c">Columbus, GA</text>
    </svg>
  );
}

export default function MarketBrief() {
  const m = MARKETS.find((x) => x.slug === 'columbus-ga')!;
  const total = COLUMBUS.carriers.reduce((a, c) => a + c.n, 0);
  const max = Math.max(...COLUMBUS.carriers.map((c) => c.n));
  const adoption = 0.15, clients = Math.round(m.offices * adoption);
  return (
    <VisionShell
      slug="market"
      lede={<>Every market gets a <b>brief</b> before anyone spends a dollar or makes a call: who is there, how well they fit, what the market searches for, and what winning it is worth against what it costs.</>}
      spec={[
        { title: 'Data', items: [
          { k: 'Offices', v: 'Scanner prospects in the market, grouped by carrier and segment (prospect_counts).' },
          { k: 'No own site', v: 'Live website check on screen (never stored): carrier page or none vs own domain.' },
          { k: 'Search demand', v: <>Google Ads Keyword Planner (historical metrics). <Src href="https://developers.google.com/google-ads/api/docs/keyword-planning/overview">docs</Src></> },
          { k: 'Competitor ads', v: <>Meta Ad Library API, read-only. <Src href="https://www.facebook.com/ads/library/api">docs</Src></> },
        ] },
        { title: 'Model', items: [
          { k: 'Market', v: <><code>markets</code> (slug, name, center, radius, state) + <code>market_id</code> on prospects.</> },
          { k: 'Potential', v: 'Offices × expected adoption × plan prices from data/offers.ts (labeled Projection).' },
          { k: 'Cost', v: 'Expenses tagged to the market + Google usage + team hours.' },
        ] },
        { title: 'Agent', items: [
          { k: 'Radar → Analyst', v: 'Drafts the brief and a recommended mission; a person accepts it into Mission Control.' },
        ] },
      ]}
    >
      <div className="grid g4">
        <Tile label="Offices" value={<span className="num">{m.offices}</span>} hint={`${m.captive} captive / exclusive`} sample />
        <Tile label="No site of their own" value={`${COLUMBUS.noOwnSite}%`} hint="Only a carrier page, or nothing" sample />
        <Tile label="Local searches / month" value={<span className="num">{COLUMBUS.searches.toLocaleString('en-US')}</span>} hint="Insurance terms in the radius" sample />
        <Tile label="Agencies running ads" value={<span className="num">{COLUMBUS.competitorAds}</span>} hint="From the Meta Ad Library" sample />
      </div>
      <div className="vgrid2">
        <Panel title="Offices around Columbus" sub="Each dot an office, colored by fit · 15-mile radius" actions={<Chip kind="sample">Sample</Chip>}>
          <MarketRadar />
          <div className="vlegend"><span><i style={{ background: '#3dd691' }} />90+</span><span><i style={{ background: '#6aa8ff' }} />80–89</span><span><i style={{ background: '#ffb020' }} />70–79</span><span><i style={{ background: '#8b909a' }} />under 70</span></div>
        </Panel>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Who is in the market" sub={`${total} offices by carrier`} actions={<Chip kind="sample">Sample</Chip>}>
            <div style={{ display: 'grid', gap: 8 }}>
              {COLUMBUS.carriers.map((c, i) => (
                <div key={c.name} className="vbar"><span>{c.name}</span><span className="track"><span className="fill" style={{ width: `${(100 * c.n) / max}%`, animationDelay: `${i * 60}ms`, display: 'block' }} /></span><b className="num">{c.n}</b></div>
              ))}
            </div>
          </Panel>
          <Panel title="What winning it is worth" sub="15% adoption, Launch pricing" actions={<Chip kind="dev">Projection</Chip>}>
            <dl className="kv lines">
              <dt>New clients</dt><dd>{clients}</dd>
              <dt>Setup revenue</dt><dd>${(clients * 1500).toLocaleString('en-US')}</dd>
              <dt>Monthly care</dt><dd>${(clients * 249).toLocaleString('en-US')}/mo</dd>
              <dt>Cost to win (organic + calls)</dt><dd>~$120/mo data + 2 callers × 4 hrs/wk</dd>
            </dl>
            <Link className="btn primary" href="/vision/mission" style={{ justifySelf: 'start' }}>Launch this market as a Mission →</Link>
          </Panel>
        </div>
      </div>
    </VisionShell>
  );
}
