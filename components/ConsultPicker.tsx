'use client';
// The open times for a consultation, grouped by day; one tap picks, a second confirms.
import { useState } from 'react';

export function ConsultPicker({ token, slots }: { token: string; slots: { iso: string; label: string }[] }) {
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (msg?.ok) return <div className="ck-msg ok" role="status"><b>Booked.</b> {msg.text}</div>;
  if (!slots.length) return <div className="ck-msg err">No open times in the next two weeks. Reply to the email and we’ll find one.</div>;
  const days = new Map<string, { iso: string; label: string }[]>();
  for (const s of slots) { const d = s.label.split(',').slice(0, 2).join(','); days.set(d, [...(days.get(d) ?? []), s]); }
  return (
    <div className="ck-form">
      {[...days].map(([day, list]) => (
        <div key={day} className="ck-item">
          <b>{day}</b>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {list.map((s) => <button key={s.iso} type="button" className={'btn' + (pick === s.iso ? ' primary' : '')} aria-pressed={pick === s.iso} onClick={() => setPick(s.iso)}>{s.label.split(', ').at(-1)}</button>)}
          </div>
        </div>
      ))}
      {msg && !msg.ok ? <p className="ck-msg err" role="alert">{msg.text}</p> : null}
      <button className="btn primary" type="button" disabled={!pick || busy} onClick={async () => {
        setBusy(true);
        const r = await fetch(`/api/book/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ iso: pick }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'We couldn’t reach Genovus. Please try again.' }));
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      }}>{busy ? 'Booking…' : pick ? `Book ${slots.find((s) => s.iso === pick)?.label}` : 'Pick a time above'}</button>
    </div>
  );
}
