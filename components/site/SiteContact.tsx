'use client';
// The site's contact form: a callback request, and on Growth and Premium a consult time picked from the office's
// open times (the office confirms it). The visitor's consent is the exact sentence shown; nothing sends without it.
import { useEffect, useRef, useState } from 'react';

type Slot = { iso: string; label: string };

export function SiteContact({ slug, agency, booking, lines, k, topic }: { slug: string; agency: string; booking: boolean; lines: string[]; k?: string; topic?: string }) {
  const started = useRef(Date.now());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!booking) return;
    fetch(`/api/site/${slug}/slots${k ? `?k=${encodeURIComponent(k)}` : ''}`).then((r) => r.json()).then((j) => setSlots(j.slots ?? [])).catch(() => setSlots([]));
  }, [booking, slug, k]);
  const consent = `I agree that ${agency} may contact me about this request.`;
  if (done) return <div className="ag-form ag-done" role="status"><b>Thank you!</b><p>{done}</p></div>;
  return (
    <form className="ag-form" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      const f = new FormData(e.currentTarget);
      const body = Object.fromEntries(['name', 'phone', 'email', 'topic', 'message', 'slot', 'website'].map((x) => [x, String(f.get(x) ?? '')]));
      const r = await fetch(`/api/site/${slug}/lead${k ? `?k=${encodeURIComponent(k)}` : ''}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, consent: f.get('consent') === 'yes', ms: Date.now() - started.current }) })
        .then((x) => x.json()).catch(() => ({ ok: false, error: 'We couldn’t send that. Please call the office instead.' }));
      setBusy(false);
      if (r.ok) setDone(r.message); else setErr(r.error);
    }}>
      <h2>{booking ? 'Book a time or ask for a call' : 'Ask for a call back'}</h2>
      <div className="ag-row">
        <label><span>Your name</span><input name="name" required maxLength={120} autoComplete="name" /></label>
        <label><span>Phone</span><input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label>
      </div>
      <label><span>Email (optional)</span><input name="email" type="email" maxLength={200} autoComplete="email" /></label>
      <label><span>What can we help with?</span>
        <select name="topic" defaultValue={topic ?? ''}>
          <option value="">Choose one</option>
          {lines.map((l) => <option key={l} value={l}>{l} insurance</option>)}
          <option value="Something else">Something else</option>
        </select>
      </label>
      {booking ? (
        <label><span>Pick a time to talk (optional)</span>
          <select name="slot" defaultValue="">
            <option value="">Just call me back</option>
            {slots.map((s) => <option key={s.iso} value={s.iso}>{s.label}</option>)}
          </select>
        </label>
      ) : null}
      <label><span>Anything else? (optional)</span><textarea name="message" rows={3} maxLength={1000} /></label>
      <input className="ag-hp" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <label className="ag-consent"><input type="checkbox" name="consent" value="yes" required /> {consent}</label>
      {err ? <p className="ag-err" role="alert">{err}</p> : null}
      <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
    </form>
  );
}
