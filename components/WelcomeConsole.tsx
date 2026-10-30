// The client page's "Welcome and kickoff" panel (console): everything the team needs from the consult to the
// kickoff in one place. The kickoff on the calendar and whether the client confirmed it, how far their welcome form
// is, the deposit's due date, the one-tap welcome email, the kickoff agenda built from what's still open, and the
// carrier starter promos to copy from another agency with the same carrier.
import Link from 'next/link';
import { ActionForm } from './ActionForm';
import { Panel, Bar } from './ui';
import { adminDb } from '@/lib/supabase/admin';
import { welcomeData, etWhen } from '@/lib/welcome';
import { sendWelcomeAction, setDepositDueAction, copyPromosAction } from '@/lib/welcome-actions';

/** Only files and plain public images copy: never a path under another client's private welcome link (/w/, /welcome/). */
const promoCopyable = (a: { location_kind: string; location: string }) => a.location_kind === 'blob' || a.location_kind === 'external' || (a.location_kind === 'public' && !/^\/(w|welcome)\//.test(a.location));

/** Other agencies with the same carrier whose Library has client-facing images: where a new client's promos start. */
async function promoSources(tenantId: string, carrier: string) {
  const db = adminDb();
  const word = carrier.trim().split(/\s+/)[0]?.toLowerCase();
  if (!word) return [];
  const { data: recs } = await db.from('agent_records').select('tenant_id').eq('is_current', true).neq('tenant_id', tenantId).ilike('data->>carrier', `%${word.replace(/[%_]/g, '')}%`).limit(50);
  const same = (recs ?? []).map((r) => r.tenant_id as string);
  if (!same.length) return [];
  const [{ data: ts }, { data: imgs }] = await Promise.all([
    db.from('tenants').select('id, name, is_sample').in('id', same).eq('is_sample', false),
    db.from('assets').select('id, tenant_id, title, rights_status, location_kind, location').in('tenant_id', same).eq('kind', 'image').neq('audience', 'internal').order('title'),
  ]);
  return (ts ?? []).map((t) => ({ id: t.id as string, name: t.name as string, images: (imgs ?? []).filter((a) => a.tenant_id === t.id && promoCopyable(a)) })).filter((s) => s.images.length);
}

export async function WelcomeConsole({ tenantId, slug, sentAt }: { tenantId: string; slug: string; sentAt: string | null }) {
  const w = await welcomeData(tenantId, slug);
  const carrier = String(w.record.carrier ?? '');
  const sources = await promoSources(tenantId, carrier);
  const open = w.status.items.filter((i) => !i.done);
  const questions = typeof w.status.intake.questions === 'string' ? w.status.intake.questions : '';
  const agenda: [string, string][] = [
    ['Their questions', questions || 'None written yet. Ask what they want covered.'],
    ['Close the form', open.length ? open.map((i) => i.label.replace(/\?$/, '')).join(' · ') : 'Everything is answered. Confirm it matches their carrier profile.'],
    ['Creative', 'Headshot and office photos, colors and tone, which line pages to feature, the story in their words.'],
    ['Promo library', w.library ? `${w.library} carrier-approved promo(s) in their Library: keep, change or drop; plan the first posts from them.` : 'Copy the carrier starter promos below before the call.'],
    ['Social and Google access', 'Facebook and Instagram partner access and the Google Business Profile manager invite, done live on the call.'],
    ['Dashboard and sign-in', 'Sign in on their phone, turn on new-lead alerts, a tour of Today, Leads, Approvals and Ask Helix.'],
    ['Next steps', w.deposit.paid ? 'Deposit is paid. Build, carrier review, launch.' : `Deposit ${w.deposit.due ? `due ${w.deposit.due}` : 'date to agree'}; then build, carrier review, launch.`],
  ];
  return (
    <Panel title="Welcome and kickoff" sub="From the consult to the kickoff: what the client sees on their Welcome page, and what’s left to cover" helixItem="Welcome and kickoff">
      <div className="grid g2">
        <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
          <p style={{ margin: 0 }}><b>Kickoff:</b> {w.kickoff ? <>{etWhen(w.kickoff.starts)} (Eastern) · {w.kickoff.confirmed ? <span className="chip done">Confirmed by the client</span> : <span className="chip pending">Not confirmed yet</span>}</> : <span className="muted">Nothing on the calendar with “kickoff” in the title. Add it under Meetings (or ask Helix) and send the invite.</span>}</p>
          <div>
            <p style={{ margin: '0 0 4px' }}><b>Welcome form:</b> {w.progress.filled} of {w.progress.total} answered{w.status.missing.length ? ` · needed to build: ${w.status.missing.map((m) => m.label).join(', ')}` : ' · everything needed to build is in'}</p>
            <Bar value={w.progress.filled} total={w.progress.total} done={w.status.done} />
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn small" href={`/app/${slug}/welcome`}>Open their Welcome page</Link>
            {w.previewUrl ? <a className="btn small" href={w.previewUrl} target="_blank" rel="noreferrer">Site preview ↗</a> : null}
          </div>
          <ActionForm action={setDepositDueAction} helix="deposit due" helixTitle="Deposit due date" className="row">
            <input type="hidden" name="tenant" value={tenantId} />
            <label className="field" style={{ minWidth: 0 }}><span>Deposit due</span><input className="input" type="date" name="due" defaultValue={w.deposit.due ?? ''} disabled={w.deposit.paid} /></label>
            <button className="btn small" type="submit" disabled={w.deposit.paid}>Save date</button>
          </ActionForm>
          <ActionForm action={sendWelcomeAction} helix="send welcome" helixTitle="Send welcome" lane="outward" className="row" confirm={sentAt ? 'The welcome already went out. Send it again?' : undefined}>
            <input type="hidden" name="tenant" value={tenantId} />
            <button className="btn small primary" type="submit">{sentAt ? 'Send the welcome again' : 'Send welcome email'}</button>
            <span className="muted" style={{ fontSize: 12 }}>{sentAt ? `Sent ${new Date(sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}` : 'Package, deposit, kickoff and their Welcome page, to the client and owners'}</span>
          </ActionForm>
        </div>
        <div>
          <p style={{ margin: '0 0 6px' }}><b>Kickoff agenda</b> <span className="muted" style={{ fontSize: 12 }}>(from what’s still open)</span></p>
          <ol className="steps">{agenda.map(([k, v], i) => <li key={k}><span className="dot">{i + 1}</span><span><b>{k}.</b> <span className="soft">{v}</span></span></li>)}</ol>
        </div>
      </div>
      {/* Copying promos is a team task done by hand: kept out of Helix's page snapshot, so the client page's own forms fit. */}
      <div style={{ marginTop: 14 }} data-helix-skip>
        <p style={{ margin: '0 0 6px' }}><b>Carrier starter promos</b> <span className="muted" style={{ fontSize: 12 }}>{w.library ? `${w.library} image(s) in this client’s Library now.` : 'None in this client’s Library yet.'}</span></p>
        {sources.length ? sources.map((s) => (
          <ActionForm key={s.id} action={copyPromosAction} helix="copy promos" helixTitle={`Copy promos from ${s.name}`} className="form">
            <input type="hidden" name="tenant" value={tenantId} />
            <input type="hidden" name="source" value={s.id} />
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>From {s.name}’s library ({carrier}). Untick anything specific to that agency (their name, photo or phone).</p>
            <div className="promo-pick">
              {s.images.map((a) => (
                <label key={a.id} className="check promo-item"><input type="checkbox" name="asset" value={a.id} defaultChecked={!/headshot|office photo|logo/i.test(a.title)} />
                  <img src={a.location_kind === 'blob' ? `/api/assets/${a.id}` : a.location} alt="" loading="lazy" /><span>{a.title}{a.rights_status !== 'cleared' ? <span className="muted"> · rights {a.rights_status}</span> : null}</span></label>
              ))}
            </div>
            <button className="btn small" type="submit">Copy the ticked promos</button>
          </ActionForm>
        )) : <p className="muted" style={{ fontSize: 13, margin: 0 }}>{carrier ? `No other ${carrier} agency has promos in its Library yet.` : 'Set the carrier on the record to find same-carrier promos.'}</p>}
      </div>
    </Panel>
  );
}
