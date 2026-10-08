// The carrier catalog and the scanner's controls. Published counts appear only with their source; the
// "found" column is what our own scan has located so far.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { Panel, Chip, Tile } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { placesConfigured } from '@/lib/places';
import { scanSettings, monthSpendCents } from '@/lib/scanner';
import { saveCarrier, saveScanSettings, runScanNow } from '@/lib/scan-actions';

export const metadata = { title: 'Carriers & scanner' };
export const dynamic = 'force-dynamic';

export default async function Carriers() {
  const v = await requireStaff();
  const supabase = await db();
  const [{ data: carriers }, { data: found }, { data: cells }, { data: runs }, settings, spent] = await Promise.all([
    supabase.from('carriers').select('*').order('fit_score', { ascending: false }),
    supabase.from('prospects').select('carrier_id, status'),
    supabase.from('scan_cells').select('state, status'),
    supabase.from('scan_runs').select('*').order('started_at', { ascending: false }).limit(5),
    scanSettings(),
    monthSpendCents(),
  ]);
  const count = new Map<string, number>();
  for (const p of found ?? []) if (p.carrier_id) count.set(p.carrier_id, (count.get(p.carrier_id) ?? 0) + 1);
  const pending = (cells ?? []).filter((c) => c.status === 'pending').length;
  const doneCells = (cells ?? []).filter((c) => c.status !== 'pending').length;
  const admin = v.staff.role === 'admin';
  const connected = placesConfigured();
  return (
    <ConsoleShell title="Carriers & scanner" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Carriers & scanner' }]}>
      <p className="soft">Every carrier whose agents fit Genovus, and the national scan that finds their offices. Counts come from each carrier’s own documents; blank means not published or not yet confirmed.</p>
      <div className="grid g4">
        <Tile label="Offices found" value={<span className="num">{(found ?? []).length}</span>} hint={`${(found ?? []).filter((p) => p.status !== 'new').length} worked so far`} />
        <Tile label="Scan progress" value={<span className="num">{cells?.length ? Math.round((100 * doneCells) / cells.length) : 0}%</span>} hint={`${pending} areas left in ${settings.states.join(', ')}`} />
        <Tile label="Spent this month" value={`$${(spent / 100).toFixed(2)}`} hint={`of $${(settings.budgetCents / 100).toFixed(0)} budget (estimate)`} />
        <Tile label="Carriers scanned" value={<span className="num">{(carriers ?? []).filter((c) => c.scan_enabled).length}</span>} hint={`of ${(carriers ?? []).length} in the catalog`} />
      </div>

      {!connected ? <div className="notice">Google Places is not connected yet. Add <code>GOOGLE_PLACES_API_KEY</code> in Vercel (Production), then switch carriers on below and run the first scan.</div> : null}

      <Panel title="Carrier catalog" sub="Switch a carrier on to include it in the scan; the fit score ranks its offices">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Carrier</th><th>Model</th><th>Published count</th><th>Found</th><th>Fit</th><th>Scan</th></tr></thead>
            <tbody>
              {(carriers ?? []).map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b><div className="muted" style={{ fontSize: 12 }}>{c.fit_reasons.slice(0, 2).join(' · ')}</div></td>
                  <td>{c.model}</td>
                  <td>
                    {c.agent_count ? <><span className="num">{c.agent_count.toLocaleString('en-US')}</span> <span className="muted" style={{ fontSize: 12 }}>{c.count_label}</span></> : <span className="muted">Not published</span>}
                    <div style={{ fontSize: 12 }}>
                      {c.source_url ? <a href={c.source_url} target="_blank" rel="noreferrer">source</a> : null}{c.as_of ? ` · as of ${c.as_of}` : ''}{' '}
                      <Chip kind={c.verified ? 'done' : 'pending'}>{c.verified ? 'Verified' : 'To confirm'}</Chip>
                    </div>
                  </td>
                  <td><Link href={`/console/prospects?carrier=${c.slug}`} className="num">{(count.get(c.id) ?? 0).toLocaleString('en-US')}</Link></td>
                  <td colSpan={2}>
                    <ActionForm action={saveCarrier} className="row" style={{ flexWrap: 'nowrap' }}>
                      <input type="hidden" name="slug" value={c.slug} />
                      <input className="input" name="fit" type="number" min={0} max={100} defaultValue={c.fit_score} style={{ width: 72 }} aria-label={`${c.name} fit score`} />
                      <label className="check" style={{ alignItems: 'center' }}><input type="checkbox" name="scan" defaultChecked={c.scan_enabled} /> Scan</label>
                      <button className="btn small" type="submit">Save</button>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="Scan settings" sub="Pilot states first; the scan stops on its own at the monthly budget">
          {admin ? (
            <ActionForm action={saveScanSettings} className="form">
              <label className="field"><span>States to scan</span><input className="input" name="states" defaultValue={settings.states.join(', ')} /></label>
              <label className="field"><span>Monthly budget (USD, Google list prices)</span><input className="input" name="budget" type="number" min={0} max={5000} defaultValue={settings.budgetCents / 100} /></label>
              <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Save settings</button>
            </ActionForm>
          ) : <p className="muted">Scanning {settings.states.join(', ')} · ${settings.budgetCents / 100}/month. An admin can change this.</p>}
        </Panel>
        <Panel title="Recent scans" sub="Runs every 10 minutes while areas are left; or run a slice now">
          {admin ? (
            <ActionForm action={runScanNow} className="row">
              <button className="btn primary small" type="submit" disabled={!connected}>Run a scan slice now</button>
            </ActionForm>
          ) : null}
          <ul className="list">
            {(runs ?? []).map((r) => (
              <li key={r.id} style={{ fontSize: 13 }}>
                <div className="spread"><span>{new Date(r.started_at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })}</span><Chip kind={r.status === 'error' ? 'bad' : r.status === 'budget' ? 'pending' : 'done'}>{r.status}</Chip></div>
                <span className="muted">{r.found_new} new · {r.requests} searches · ~${(r.est_cost_cents / 100).toFixed(2)}{r.note ? ` · ${r.note}` : ''}</span>
              </li>
            ))}
            {!runs?.length ? <li className="muted">No scans yet.</li> : null}
          </ul>
        </Panel>
      </div>
    </ConsoleShell>
  );
}
