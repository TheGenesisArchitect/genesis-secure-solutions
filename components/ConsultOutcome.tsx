'use client';
// How the consultation went, in one tap (the same record as the Command Brief card; feeds show and close rates).
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const toast = (r: { ok?: string; err?: string }) => window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
const CHOICES: [string, string][] = [['showed', 'They showed'], ['no_show', 'No-show'], ['rescheduled', 'Rescheduled']];

export function ConsultOutcome({ invite, current }: { invite: string; current: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const pick = async (outcome: string) => {
    setBusy(outcome);
    const r = await fetch('/api/consult-outcome', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ invite, outcome }) }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Couldn’t reach Genovus.' }));
    setBusy('');
    toast(r.ok ? { ok: r.message ?? 'Saved.' } : { err: r.error ?? 'Couldn’t save that.' });
    if (r.ok) router.refresh();
  };
  return (
    <div className="row" style={{ flexWrap: 'wrap' }} data-helix-group="Consult outcome">
      {CHOICES.map(([k, label]) => (
        <button key={k} type="button" className={`btn small${current === k ? ' primary' : ''}`} aria-pressed={current === k} disabled={Boolean(busy)} onClick={() => pick(k)}>{busy === k ? 'Saving…' : label}</button>
      ))}
    </div>
  );
}
