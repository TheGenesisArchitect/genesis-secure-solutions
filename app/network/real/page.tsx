// The real network (team only): every office the scanner has found, by carrier and state, against each
// carrier's published count, with our funnel and a forecast priced from real rates. Prospect data is
// row-level-secured to staff, so carrier partners never see it.
import Link from 'next/link';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { STATE_NAME } from '@/lib/us-map';
import { Shell } from '@/components/Shell';
import { EcosystemSwitcher } from '@/components/EcosystemSwitcher';
import { NetworkForecast } from '@/components/NetworkForecast';
import { StateMap } from '@/components/StateMap';
import { Panel, Tile, Chip, Bar, Empty } from '@/components/ui';
import { STATUS_LABEL } from '@/lib/prospects';
import { scanSettings } from '@/lib/scanner';

export const metadata = { title: 'Real network' };
export const dynamic = 'force-dynamic';

type SP = { carrier?: string; segment?: string; state?: string };
const FUNNEL = ['new', 'verified', 'contacting', 'replied', 'consult', 'proposal', 'won'];
const TALKING = ['contacting', 'replied', 'consult', 'proposal'];

export default async function RealNetwork({ searchParams }: { searchParams: Promise<SP> }) {
  const v = await requireStaff();
  const sp = await searchParams;
  const supabase = await db();
  const [{ data: carriers }, { data: nets }, settings, { data: cells }] = await Promise.all([
    supabase.from('carriers').select('id, slug, name, agent_count, count_label, verified, model').order('fit_score', { ascending: false }),
    supabase.from('networks').select('slug, name').order('name'),
    scanSettings(),
    supabase.rpc('scan_cell_counts'),
  ]);
  const carrier = carriers?.find((c) => c.slug === sp.carrier);
  // Counts by carrier, state, status and segment from one aggregate (no row limits at national scale).
  const { data: agg } = await supabase.rpc('prospect_counts');
  type G = { carrier_id: string | null; segment: string; state: string | null; status: string; n: number };
  const all = ((agg ?? []) as G[]).filter((g) => g.status !== 'closed');
  const groups = all.filter((p) => (!carrier || p.carrier_id === carrier.id) && (!sp.segment || p.segment === sp.segment) && (!sp.state || p.state === sp.state));
  const total = (pred: (g: G) => boolean) => groups.filter(pred).reduce((a, g) => a + Number(g.n), 0);
  const perState = new Map<string, number>(), talking = new Map<string, number>();
  for (const g of groups) {
    if (!g.state) continue;
    perState.set(g.state, (perState.get(g.state) ?? 0) + Number(g.n));
    if (TALKING.includes(g.status)) talking.set(g.state, (talking.get(g.state) ?? 0) + Number(g.n));
  }
  const byCarrier = (carriers ?? []).map((c) => ({ c, n: total((g) => g.carrier_id === c.id) })).filter((x) => x.n || x.c.agent_count);
  const maxC = Math.max(1, ...byCarrier.map((x) => x.n));
  const funnel = FUNNEL.map((s) => ({ s, n: total((g) => FUNNEL.indexOf(g.status) >= FUNNEL.indexOf(s)) }));
  const cellRows = (cells ?? []) as { status: string; n: number; last_scanned: string | null }[];
  const lastScan = cellRows.map((c) => c.last_scanned).filter(Boolean).sort().pop();
  const totalCells = cellRows.reduce((a, c) => a + Number(c.n), 0);
  const doneCells = totalCells - cellRows.filter((c) => c.status === 'pending').reduce((a, c) => a + Number(c.n), 0);
  const found = total(() => true);
  const link = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries({ ...sp, ...patch })) if (val) p.set(k, String(val));
    return `/network/real${p.size ? `?${p}` : ''}`;
  };
  return (
    <Shell
      searchClients
      surface="Network"
      home="/network"
      title="Real network"
      who={{ name: v.staff.name, detail: 'Genovus team' }}
      switcher={<EcosystemSwitcher current="carrier" />}
      back={{ href: '/console', label: 'Enterprise' }}
      nav={[
        { title: 'Real data', items: [{ href: '/network/real', label: 'Real network', exact: true, icon: 'target' }, { href: '/console/prospects', label: 'Prospects', icon: 'clients' }, { href: '/console/carriers', label: 'Carriers & scanner', icon: 'carriers' }] },
        { title: 'Scenarios', items: (nets ?? []).map((n) => ({ href: `/network?n=${n.slug}`, label: n.name.replace(' (scenario)', ''), exact: true })) },
      ]}
    >
      <div className="notice">Real offices found by the Genovus scanner in {settings.states.join(', ')} ({totalCells ? Math.round((100 * doneCells) / totalCells) : 0}% scanned{lastScan ? `, last ${new Date(lastScan).toLocaleDateString('en-US')}` : ''}). Team only: carrier partners never see this view.</div>
      <form className="row" action="/network/real">
        <select className="select" style={{ width: "auto", minWidth: 170 }} name="carrier" defaultValue={sp.carrier ?? ''} aria-label="Carrier"><option value="">All carriers</option>{(carriers ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
        <select className="select" style={{ width: "auto", minWidth: 170 }} name="segment" defaultValue={sp.segment ?? ''} aria-label="Segment"><option value="">Captive + independent</option><option value="captive">Captive / exclusive</option><option value="independent">Independent</option></select>
        {sp.state ? <input type="hidden" name="state" value={sp.state} /> : null}
        <button className="btn" type="submit">Apply</button>
        {sp.state ? <Link className="btn ghost small" href={link({ state: undefined })}>Clear {STATE_NAME[sp.state] ?? sp.state}</Link> : null}
      </form>
      <div className="grid g4">
        <Tile label="Offices found" value={<span className="num">{found.toLocaleString('en-US')}</span>} hint={`${perState.size} states`} />
        <Tile label="Captive / exclusive" value={<span className="num">{total((g) => g.segment === 'captive').toLocaleString('en-US')}</span>} hint={`${total((g) => g.segment === 'independent').toLocaleString('en-US')} independent`} />
        <Tile label="In conversation" value={<span className="num">{total((g) => TALKING.includes(g.status))}</span>} hint="Contacting to proposal" />
        <Tile label="Won" value={<span className="num">{total((g) => g.status === 'won')}</span>} hint="Became clients" />
      </div>
      {found ? (
        <>
          <div className="grid net-top">
            <Panel title="Offices by state" sub={sp.state ? `Showing ${STATE_NAME[sp.state]}. Click it again to clear.` : 'Click a state to filter; dots = offices in conversation'}>
              <StateMap values={perState} dots={talking} selected={sp.state} href={(abbr) => link({ state: abbr })} unit="offices" />
            </Panel>
            <Panel title="By carrier" sub="Found by our scan vs. the carrier’s published count (nationwide)">
              <ul className="list">
                {byCarrier.map(({ c, n }) => (
                  <li key={c.id} style={{ gap: 4 }}>
                    <div className="spread"><Link href={link({ carrier: c.slug })}><b>{c.name}</b></Link><span className="num">{n.toLocaleString('en-US')}</span></div>
                    <Bar value={n} total={maxC} />
                    <span className="muted" style={{ fontSize: 12 }}>{c.agent_count ? `${c.agent_count.toLocaleString('en-US')} ${c.count_label} published nationwide${c.verified ? '' : ' (to confirm)'}` : 'No published count'}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
          <Panel title="Funnel" sub="Offices at or past each step">
            <div className="row" style={{ gap: 10, alignItems: 'stretch' }}>
              {funnel.map((f, i) => (
                <div key={f.s} className="tile" style={{ flex: 1, minWidth: 110 }}>
                  <span className="muted" style={{ font: '500 10.5px var(--mono)', letterSpacing: '.14em', textTransform: 'uppercase' }}>{STATUS_LABEL[f.s]}</span>
                  <b className="num" style={{ fontSize: 22 }}>{f.n.toLocaleString('en-US')}</b>
                  {i ? <span className="muted" style={{ fontSize: 12 }}>{funnel[i - 1].n ? Math.round((100 * f.n) / funnel[i - 1].n) : 0}% of previous</span> : <span className="muted" style={{ fontSize: 12 }}>found</span>}
                </div>
              ))}
            </div>
          </Panel>
          <NetworkForecast offices={groups.flatMap((g) => Array.from({ length: Number(g.n) }, () => ({ stage: g.status === 'won' ? 'care' : 'attract', plan: null })))} sample={false} />
        </>
      ) : <Empty title="No offices found yet">Connect Google Places and run the first scan from Carriers & scanner.</Empty>}
      <p className="muted" style={{ fontSize: 12 }}>Counts are of offices our scan found through Google Maps Platform, grouped by the state we searched. <Chip kind="dev">Projection</Chip> rows above are estimates from published rates.</p>
    </Shell>
  );
}
