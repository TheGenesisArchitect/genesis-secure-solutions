'use client';
// Enterprise controls for an agency's Growth Engine: the agency profile (office, lines, radius: the single source
// the radar, calls, Market and Helix read), its tracking numbers (bought from Twilio, about $1.15 a month each,
// forwarding to the office), and the partner radar (capped per run, $25 by default).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { buyTrackingNumber, releaseTrackingNumber, saveAgencyProfile, startPartnerRadar } from '@/lib/growth-actions';
import { LINES, type LineId } from '@/lib/lines';

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const pretty = (e: string | null) => { const d = String(e ?? '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ''; };

type Profile = { address: string | null; city: string | null; state: string | null; zip: string | null; lat: number | null; lines: string[]; service_radius_mi: number; licensed_states: string[]; carrier: string | null; main_phone_e164: string | null; website: string | null } | null;
type Num = { id: string; e164: string; label: string; source: string; created_at: string };
type Scan = { status: string; found: number; cost_cents: number; cap_cents: number; started_at: string; requests: number } | null;

export function AgencyProfilePanel({ tenantId, profile }: { tenantId: string; profile: Profile }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Set<string>>(new Set(profile?.lines ?? []));
  const toggle = (l: string) => setLines((s) => { const n = new Set(s); if (n.has(l)) n.delete(l); else n.add(l); return n; });
  return (
    <form style={{ display: 'grid', gap: 10 }} onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const f = new FormData(e.currentTarget);
      const g = (k: string) => String(f.get(k) ?? '').trim();
      const r = await saveAgencyProfile(tenantId, { address: g('address'), city: g('city'), state: g('state').toUpperCase(), zip: g('zip'), lines: [...lines], radius: Number(g('radius')), licensed: g('licensed'), carrier: g('carrier'), phone: g('phone'), website: g('website') });
      setBusy(false); toast(r); if (r.ok) router.refresh();
    }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: '2 1 220px' }}><span>Office street</span><input className="input" name="address" defaultValue={profile?.address ?? ''} placeholder="6053 Veterans Pkwy Ste 201" /></label>
        <label className="field" style={{ flex: '1 1 120px' }}><span>City</span><input className="input" name="city" defaultValue={profile?.city ?? ''} /></label>
        <label className="field" style={{ width: 70 }}><span>State</span><input className="input" name="state" defaultValue={profile?.state ?? ''} maxLength={2} /></label>
        <label className="field" style={{ width: 90 }}><span>ZIP</span><input className="input" name="zip" defaultValue={profile?.zip ?? ''} maxLength={5} /></label>
      </div>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="field"><span>Main office phone (calls forward here)</span><input className="input" name="phone" defaultValue={pretty(profile?.main_phone_e164 ?? null)} placeholder="(706) 555-0100" /></label>
        <label className="field"><span>Website (for partner referral links)</span><input className="input" name="website" defaultValue={profile?.website ?? ''} placeholder="https://javaagencyllc.com" /></label>
        <label className="field" style={{ width: 120 }}><span>Carrier</span><input className="input" name="carrier" defaultValue={profile?.carrier ?? ''} placeholder="GEICO" /></label>
        <label className="field" style={{ width: 110 }}><span>Licensed in</span><input className="input" name="licensed" defaultValue={(profile?.licensed_states ?? []).join(', ')} placeholder="GA, AL" /></label>
        <label className="field" style={{ width: 110 }}><span>Radius (miles)</span><input className="input" name="radius" type="number" min={3} max={50} defaultValue={profile?.service_radius_mi ?? 15} /></label>
      </div>
      <div style={{ display: 'grid', gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>Lines of business: only these are ever marketed, mapped or drafted for this agency.</span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {(Object.keys(LINES) as LineId[]).map((l) => <button key={l} type="button" className={'chip' + (lines.has(l) ? ' done' : '')} onClick={() => toggle(l)} aria-pressed={lines.has(l)}>{LINES[l].label}</button>)}
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn small primary" type="submit" disabled={busy}>Save profile</button>
        <span className="muted" style={{ fontSize: 12 }}>{profile?.lat ? 'Office placed on the map.' : 'The office is placed on the map when you save the address.'}</span>
      </div>
    </form>
  );
}

const SOURCES = [['website', 'Website'], ['google-profile', 'Google profile'], ['facebook', 'Facebook'], ['partner', 'Partner referrals'], ['campaign', 'A campaign']] as const;

export function PhoneNumbersPanel({ tenantId, numbers, ready }: { tenantId: string; numbers: Num[]; ready: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<string>('website');
  const [area, setArea] = useState('');
  const run = async (p: Promise<{ ok?: string; err?: string }>) => { setBusy(true); toast(await p); setBusy(false); router.refresh(); };
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {numbers.length ? (
        <ul className="list">
          {numbers.map((n) => (
            <li key={n.id} className="spread" style={{ gap: 8 }}>
              <span><b>{pretty(n.e164)}</b> <span className="muted" style={{ fontSize: 12 }}>· {n.label} · source “{n.source}”</span></span>
              <button className="btn small ghost" type="button" disabled={busy} onClick={() => { if (confirm(`Release ${pretty(n.e164)}? It stops ringing the office and can't be recovered.`)) void run(releaseTrackingNumber(n.id)); }}>Release</button>
            </li>
          ))}
        </ul>
      ) : <p className="muted" style={{ margin: 0, fontSize: 13 }}>No tracking numbers yet. Each one forwards to the office, plays a short recording notice, and turns every call into a lead tagged with where the number was shown.</p>}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field"><span>Shown on</span><select className="input" value={source} onChange={(e) => setSource(e.target.value)}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field" style={{ width: 110 }}><span>Area code</span><input className="input" value={area} onChange={(e) => setArea(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Office’s" /></label>
        <button className="btn small primary" type="button" disabled={busy || !ready} onClick={() => run(buyTrackingNumber(tenantId, SOURCES.find(([k]) => k === source)![1], source, area))}>Get a number (~$1.15/mo)</button>
        {!ready ? <span className="muted" style={{ fontSize: 12 }}>Connect Twilio in Vercel first.</span> : null}
      </div>
    </div>
  );
}

export function PartnerRadarPanel({ tenantId, scan, mapped, ready }: { tenantId: string; scan: Scan; mapped: number; ready: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cap, setCap] = useState(25);
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        {mapped} partners mapped.{' '}
        {scan ? `Last run ${new Date(scan.started_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${scan.status === 'running' ? 'still running' : scan.status === 'budget' ? 'stopped at its cap' : scan.status}, ${scan.found} found, ${scan.requests} searches, $${(Number(scan.cost_cents) / 100).toFixed(2)} of $${(scan.cap_cents / 100).toFixed(0)}.` : 'Not run yet.'}
      </p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field" style={{ width: 120 }}><span>Cap ($)</span><input className="input" type="number" min={1} max={100} value={cap} onChange={(e) => setCap(Number(e.target.value))} /></label>
        <button className="btn small primary" type="button" disabled={busy || !ready} onClick={async () => { setBusy(true); toast(await startPartnerRadar(tenantId, cap)); setBusy(false); router.refresh(); }}>{scan ? 'Refresh the partner map' : 'Map partners'}</button>
        <span className="muted" style={{ fontSize: 12 }}>Searches only categories that fit the agency’s lines, within its radius. Stops before the cap.</span>
      </div>
    </div>
  );
}
