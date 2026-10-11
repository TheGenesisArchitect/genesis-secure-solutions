'use client';
// Record what a source cost this month (ad spend, a mailer, a sponsorship) so cost per lead is real.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setSourceCost } from '@/lib/growth-actions';

export function SourceCostForm({ tenantId, sources }: { tenantId: string; sources: string[] }) {
  const router = useRouter();
  const [source, setSource] = useState(sources[0] ?? 'facebook');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={async (e) => {
      e.preventDefault(); setBusy(true);
      const r = await setSourceCost(tenantId, source, Number(amount));
      setBusy(false); window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } }));
      if (r.ok) { setAmount(''); router.refresh(); }
    }}>
      <label className="field"><span>Source</span>
        <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>{[...new Set([...sources, 'facebook', 'google', 'mailer', 'event'])].map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </label>
      <label className="field"><span>Spent this month ($)</span><input className="input" type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} required style={{ width: 140 }} /></label>
      <button className="btn small" type="submit" disabled={busy}>Save</button>
    </form>
  );
}
