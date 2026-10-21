'use client';
// The Competitor Radar's working board: every office the sweep mapped, filtered on screen by radius (up to what was
// swept), carrier and ZIP, at no cost. The radar draws distance on a square-root scale so near offices keep room;
// the table and the by-carrier benchmark follow the same filters. Saved views keep a radius, carriers and ZIPs.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveRadarView, deleteRadarView } from '@/lib/growth-actions';
import { sweepEstimate } from '@/lib/radar-estimate';

export type RadarOffice = { id: string; placeId: string; carrier: string; segment: 'captive' | 'independent'; miles: number; bearing: number; name: string | null; rating: number | null; reviews: number; zip: string | null; website: string | null; mapsUrl: string | null };
export type RadarView = { id: string; name: string; radius_mi: number; carriers: string[]; zips: string[] };
type Own = { name: string; rating: number | null; reviews: number; carrier: string } | null;

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const host = (url: string | null) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : null; } catch { return null; } };
const C = 200, R = 176;

export function RadarBoard({ tenantId, offices, swept, own, views, unnamed }: { tenantId: string; offices: RadarOffice[]; swept: number; own: Own; views: RadarView[]; unnamed: number }) {
  const router = useRouter();
  const [radius, setRadius] = useState(swept);
  const [carriers, setCarriers] = useState<Set<string>>(new Set());
  const [zips, setZips] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const [viewName, setViewName] = useState('');
  const [busy, setBusy] = useState(false);

  const allCarriers = useMemo(() => [...new Set(offices.map((o) => o.carrier))].sort((a, b) => offices.filter((o) => o.carrier === b).length - offices.filter((o) => o.carrier === a).length), [offices]);
  const allZips = useMemo(() => [...new Set(offices.map((o) => o.zip).filter(Boolean) as string[])].sort(), [offices]);
  const list = offices.filter((o) => o.miles <= radius && (!carriers.size || carriers.has(o.carrier)) && (!zips.size || (o.zip && zips.has(o.zip))));
  const sel = list.find((o) => o.id === picked) ?? null;
  const rated = list.filter((o) => o.rating != null);
  const med = median(rated.map((o) => o.rating!));
  const bench = [...new Set(list.map((o) => o.carrier))].map((c) => { const g = list.filter((o) => o.carrier === c), r = g.filter((o) => o.rating != null); return { c, n: g.length, s: r.length ? r.reduce((a, o) => a + o.rating!, 0) / r.length : null, rv: g.length ? Math.round(g.reduce((a, o) => a + o.reviews, 0) / g.length) : 0 }; }).sort((a, b) => b.n - a.n);
  const toggle = (set: Set<string>, v: string, put: (s: Set<string>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); put(n); };
  const rad = (mi: number) => R * Math.sqrt(Math.min(mi, radius) / Math.max(radius, 1));
  const rings = [1, 3, 5, 10, 15, 25].filter((m) => m < radius).concat([radius]);
  const maxRev = Math.max(1, ...list.map((o) => o.reviews));
  const wider = sweepEstimate(Math.min(25, swept + 5));

  return (
    <div className="radar-board">
      <section className="panel radar-controls" aria-label="Customize the radar">
        <div className="radar-ctl-row">
          <label className="radar-ctl">
            <span className="radar-label">Radius <b>{radius} mi</b></span>
            <input type="range" min={1} max={swept} step={1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Radius in miles" />
            <span className="muted" style={{ fontSize: 12 }}>Mapped out to {swept} mi; narrowing is free. Going wider is a new Google search (about ${(wider.cents / 100).toFixed(2)} for {Math.min(25, swept + 5)} mi): ask the Genovus team.</span>
          </label>
          <div className="radar-ctl">
            <span className="radar-label">Saved views</span>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <select className="select" style={{ width: 'auto', minWidth: 0, flex: 1 }} aria-label="Saved views" value="" onChange={(e) => { const v = views.find((x) => x.id === e.target.value); if (!v) return; setRadius(Math.min(swept, v.radius_mi)); setCarriers(new Set(v.carriers)); setZips(new Set(v.zips)); }}>
                <option value="">{views.length ? 'Open a saved view…' : 'No saved views yet'}</option>
                {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>
            <form className="row" style={{ gap: 6, flexWrap: 'nowrap' }} onSubmit={async (e) => { e.preventDefault(); if (!viewName.trim()) return; setBusy(true); toast(await saveRadarView(tenantId, { name: viewName.trim(), radius, carriers: [...carriers], zips: [...zips] })); setBusy(false); setViewName(''); router.refresh(); }}>
              <input className="input" value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="Name this view" maxLength={80} aria-label="Name for this view" style={{ flex: 1, minWidth: 0 }} />
              <button className="btn small" type="submit" disabled={busy || !viewName.trim()}>Save view</button>
            </form>
          </div>
        </div>
        <div className="radar-ctl"><span className="radar-label">Carriers</span>
          <div className="pill-row" role="group" aria-label="Filter by carrier">
            <button type="button" className="radar-chip" aria-pressed={!carriers.size} onClick={() => setCarriers(new Set())}>All</button>
            {allCarriers.map((c) => <button key={c} type="button" className="radar-chip" aria-pressed={carriers.has(c)} onClick={() => toggle(carriers, c, setCarriers)}>{c}<span>{offices.filter((o) => o.carrier === c && o.miles <= radius).length}</span></button>)}
          </div>
        </div>
        {allZips.length ? <div className="radar-ctl"><span className="radar-label">ZIP codes</span>
          <div className="pill-row" role="group" aria-label="Filter by ZIP code">
            <button type="button" className="radar-chip" aria-pressed={!zips.size} onClick={() => setZips(new Set())}>All</button>
            {allZips.map((z) => <button key={z} type="button" className="radar-chip" aria-pressed={zips.has(z)} onClick={() => toggle(zips, z, setZips)}>{z}<span>{offices.filter((o) => o.zip === z && o.miles <= radius).length}</span></button>)}
          </div>
        </div> : null}
        {views.length ? <div className="pill-row">{views.map((v) => <span key={v.id} className="chip">{v.name} <button type="button" className="radar-x" aria-label={`Delete ${v.name}`} onClick={async () => { toast(await deleteRadarView(v.id)); router.refresh(); }}>×</button></span>)}</div> : null}
      </section>

      <div className="radar-grid">
        <section className="panel">
          <h2 className="radar-h">{list.length} office{list.length === 1 ? '' : 's'} within {radius} mi{carriers.size ? ` · ${[...carriers].join(', ')}` : ''}{zips.size ? ` · ${[...zips].join(', ')}` : ''}</h2>
          <svg viewBox="0 0 400 400" className="radar-svg" role="img" aria-label={`Radar of ${list.length} insurance offices around your office`}>
            {rings.map((mi) => <g key={mi}><circle cx={C} cy={C} r={rad(mi)} fill="none" stroke="currentColor" strokeOpacity={0.12} strokeDasharray={mi === radius ? undefined : '3 4'} /><text x={C + 4} y={C - rad(mi) - 4} className="radar-tick">{mi} mi</text></g>)}
            <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="currentColor" strokeOpacity={0.06} /><line x1={C - R} y1={C} x2={C + R} y2={C} stroke="currentColor" strokeOpacity={0.06} />
            <text x={C - 4} y={14} className="radar-tick" textAnchor="middle">N</text>
            {list.map((o) => {
              const a = ((o.bearing - 90) * Math.PI) / 180, x = C + rad(o.miles) * Math.cos(a), y = C + rad(o.miles) * Math.sin(a), size = 4 + Math.sqrt(o.reviews) / 2.6;
              return <circle key={o.id} cx={x} cy={y} r={size} className={`radar-dot ${o.segment}${o.id === picked ? ' on' : ''}`} tabIndex={0} role="button" aria-label={`${o.name ?? o.carrier}, ${o.miles} miles`} onClick={() => setPicked(o.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPicked(o.id); } }} />;
            })}
            <circle cx={C} cy={C} r={8} className="radar-you" />
          </svg>
          <div className="radar-legend"><span><i className="you" />You</span><span><i className="captive" />Captive office</span><span><i className="independent" />Independent agency</span><span>Bigger dot = more Google reviews</span></div>
        </section>

        <section className="panel" style={{ minWidth: 0 }}>
          <h2 className="radar-h">How you compare</h2>
          {sel ? (
            <div className="radar-card">
              <span className="radar-label">{sel.carrier} · {sel.miles} mi{sel.zip ? ` · ZIP ${sel.zip}` : ''}</span>
              <b style={{ fontSize: 16 }}>{sel.name ?? 'Name unavailable right now'}</b>
              <span className="muted" style={{ fontSize: 13 }}>{sel.rating != null ? `${sel.rating.toFixed(1)} stars · ${sel.reviews} reviews` : 'No rating yet'}{own?.rating != null && sel.rating != null ? ` (you: ${own.rating.toFixed(1)} · ${own.reviews})` : ''}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <a className="btn small" target="_blank" rel="noreferrer" href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&q=${encodeURIComponent(sel.name ?? sel.carrier)}`}>Their Facebook and Instagram ads</a>
                <a className="btn small" target="_blank" rel="noreferrer" href={host(sel.website) ? `https://adstransparency.google.com/?region=US&domain=${encodeURIComponent(host(sel.website)!)}` : 'https://adstransparency.google.com/?region=US'}>Their Google ads</a>
                {sel.mapsUrl ? <a className="btn small ghost" target="_blank" rel="noreferrer" href={sel.mapsUrl}>On Google Maps</a> : null}
              </div>
            </div>
          ) : <p className="muted" style={{ margin: 0, fontSize: 13 }}>Tap an office on the radar or in the list to see its rating and open its ads.</p>}
          <div className="radar-scroll">
            <table className="t radar-table">
              <thead><tr><th>Office</th><th>ZIP</th><th className="num">Mi</th><th className="num">Stars</th><th>Reviews</th></tr></thead>
              <tbody>
                {own ? <tr className="radar-own"><td><b>{own.name}</b><div className="muted">{own.carrier} · you</div></td><td /><td className="num">0</td><td className="num">{own.rating?.toFixed(1) ?? '–'}</td><td><div className="radar-bar you"><span style={{ width: `${Math.min(100, (own.reviews / maxRev) * 100)}%` }} /></div><span className="num">{own.reviews}</span></td></tr> : null}
                {[...list].sort((a, b) => a.miles - b.miles).map((o) => (
                  <tr key={o.id} className={o.id === picked ? 'radar-sel' : undefined} onClick={() => setPicked(o.id)} style={{ cursor: 'pointer' }}>
                    <td><b>{o.name ?? 'Unnamed office'}</b><div className="muted">{o.carrier}</div></td>
                    <td>{o.zip ?? ''}</td><td className="num">{o.miles}</td><td className="num">{o.rating?.toFixed(1) ?? '–'}</td>
                    <td><div className="radar-bar"><span style={{ width: `${Math.min(100, (o.reviews / maxRev) * 100)}%` }} /></div><span className="num">{o.reviews}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {unnamed ? <p className="muted" style={{ margin: 0, fontSize: 12 }}>{unnamed} more offices farther out are mapped but not named here (Google lookups are limited to the nearest 60 per visit). Narrow the view to see them.</p> : null}
        </section>
      </div>

      <section className="panel">
        <h2 className="radar-h">By carrier, in this view</h2>
        <div className="radar-bench">
          {bench.map((g) => <div key={g.c}><span>{g.c} <span className="muted">· {g.n} office{g.n === 1 ? '' : 's'}</span></span><span className="num">{g.s != null ? `${g.s.toFixed(1)} stars` : '–'} · {g.rv} reviews avg</span></div>)}
          {own ? <div className="you"><span>{own.name} (you)</span><span className="num">{own.rating?.toFixed(1) ?? '–'} stars · {own.reviews} reviews</span></div> : null}
        </div>
        {med != null ? <p className="muted" style={{ margin: 0, fontSize: 13 }}>Median rating in this view: {med.toFixed(1)} stars{own?.rating != null ? `; you’re at ${own.rating.toFixed(1)}` : ''}.</p> : null}
      </section>
    </div>
  );
}
