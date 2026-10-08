// Prospects found by the scanner. Names and addresses come live from Google for the rows on screen (never
// stored); everything else is our own data.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel, Chip, Empty, Tile } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { getSummary, placesConfigured, GOOGLE_ATTRIBUTION } from '@/lib/places';
import { STATUS_LABEL, OPEN_STATUSES } from '@/lib/prospects';

export const metadata = { title: 'Prospects' };
export const dynamic = 'force-dynamic';
const PAGE = 25;

type SP = { carrier?: string; segment?: string; state?: string; status?: string; page?: string };

export default async function Prospects({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaff();
  const sp = await searchParams;
  const supabase = await db();
  const { data: carriers } = await supabase.from('carriers').select('id, slug, name').order('name');
  const carrier = carriers?.find((c) => c.slug === sp.carrier);
  const page = Math.max(1, Number(sp.page) || 1);

  let q = supabase.from('prospects').select('id, code, place_id, carrier_id, segment, state, status, fit_score, contact_name, next_action_at', { count: 'exact' });
  if (carrier) q = q.eq('carrier_id', carrier.id);
  if (sp.segment === 'captive' || sp.segment === 'independent') q = q.eq('segment', sp.segment);
  if (sp.state && /^[A-Z]{2}$/.test(sp.state)) q = q.eq('state', sp.state);
  if (sp.status && STATUS_LABEL[sp.status]) q = q.eq('status', sp.status);
  else q = q.in('status', OPEN_STATUSES);
  const { data: rows, count } = await q.order('fit_score', { ascending: false }).order('first_seen').range((page - 1) * PAGE, page * PAGE - 1);
  const live = placesConfigured();
  const names = live ? await Promise.all((rows ?? []).map((r) => getSummary(r.place_id))) : [];
  const cname = new Map((carriers ?? []).map((c) => [c.id, c.name]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const link = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, String(v));
    return `/console/prospects${p.size ? `?${p}` : ''}`;
  };
  return (
    <ConsoleShell title="Prospects" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Prospects' }]}
      actions={<Link className="btn small primary" href="/console/prospects/calls">Call list</Link>}>
      <div className="grid g4">
        <Tile label="Matching" value={<span className="num">{count ?? 0}</span>} hint={sp.status ? STATUS_LABEL[sp.status] : 'Open prospects'} />
      </div>
      <form className="row" role="search" action="/console/prospects">
        <select className="select" style={{ width: "auto", minWidth: 170 }} name="carrier" defaultValue={sp.carrier ?? ''} aria-label="Carrier"><option value="">All carriers</option>{(carriers ?? []).map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select>
        <select className="select" style={{ width: "auto", minWidth: 170 }} name="segment" defaultValue={sp.segment ?? ''} aria-label="Segment"><option value="">Captive + independent</option><option value="captive">Captive / exclusive</option><option value="independent">Independent</option></select>
        <input className="input" name="state" defaultValue={sp.state ?? ''} placeholder="State (GA)" maxLength={2} style={{ width: 110, textTransform: 'uppercase' }} aria-label="State" />
        <select className="select" style={{ width: "auto", minWidth: 170 }} name="status" defaultValue={sp.status ?? ''} aria-label="Status"><option value="">Open</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <button className="btn" type="submit">Filter</button>
      </form>
      <Panel title="Offices" sub={live ? 'Names and addresses load live from Google for this page only' : 'Connect Google Places to see names and addresses'}>
        {rows?.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Office</th><th>Carrier</th><th>State</th><th>Status</th><th>Fit</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td><Link href={`/console/prospects/${r.code}`}>{names[i]?.name || r.contact_name || `Office ${r.code}`}</Link><div className="muted" style={{ fontSize: 12 }}>{names[i]?.address ?? ''}</div></td>
                    <td>{r.carrier_id ? cname.get(r.carrier_id) : 'Independent'}</td>
                    <td>{r.state ?? '—'}</td>
                    <td><Chip kind={r.status === 'new' ? 'pending' : r.status === 'replied' || r.status === 'consult' ? 'live' : 'info'}>{STATUS_LABEL[r.status]}</Chip></td>
                    <td className="num">{r.fit_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No prospects match">Run the scanner from Carriers & scanner, or widen the filters.</Empty>}
        {pages > 1 ? (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {page > 1 ? <Link className="btn small" href={link({ page: String(page - 1) })}>Previous</Link> : <span />}
            <span className="muted" style={{ fontSize: 13 }}>Page {page} of {pages}</span>
            {page < pages ? <Link className="btn small" href={link({ page: String(page + 1) })}>Next</Link> : <span />}
          </div>
        ) : null}
        {live ? <p className="muted" style={{ fontSize: 12, margin: 0 }}>{GOOGLE_ATTRIBUTION}</p> : null}
      </Panel>
    </ConsoleShell>
  );
}
