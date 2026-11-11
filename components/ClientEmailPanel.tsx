// The client page's "Client email" panel (console): email the client from hello@genovus.io, now or at a set Eastern
// time (the next business morning at 9 by default), through the outbox like every other Genovus email; replies come
// back to hello@. Two kinds:
//  - Site ready for review (template site_review): their site card, a short note, and the open welcome-form items
//    the team ticks, each a button straight to that field on their dashboard, plus reply questions and next steps.
//  - A note (template client_update): anything else, written freely.
// The list shows what's scheduled and sent, with Cancel until the outbox picks it up.
import { ActionForm } from './ActionForm';
import { Panel } from './ui';
import { adminDb } from '@/lib/supabase/admin';
import { welcomeData } from '@/lib/welcome';
import { scheduleClientEmailAction, scheduleSiteReviewAction, cancelClientEmailAction } from '@/lib/client-email';

const etFmt = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

/** The next weekday at 9:00 Eastern, as a datetime-local value. */
function nextBusinessMorning() {
  const d = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return `${d.toISOString().slice(0, 10)}T09:00`;
}

const LABEL: Record<string, string> = { pending: 'Scheduled', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Canceled' };
/** Asked for by default when still open: what the site needs most from the client. */
const USUAL = new Set(['headshot', 'logo', 'story', 'languages', 'facebook', 'instagram', 'officePhoto']);
const NOTE = 'Thank you for your time at kickoff. We’ve started building, and your new site is live for you to review.\n\nIt stays hidden from Google until you approve it, so take your time. The list below takes you straight to each spot in your dashboard.';
const NEXT = [
  'We request manager access to your Google Business listing. When Google emails you, tap Approve.',
  'Once you approve the site, we open it to Google and submit it to Search Console.',
  'Your first month of posts comes to you for approval before anything is published.',
].join('\n');

function Recipients({ defaultTo }: { defaultTo: string }) {
  return (
    <div className="grid g2">
      <label className="field"><span>To</span><input className="input" name="to" defaultValue={defaultTo} placeholder="client@example.com" /></label>
      <label className="field"><span>Cc</span><input className="input" name="cc" placeholder="Comma-separated" /></label>
    </div>
  );
}

function SendRow() {
  return (
    <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
      <label className="field" style={{ minWidth: 0 }}><span>Send at (Eastern)</span><input className="input" type="datetime-local" name="when" defaultValue={nextBusinessMorning()} step={60} /></label>
      <label className="check"><input type="checkbox" name="intent" value="test" /> Just send me a test now</label>
      <button className="btn small primary" type="submit">Schedule</button>
    </div>
  );
}

export async function ClientEmailPanel({ tenantId, slug, defaultTo }: { tenantId: string; slug: string; defaultTo: string }) {
  const [{ data: rows }, w] = await Promise.all([
    adminDb().from('outbox').select('id, to_email, template, data, status, send_after, sent_at, last_error')
      .eq('tenant_id', tenantId).in('template', ['client_update', 'site_review']).order('id', { ascending: false }).limit(10),
    welcomeData(tenantId, slug),
  ]);
  const list = (rows ?? []).filter((r) => (r.data as Record<string, string>).test !== 'true');
  const intake = w.status.intake;
  const site = String(w.record.website ?? '') || (typeof intake.domain === 'string' && intake.domain ? `https://${intake.domain.replace(/^https?:\/\//, '')}` : '');
  const open = w.status.items.filter((i) => !i.done);
  return (
    <Panel title="Client email" sub="Email this client from hello@genovus.io, now or at a set time (Eastern). Replies come back to hello@." helixItem="Client email">
      {list.length ? (
        <ul className="list" style={{ marginBottom: 14 }}>
          {list.map((r) => {
            const d = r.data as Record<string, string>;
            return (
              <li key={r.id}>
                <b>{d.subject}</b>
                <span className="muted" style={{ fontSize: 13 }}>{r.template === 'site_review' ? 'Site review · ' : ''}To {r.to_email}{d.cc ? ` · cc ${d.cc}` : ''}</span>
                <span className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className={`chip ${r.status === 'sent' ? 'done' : r.status === 'failed' ? 'blocked' : 'pending'}`}>{LABEL[r.status] ?? r.status}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{r.status === 'sent' && r.sent_at ? `${etFmt(r.sent_at)} Eastern` : r.status === 'pending' || r.status === 'sending' ? `${etFmt(r.send_after)} Eastern` : r.last_error ?? ''}</span>
                  {r.status === 'pending' ? (
                    <ActionForm action={cancelClientEmailAction} helix="cancel client email" helixTitle="Cancel client email" lane="outward">
                      <input type="hidden" name="tenant" value={tenantId} />
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn small" type="submit">Cancel</button>
                    </ActionForm>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      <details open={!list.length} style={{ marginBottom: 12 }}>
        <summary><b>Site ready for review</b> <span className="muted" style={{ fontSize: 13 }}>their site card, a short note, and what’s still missing, each a button straight to that spot in their dashboard</span></summary>
        <ActionForm action={scheduleSiteReviewAction} helix="site review email" helixTitle="Site review email" lane="outward" className="form" style={{ marginTop: 10 }}>
          <input type="hidden" name="tenant" value={tenantId} />
          <Recipients defaultTo={defaultTo} />
          <div className="grid g2">
            <label className="field"><span>Site address</span><input className="input" name="site" defaultValue={site} placeholder="https://" /></label>
            <label className="field"><span>Subject (optional)</span><input className="input" name="subject" placeholder={`${w.first ? `${w.first}, your` : 'Your'} new website is ready for review`} maxLength={200} /></label>
          </div>
          <label className="check"><input type="checkbox" name="card" value="1" defaultChecked /> Show the site’s share card (its /opengraph-image) as the picture</label>
          <label className="field"><span>Your note</span><textarea className="input" name="note" rows={5} defaultValue={NOTE} /></label>
          <label className="field"><span>Signed by</span><input className="input" name="sender" placeholder="Your first name (replies reach you)" maxLength={60} /></label>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <span>To finish their site <span className="muted">({w.progress.filled} of {w.progress.total} done on their welcome form). Each ticked item gets a button to that field; change the line under it if you like.</span></span>
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gap: 4 }}>
                <label className="check"><input type="checkbox" name="copy" value="1" defaultChecked /> <b>Review your site copy</b> <span className="muted">(button to the site)</span></label>
                <input className="input" name="copy_help" placeholder="Read it through. Reply “approved”, or tell us what to change." maxLength={300} />
              </div>
              {open.map((i) => (
                <div key={i.key} style={{ display: 'grid', gap: 4 }}>
                  <label className="check"><input type="checkbox" name="item" value={i.key} defaultChecked={i.required || USUAL.has(i.key)} /> <b>{i.label}</b>{i.required ? <span className="muted"> (needed to build)</span> : null}</label>
                  <input className="input" name={`help_${i.key}`} placeholder={i.help} maxLength={300} />
                </div>
              ))}
              {!open.length ? <p className="muted" style={{ margin: 0 }}>Their welcome form is complete.</p> : null}
            </div>
          </fieldset>
          <label className="field"><span>Questions to answer by reply <span className="muted">(one per line)</span></span><textarea className="input" name="reply" rows={2} placeholder="Does your office write RV policies?" /></label>
          <label className="field"><span>What happens next <span className="muted">(one per line)</span></span><textarea className="input" name="next" rows={3} defaultValue={NEXT} /></label>
          <SendRow />
        </ActionForm>
      </details>

      <details>
        <summary><b>A note</b> <span className="muted" style={{ fontSize: 13 }}>anything else, written freely</span></summary>
        <ActionForm action={scheduleClientEmailAction} helix="client email" helixTitle="Client email" lane="outward" className="form" style={{ marginTop: 10 }}>
          <input type="hidden" name="tenant" value={tenantId} />
          <Recipients defaultTo={defaultTo} />
          <label className="field"><span>Subject</span><input className="input" name="subject" maxLength={200} /></label>
          <label className="field"><span>Email</span><textarea className="input" name="body" rows={10} placeholder={'Good morning …\n\nA blank line starts a new paragraph; single lines (lists) stay as written.'} /></label>
          <SendRow />
        </ActionForm>
      </details>
    </Panel>
  );
}
