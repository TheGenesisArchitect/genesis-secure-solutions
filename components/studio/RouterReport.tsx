// The Router report: the Studio's five Runway Model Routers (which job each serves, how it's tuned in Runway),
// what each recently picked and why (Runway's routing history), and how those picks performed for us (render
// time, failures, cost), so allowlists are tuned from measured results. Router names are editable here.
import { ActionForm } from '@/components/ActionForm';
import { studioSetRouters } from '@/lib/actions';

export type RouterRow = {
  key: string; job: string; slug: string;
  found: boolean; optimizeFor?: string | null; models?: string[] | null; capacityFallback?: boolean | null;
  picks: { model: string; n: number }[]; recent: number; refused: number; reasons: string[];
  measured: { model: string; renders: number; avgSecs: number | null; failRate: number; avgCents: number | null }[];
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
export function RouterReport({ rows, connected }: { rows: RouterRow[]; connected: boolean }) {
  return (
    <div className="pb-panel">
      <div className="pb-lab"><b>Runway routers</b><span>{connected ? 'Live from Runway' : 'Runway not reachable here'}</span></div>
      <div className="rr-grid">
        {rows.map((r) => (
          <div key={r.key} className={'rr-card' + (connected && !r.found ? ' missing' : '')}>
            <span className="rr-job">{r.job}</span>
            <b className="rr-slug">{r.slug}</b>
            {connected && !r.found ? <small className="rr-warn">Not found in Runway: check the name (renders fall back to the shot’s own engine).</small> : null}
            {r.found ? <small className="rr-tune">{r.optimizeFor ? `Optimizes for ${r.optimizeFor}` : 'Default tuning'}{r.capacityFallback ? ' · skips busy models' : ''}{r.models?.length ? ` · ${r.models.length} models allowed` : ''}</small> : null}
            {r.picks.length ? <span className="rr-picks">{r.picks.map((p) => <i key={p.model}>{p.model} ×{p.n}</i>)}</span> : <small className="muted">No routed renders yet.</small>}
            {r.refused ? <small className="rr-warn">{r.refused} of {r.recent} recent requests found no eligible model{r.reasons[0] ? `: ${r.reasons[0]}` : ''}.</small> : null}
            {r.measured.length ? (
              <table className="rr-table"><tbody>
                {r.measured.map((m) => <tr key={m.model}><td>{m.model}</td><td>{m.renders} renders</td><td>{m.avgSecs != null ? `${Math.round(m.avgSecs)}s avg` : '—'}</td><td>{pct(m.failRate)} failed</td><td>{m.avgCents != null ? `$${(m.avgCents / 100).toFixed(2)}` : '—'}</td></tr>)}
              </tbody></table>
            ) : null}
          </div>
        ))}
      </div>
      <details className="pb-more">
        <summary>Change router names</summary>
        <ActionForm action={studioSetRouters} className="form rr-form">
          {rows.map((r) => <label key={r.key} className="field"><span>{r.job}</span><input className="input" name={r.key} defaultValue={r.slug} pattern="[a-z0-9][a-z0-9-]{1,62}" /></label>)}
          <button className="btn small" type="submit" style={{ justifySelf: 'start' }}>Save routers</button>
        </ActionForm>
      </details>
    </div>
  );
}
