'use client';
// One partner's next step, one tap each: no answer (try again tomorrow), interested (book a visit: opens the Calendar
// with open times Helix suggests), now a partner, not now, or do not contact (honored everywhere). Partners get a referral link whose leads
// arrive in Leads tagged with their name.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { logPartner } from '@/lib/growth-actions';
import { CopyButton } from './CopyButton';

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const tomorrow930 = () => { const d = new Date(Date.now() + 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); return `${d}T09:30`; };

export function PartnerActions({ id, status, refLink }: { id: string; status: string; refLink: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async (a: Parameters<typeof logPartner>[0]) => { setBusy(true); const r = await logPartner(a); setBusy(false); toast(r); if (r.ok) router.refresh(); };
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
    </div>
  );
}
