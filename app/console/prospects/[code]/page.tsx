// One office: live details from Google (shown, never stored), why it fits Genovus, its history with us,
// and the forms to log a call, record first-party contact details, and build a tracked link.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { Panel, Chip } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { getDetails, isOwnSite, GOOGLE_ATTRIBUTION } from '@/lib/places';
import { PlacesPausedNotice } from '@/components/PlacesPausedNotice';
import { fit } from '@/lib/classify';
import { scanSettings } from '@/lib/scanner';
import { STATUS_LABEL, OUTCOMES, CARRIER_HOSTS, officeClock } from '@/lib/prospects';
import { logProspect, startOnboarding } from '@/lib/scan-actions';
import { ConsultInviteForm } from '@/components/ConsultInviteForm';
import { LINES, type LineId } from '@/lib/lines';

const LINE_CHOICES = (Object.keys(LINES) as LineId[]).map((l) => [l, LINES[l].label] as const);

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
  const { data: client } = p.tenant_id ? await supabase.from('tenants').select('slug').eq('id', p.tenant_id).maybeSingle() : { data: null };
  const carrier = p.carriers as { name: string; slug: string; fit_score: number; fit_reasons: string[] } | null;
  const ownSite = details ? isOwnSite(details.website, CARRIER_HOSTS) : null;
  const f = fit({ carrierFit: carrier?.fit_score ?? 50, carrierReasons: carrier?.fit_reasons ?? [], state: p.state, focusStates: settings.states, hasOwnSite: ownSite, contactKnown: Boolean(p.contact_email || p.contact_name), status: p.status });
  const clock = officeClock(p.state);
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  const segPath = p.segment === 'captive' ? '/for/captive-agents' : '/for/independent-agencies';
  const blocked = Boolean(suppressed?.length) || p.status === 'opted_out';
  const title = details?.name || p.known_name || p.contact_name || `Office ${p.code}`;
  return (
    <ConsoleShell title={title} crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/prospects', label: 'Prospects' }, { label: title }]}>
      <PlacesPausedNotice audience="staff" />
      {blocked ? <div className="notice err"><b>Do not contact.</b> This office opted out; it stays on the suppression list.</div> : null}
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Office" sub={details ? 'Live from Google Maps' : p.known_name || p.contact_phone ? 'From your team’s records' : 'Live from Google Maps'} actions={<Chip kind="info">{STATUS_LABEL[p.status]}</Chip>}>
            {details ? (
              <dl className="kv">
                <dt>Name</dt><dd>{details.name}</dd>
                <dt>Address</dt><dd>{details.address}</dd>
                <dt>Phone</dt><dd>{details.phone ? <a href={`tel:${details.phone}`}>{details.phone}</a> : '—'}</dd>
                <dt>Website</dt><dd>{details.website ? <a href={details.website} target="_blank" rel="noreferrer">{details.website}</a> : 'None listed'}</dd>
                <dt>Status</dt><dd>{details.status === 'OPERATIONAL' ? 'Open' : details.status ?? '—'}</dd>
                <dt>Local time</dt><dd>{clock.label} {clock.callable ? <Chip kind="done">Good time to call</Chip> : <Chip kind="pending">Outside calling hours</Chip>}</dd>
              </dl>
            ) : p.known_name || p.known_address || p.contact_phone || p.contact_name ? (
              <dl className="kv">
                <dt>Name</dt><dd>{p.known_name ?? '—'}</dd>
                <dt>Address</dt><dd>{p.known_address ?? '—'}</dd>
                <dt>Phone</dt><dd>{p.contact_phone ? <a href={`tel:${p.contact_phone}`}>{p.contact_phone}</a> : '—'}</dd>
                <dt>Contact</dt><dd>{p.contact_name ?? '—'}{p.contact_email ? ` · ${p.contact_email}` : ''}</dd>
                <dt>Local time</dt><dd>{clock.label} {clock.callable ? <Chip kind="done">Good time to call</Chip> : <Chip kind="pending">Outside calling hours</Chip>}</dd>
              </dl>
            ) : <p className="muted">Google’s details aren’t available right now, and nobody has logged a call with this office yet.</p>}
            {details?.mapsUrl ? <a className="btn small" href={details.mapsUrl} target="_blank" rel="noreferrer">Open in Google Maps</a> : null}
            {details ? <p className="muted" style={{ fontSize: 12, margin: 0 }}>{GOOGLE_ATTRIBUTION}</p> : null}
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
          <Panel title="Consultation" sub="Send a link so they pick the time; the invite goes to everyone" helixItem="Consultation">
            <ConsultInviteForm label={title.startsWith('Office ') ? (p.contact_name ?? '') : `${p.contact_name ? `${p.contact_name}, ` : ''}${title}`} emails={p.contact_email ?? ''} prospectId={p.id} />
          </Panel>
          {p.tenant_id ? (
            <Panel title="Onboarding started" sub="This office is a client now">
              <Link className="btn primary" href={`/console/clients/${client?.slug ?? ''}`}>Open the client</Link>
            </Panel>
          ) : p.status !== 'opted_out' ? (
            <Panel title="Start onboarding" sub="Creates the client in Consult with a draft record and the launch checklist. Helix can fill this while you talk." helixItem="Start onboarding">
              <ActionForm action={startOnboarding} helix="onboarding" helixTitle="Start onboarding" className="form">
                <input type="hidden" name="id" value={p.id} />
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <label className="field" style={{ flex: '1 1 240px' }}><span>Agency name</span><input className="input" name="name" required maxLength={160} defaultValue={title.startsWith('Office ') ? '' : title} /></label>
                  <label className="field" style={{ flex: '1 1 200px' }}><span>Client web address (genovus.io/app/…)</span><input className="input" name="slug" required pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" maxLength={50} defaultValue={title.startsWith('Office ') ? '' : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)} /></label>
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <label className="field" style={{ flex: '1 1 200px' }}><span>Owner / main contact</span><input className="input" name="contact" maxLength={120} defaultValue={p.contact_name ?? ''} /></label>
                  <label className="field" style={{ flex: '1 1 220px' }}><span>Their email</span><input className="input" name="email" type="email" maxLength={200} defaultValue={p.contact_email ?? ''} /></label>
                  <label className="field" style={{ flex: '1 1 160px' }}><span>Phone</span><input className="input" name="phone" maxLength={40} defaultValue={p.contact_phone || details?.phone || ''} /></label>
                </div>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <label className="field" style={{ flex: '2 1 240px' }}><span>Office street address</span><input className="input" name="street" maxLength={160} defaultValue={(details?.address || p.known_address || '').split(',')[0]?.trim() ?? ''} /></label>
                  <label className="field" style={{ flex: '1 1 160px' }}><span>City</span><input className="input" name="city" maxLength={80} defaultValue={(details?.address || p.known_address || '').split(',').at(-3)?.trim() ?? ''} /></label>
                  <label className="field" style={{ flex: '0 1 80px' }}><span>State</span><input className="input" name="state" maxLength={2} defaultValue={p.state ?? ''} /></label>
                  <label className="field" style={{ flex: '0 1 100px' }}><span>ZIP</span><input className="input" name="zip" maxLength={10} defaultValue={(details?.address || p.known_address || '').match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? ''} /></label>
                </div>
                <label className="field"><span>Website</span><input className="input" name="website" maxLength={200} defaultValue={details?.website ?? ''} /></label>
                <div className="field"><span>Lines of business they sell</span>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} data-helix-group="Lines of business">
                    {LINE_CHOICES.map(([l, label]) => <label key={l} className="check"><input type="checkbox" name="lines" value={l} /> {label}</label>)}
                  </div>
                </div>
                <label className="field"><span>Package (its features switch on as a 30-day trial; the website build starts with it)</span>
                  <select className="select" name="package" required defaultValue="">
                    <option value="" disabled>Pick the package they chose</option>
                    <option value="launch">Launch · website, profiles, leads (Essential Care after launch)</option>
                    <option value="growth">Growth · plus Helix, partners, pipeline, calendar, content (Growth Care)</option>
                    <option value="premium">Premium · everything in Growth and more (Optimization Care)</option>
                  </select>
                </label>
                <label className="check"><input type="checkbox" name="trial" value="growth" /> Add a 30-day Growth trial (Launch package: Growth’s features for 30 days at the Launch price)</label>
                <label className="field"><span>What we agreed (optional)</span><input className="input" name="note" maxLength={300} placeholder="e.g. Launch package, kickoff next Tuesday" /></label>
                <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Start onboarding</button>
              </ActionForm>
            </Panel>
          ) : null}
          <Panel title="Log a call or note" sub="Outcomes move the office through the pipeline">
            <ActionForm action={logProspect} helix="call log" helixTitle="Log the call" className="form" resetOnOk>
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
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <label className="field" style={{ flex: '1 1 220px' }}><span>Business name (kept on our records)</span><input className="input" name="known_name" maxLength={160} defaultValue={details?.name || p.known_name || ''} /></label>
                <label className="field" style={{ flex: '1 1 160px' }}><span>Office phone</span><input className="input" name="contact_phone" maxLength={40} defaultValue={p.contact_phone || details?.phone || ''} /></label>
              </div>
              <label className="field"><span>Address</span><input className="input" name="known_address" maxLength={240} defaultValue={details?.address || p.known_address || ''} /></label>
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
