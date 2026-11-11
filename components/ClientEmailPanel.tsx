// The client page's "Client email" panel (console): write a note to the client, set To and Cc, pick when it goes
// (Eastern, the next business morning at 9 by default) and schedule it. It goes out through the outbox and Resend
// from hello@genovus.io like every other Genovus email; replies come back to hello@. The list shows what's scheduled
// and sent, with Cancel until the outbox picks it up.
import { ActionForm } from './ActionForm';
import { Panel } from './ui';
import { adminDb } from '@/lib/supabase/admin';
import { scheduleClientEmailAction, cancelClientEmailAction } from '@/lib/client-email';

const etFmt = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

/** The next weekday at 9:00 Eastern, as a datetime-local value. */
function nextBusinessMorning() {
  const d = new Date(`${new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}T12:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return `${d.toISOString().slice(0, 10)}T09:00`;
}

const LABEL: Record<string, string> = { pending: 'Scheduled', sending: 'Sending', sent: 'Sent', failed: 'Failed', skipped: 'Canceled' };

export async function ClientEmailPanel({ tenantId, defaultTo }: { tenantId: string; defaultTo: string }) {
  const { data: rows } = await adminDb().from('outbox').select('id, to_email, data, status, send_after, sent_at, last_error')
    .eq('tenant_id', tenantId).eq('template', 'client_update').order('id', { ascending: false }).limit(10);
  const list = (rows ?? []).filter((r) => (r.data as Record<string, string>).test !== 'true');
  return (
    <Panel title="Client email" sub="A note from the team to this client, sent from hello@genovus.io now or at a set time (Eastern). Replies come back to hello@." helixItem="Client email">
      {list.length ? (
        <ul className="list" style={{ marginBottom: 14 }}>
          {list.map((r) => {
            const d = r.data as Record<string, string>;
            return (
              <li key={r.id} className="spread" style={{ gap: 10, flexWrap: 'wrap' }}>
                <span style={{ minWidth: 0 }}>
                  <b>{d.subject}</b><br />
                  <span className="muted" style={{ fontSize: 13 }}>To {r.to_email}{d.cc ? ` · cc ${d.cc}` : ''}</span><br />
                  <span className="muted" style={{ fontSize: 13 }}>
                    <span className={`chip ${r.status === 'sent' ? 'done' : r.status === 'failed' ? 'blocked' : 'pending'}`}>{LABEL[r.status] ?? r.status}</span>{' '}
                    {r.status === 'sent' && r.sent_at ? etFmt(r.sent_at) : r.status === 'pending' || r.status === 'sending' ? etFmt(r.send_after) : ''}{r.status === 'failed' || r.status === 'skipped' ? ` ${r.last_error ?? ''}` : ''} (Eastern)
                  </span>
                </span>
                {r.status === 'pending' ? (
                  <ActionForm action={cancelClientEmailAction} helix="cancel client email" helixTitle="Cancel client email" lane="outward">
                    <input type="hidden" name="tenant" value={tenantId} />
                    <input type="hidden" name="id" value={r.id} />
                    <button className="btn small" type="submit">Cancel</button>
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <ActionForm action={scheduleClientEmailAction} helix="client email" helixTitle="Client email" lane="outward" className="form">
        <input type="hidden" name="tenant" value={tenantId} />
        <div className="grid g2">
          <label className="field"><span>To</span><input className="input" name="to" defaultValue={defaultTo} placeholder="client@example.com" /></label>
          <label className="field"><span>Cc</span><input className="input" name="cc" placeholder="Comma-separated" /></label>
        </div>
        <label className="field"><span>Subject</span><input className="input" name="subject" maxLength={200} /></label>
        <label className="field"><span>Email</span><textarea className="input" name="body" rows={12} placeholder={'Good morning …\n\nA blank line starts a new paragraph; single lines (lists) stay as written.'} /></label>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field" style={{ minWidth: 0 }}><span>Send at (Eastern)</span><input className="input" type="datetime-local" name="when" defaultValue={nextBusinessMorning()} step={60} /></label>
          <label className="check"><input type="checkbox" name="intent" value="test" /> Just send me a test now</label>
          <button className="btn small primary" type="submit">Schedule</button>
        </div>
      </ActionForm>
    </Panel>
  );
}
