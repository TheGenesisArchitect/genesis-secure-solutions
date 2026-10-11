'use client';
// Ask Helix for an agency: a chat grounded in the agency's live data. Suggested questions to start; Helix's
// proposed follow-ups add to the calendar with one tap; drafts copy to send yourself (Helix never sends). The same
// chat runs on the Ask Helix page and in the drawer every page opens, where `context` says what the agent is
// looking at (a page, a lead, a partner) and `start` asks the first question straight away.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addFollowUp } from '@/lib/actions';

type Turn = { role: 'user' | 'helix'; text: string; followUps?: { who: string; reason: string; due: string; at: string }[]; drafts?: { to: string; channel: string; body: string }[] };
const SUGGEST = ['Who needs a call today?', 'Where did my leads come from this month?', 'Draft a text to my newest lead', 'What’s on my calendar this week?', 'Which leads are going cold?'];
const toast = (r: { ok?: string; err?: string } | null) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } })); };

export function AskHelixAgency({ slug, tenantId, context, suggest = SUGGEST, start, compact }: { slug: string; tenantId: string; context?: string; suggest?: string[]; start?: string; compact?: boolean }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'user', text }]);
    setQ(''); setBusy(true);
    const r = await fetch('/api/helix/agency', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, history, question: text, context }) }).then(async (x) => ({ okay: x.ok, j: await x.json().catch(() => ({})) }));
    setBusy(false);
    setTurns((t) => [...t, r.okay ? { role: 'helix', text: r.j.answer, followUps: r.j.followUps, drafts: r.j.drafts } : { role: 'helix', text: r.j.error ?? 'Helix couldn’t answer just now.' }]);
    setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  };
  const started = useRef(false);
  useEffect(() => { if (start && !started.current) { started.current = true; void ask(start); } }); // eslint-disable-line react-hooks/exhaustive-deps
  const addFu = async (f: { who: string; reason: string; due: string; at: string }) => {
    const fd = new FormData();
    fd.set('tenant', tenantId); fd.set('who', f.who); fd.set('reason', f.reason); fd.set('due', f.due); fd.set('at', f.at);
    toast(await addFollowUp(null, fd));
    router.refresh();
  };
  return (
    <div className={'helix-chat' + (compact ? ' compact' : '')}>
      {!turns.length && !start ? (
        <div className="helix-hello">
          <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
          <div><b>Ask Helix about your business.</b><p className="muted" style={{ margin: 0 }}>Helix knows your leads, calls, partners, calendar and market. It drafts, you send. It never quotes or gives coverage advice.</p></div>
        </div>
      ) : null}
      <div className="helix-turns">
        {turns.map((t, i) => (
          <div key={i} className={`helix-turn ${t.role}`}>
            <p>{t.text}</p>
            {t.followUps?.map((f, j) => (
              <div key={j} className="helix-card"><span><b>Follow-up:</b> {f.who} · {f.due} {f.at}{f.reason ? ` · ${f.reason}` : ''}</span><button className="btn small primary" type="button" onClick={() => addFu(f)}>Add</button></div>
            ))}
            {t.drafts?.map((d, j) => (
              <div key={j} className="helix-card draft"><span className="muted" style={{ fontSize: 12 }}>Draft {d.channel} to {d.to || 'the lead'} · you send it</span><p style={{ margin: 0 }}>{d.body}</p><button className="btn small" type="button" onClick={() => navigator.clipboard.writeText(d.body).then(() => toast({ ok: 'Draft copied.' }), () => toast({ err: 'Copy failed: select the text instead.' }))}>Copy</button></div>
            ))}
          </div>
        ))}
        {busy ? <div className="helix-turn helix"><p className="muted">Helix is looking…</p></div> : null}
        <div ref={end} />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{suggest.map((s) => <button key={s} className="btn small ghost" type="button" disabled={busy} onClick={() => ask(s)}>{s}</button>)}</div>
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your leads, calendar or results" aria-label="Ask Helix" style={{ flex: 1, minWidth: 0 }} maxLength={1000} />
        <button className="btn primary" type="submit" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  );
}
