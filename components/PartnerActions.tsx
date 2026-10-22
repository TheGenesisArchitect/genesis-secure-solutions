'use client';
// One partner's next step, one tap each: no answer (try again tomorrow), interested (book a visit: opens the Calendar
// with open times Helix suggests), now a partner, not now, or do not contact (honored everywhere). Partners get a referral link whose leads
// arrive in Leads tagged with their name. Logging a call or visit keeps the business name shown on the card as the
// agency's own record ("On your records as …", editable), which is how Helix remembers who was called.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logPartner, namePartner } from '@/lib/growth-actions';
import { CopyButton } from './CopyButton';

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const tomorrow930 = () => { const d = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); return `${d}T09:30`; };

export function PartnerActions({ id, status, refLink, name, knownName }: { id: string; status: string; refLink: string | null; name?: string | null; knownName?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(knownName ?? name ?? '');
  const go = async (a: Parameters<typeof logPartner>[0]) => { setBusy(true); const r = await logPartner({ ...a, name: knownName ? undefined : name ?? undefined }); setBusy(false); toast(r); if (r.ok) router.refresh(); };
  const working = status === 'partner' || status === 'referring';
  const visiting = status === 'meeting';
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {!working && !visiting ? <button className="btn small" type="button" disabled={busy} onClick={() => go({ id, kind: 'call', status: 'called', next: tomorrow930(), note: 'No answer: try again tomorrow' })}>No answer</button> : null}
        {!working ? <button className={'btn small' + (visiting ? ' ghost' : ' primary')} type="button" disabled={busy} onClick={() => router.push(`${location.pathname.replace(/\/partners.*$/, '')}/calendar?book=partner:${id}`)}>{visiting ? 'Reschedule' : 'Interested: book a visit'}</button> : null}
        {status === 'meeting' ? <button className="btn small good" type="button" disabled={busy} onClick={() => go({ id, kind: 'visit', status: 'partner', note: 'Agreed to refer' })}>Now a partner</button> : null}
        {!working ? <button className="btn small ghost" type="button" disabled={busy} onClick={() => go({ id, kind: 'call', status: 'not_now', note: 'Not now' })}>Not now</button> : null}
        {!working && !visiting ? <button className="btn small ghost" type="button" disabled={busy} onClick={() => go({ id, kind: 'call', status: 'opted_out', note: 'Asked not to be contacted' })}>Do not contact</button> : null}
        {working && refLink ? <CopyButton text={refLink} label="Copy referral link" /> : null}
      </div>
      {knownName && !editing ? <span className="muted" style={{ fontSize: 12 }}>On your records as <b>{knownName}</b> · <button type="button" className="linkish" onClick={() => setEditing(true)}>Edit</button></span> : null}
      {editing ? (
        <form className="row" style={{ gap: 6, flexWrap: 'nowrap' }} onSubmit={async (e) => { e.preventDefault(); setBusy(true); toast(await namePartner(id, draft)); setBusy(false); setEditing(false); router.refresh(); }}>
          <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={120} aria-label="Business name on your records" style={{ flex: 1, minWidth: 0 }} />
          <button className="btn small" type="submit" disabled={busy}>Save</button>
          <button className="btn small ghost" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : null}
    </div>
  );
}
