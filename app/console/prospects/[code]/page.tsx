// One office: live details from Google (shown, never stored), why it fits Genovus, its history with us,
// and the forms to log a call, record first-party contact details, and build a tracked link.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { Panel, Chip } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { getDetails, isOwnSite } from '@/lib/places';
import { fit } from '@/lib/classify';
import { scanSettings } from '@/lib/scanner';
import { STATUS_LABEL, OUTCOMES, CARRIER_HOSTS, officeClock } from '@/lib/prospects';
import { logProspect } from '@/lib/scan-actions';

export const dynamic = 'force-dynamic';

export default async function Prospect({ params }: { params: Promise<{ code: string }> }) {
  await requireStaff();
  const { code } = await params;
  const supabase = await db();
  const { data: p } = await supabase.from('prospects').select('*, carriers(name, slug, fit_score, fit_reasons)').eq('code', code).maybeSingle();
  if (!p) notFound();
  const [details, { data: events }, { data: campaigns }, settings, { data: suppressed }] = await Promise.all([
    getDetails(p.place_id),
    supabase.from('prospect_events').select('*').eq('prospect_id', p.id).order('at', { ascending: false }).limit(50),
    supabase.from('campaigns').select('slug, name, segment, channel').in('status', ['live', 'draft']).order('created_at', { ascending: false }),
    scanSettings(),
    supabase.from('suppression').select('id').eq('place_id', p.place_id).limit(1),
  ]);
  const carrier = p.carriers as { name: string; slug: string; fit_score: number; fit_reasons: string[] } | null;
  const ownSite = details ? isOwnSite(details.website, CARRIER_HOSTS) : null;
  const f = fit({ carrierFit: carrier?.fit_score ?? 50, carrierReasons: carrier?.fit_reasons ?? [], state: p.state, focusStates: settings.states, hasOwnSite: ownSite, contactKnown: Boolean(p.contact_email || p.contact_name), status: p.status });
  const clock = officeClock(p.state);
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  const segPath = p.segment === 'captive' ? '/for/captive-agents' : '/for/independent-agencies';
  const blocked = Boolean(suppressed?.length) || p.status === 'opted_out';
  const title = details?.name || p.contact_name || `Office ${p.code}`;
  return (
    <ConsoleShell title={title} crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/prospects', label: 'Prospects' }, { label: title }]}>
      {blocked ? <div className="notice err"><b>Do not contact.</b> This office opted out; it stays on the suppression list.</div> : null}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Office" sub="Live from Google Maps; not stored" actions={<Chip kind="info">{STATUS_LABEL[p.status]}</Chip>}>
            {details ? (
              <dl className="kv">
                <dt>Name</dt><dd>{details.name}</dd>
                <dt>Address</dt><dd>{details.address}</dd>
                <dt>Phone</dt><dd>{details.phone ? <a href={`tel:${details.phone}`}>{details.phone}</a> : '—'}</dd>
                <dt>Website</dt><dd>{details.website ? <a href={details.website} target="_blank" rel="noreferrer">{details.website}</a> : 'None listed'}</dd>
                <dt>Status</dt><dd>{details.status === 'OPERATIONAL' ? 'Open' : details.status ?? '—'}</dd>
                <dt>Local time</dt><dd>{clock.label} {clock.callable ? <Chip kind="done">Good time to call</Chip> : <Chip kind="pending">Outside calling hours</Chip>}</dd>
              </dl>
            ) : <p className="muted">Live details are unavailable (Google Places not connected).</p>}
            {details?.mapsUrl ? <a className="btn small" href={details.mapsUrl} target="_blank" rel="noreferrer">Open in Google Maps</a> : null}
          </Panel>
          <Panel title={`Fit ${f.score}/100`} sub={`${carrier?.name ?? 'Independent agency'} · ${p.segment} · ${p.state ?? 'state unknown'}`}>
            <ul className="list">{f.reasons.map((r) => <li key={r} style={{ fontSize: 14 }}>{r}</li>)}</ul>
          </Panel>
          <Panel title="Tracked links" sub="Credits this office if they reach out from a campaign link">
            {campaigns?.length ? (
              <ul className="list">
                {campaigns.map((c) => (
                  <li key={c.slug} style={{ gap: 4 }}><b style={{ fontSize: 13 }}>{c.name}</b>
                    <code style={{ fontSize: 12, overflowWrap: 'anywhere', userSelect: 'all' }}>{`${origin}${segPath}?c=${c.slug}&src=${c.channel}&p=${p.code}${carrier && p.segment === 'captive' ? `&carrier=${carrier.slug}` : ''}`}</code>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">Create a campaign first (Campaigns).</p>}
          </Panel>
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Log a call or note" sub="Outcomes move the office through the pipeline">
            <ActionForm action={logProspect} className="form" resetOnOk>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="kind" value="call" />
              <div className="row">
                {OUTCOMES.map(([o, label, status]) => (
                  <label key={o} className="check" style={{ alignItems: 'center' }}><input type="radio" name="outcome" value={o} data-status={status ?? ''} /> {label}</label>
                ))}
              </div>
              <label className="field"><span>Set status (optional; the outcome sets it otherwise)</span>
                <select className="select" name="status" defaultValue=""><option value="">From the outcome</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="field"><span>Notes</span><textarea className="textarea" name="note" maxLength={2000} /></label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <label className="field" style={{ flex: 1 }}><span>Contact name</span><input className="input" name="contact_name" defaultValue={p.contact_name ?? ''} /></label>
                <label className="field" style={{ flex: 1 }}><span>Email they gave us</span><input className="input" name="contact_email" type="email" defaultValue={p.contact_email ?? ''} /></label>
              </div>
              <label className="field"><span>Next call</span><input className="input" name="next" type="date" /></label>
              <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Save</button>
            </ActionForm>
          </Panel>
          <Panel title="History">
            <ul className="list">
              {(events ?? []).map((e) => (
                <li key={e.id} style={{ fontSize: 13 }}>
                  <div className="spread"><b>{e.kind}{e.outcome ? ` · ${OUTCOMES.find(([o]) => o === e.outcome)?.[1] ?? e.outcome}` : ''}</b><span className="muted">{new Date(e.at).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })}</span></div>
                  {e.note ? <span className="soft">{e.note}</span> : null}
                </li>
              ))}
              {!events?.length ? <li className="muted">Nothing yet. Found {new Date(p.first_seen).toLocaleDateString('en-US')}.</li> : null}
            </ul>
            <Link href="/console/prospects/calls" className="btn small">Back to the call list</Link>
          </Panel>
        </div>
      </div>
    </ConsoleShell>
  );
}
