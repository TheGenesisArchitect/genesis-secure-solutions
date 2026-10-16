'use client';
// Ask Helix for an agency: a chat grounded in the agency's live data. Suggested questions to start; Helix's
// proposed follow-ups add to the calendar with one tap; drafts copy to send yourself (Helix never sends). The same
// chat runs on the Ask Helix page and in the drawer every page opens, where `context` says what the agent is
// looking at (a page, a lead, a partner) and `start` asks a question straight away (`startN` counts the asks). The
// drawer and the full page share one thread (HelixHost), so the conversation carries on as you move between pages.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addFollowUp } from '@/lib/actions';
import { HelixActCard, useHelixThread } from './HelixHost';

const SUGGEST = ['Who needs a call today?', 'Where did my leads come from this month?', 'Draft a text to my newest lead', 'What’s on my calendar this week?', 'Which leads are going cold?'];
const toast = (r: { ok?: string; err?: string } | null) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } })); };

export function AskHelixAgency({ slug, tenantId, context, suggest = SUGGEST, start, startN = 0, page, compact }: { slug: string; tenantId: string; context?: string; suggest?: string[]; start?: string; startN?: number; page?: string; compact?: boolean }) {
  const router = useRouter();
  const { turns, setTurns, asked, threadId, setThreadId, restored, disclosure, act } = useHelixThread();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    setTurns((t) => [...t, { role: 'user', text, page }]);
    setQ(''); setBusy(true);
    // The server reads the saved thread (not history from the browser) and saves both turns to it.
    const r = await fetch('/api/helix/agency', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, threadId, question: text, context, page }) })
      .then(async (x) => ({ okay: x.ok, j: await x.json().catch(() => ({})) }), () => ({ okay: false, j: {} as Record<string, string> }));
    setBusy(false);
    if (r.j.threadId) setThreadId(r.j.threadId);
    // Helix was asked to open a page: go there now (only on a fresh answer; it's never saved, so a reload won't replay it).
    if (r.okay && r.j.go?.href) router.push(r.j.go.href);
    // Helix proposed a change: show it for a yes (one tap); nothing happens until then.
    if (r.okay && r.j.proposal) act?.show(r.j.proposal);
    setTurns((t) => [...t, r.okay ? { role: 'helix', page, text: r.j.answer, noted: r.j.noted, followUps: r.j.followUps, drafts: r.j.drafts, savedNote: r.j.savedNote } : { role: 'helix', page, text: r.j.error ?? 'Helix couldn’t answer just now.' }]);
    setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  };
  // Each "Ask Helix" button press asks once, adding to the thread.
  useEffect(() => { if (start && startN && asked.current !== startN) { asked.current = startN; void ask(start); } }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, []);
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
        {restored ? <div className="helix-moved">Picked up where you left off</div> : null}
        {turns.map((t, i) => (<div key={i} style={{ display: 'contents' }}>
          {i > 0 && t.role === 'user' && t.page && turns[i - 1].page && t.page !== turns[i - 1].page ? <div className="helix-moved">→ {t.page}</div> : null}
          <div className={`helix-turn ${t.role}`}>
            <p>{t.channel === 'voice' ? <span className="helix-spoken">Spoken</span> : null}{t.text}</p>
            {t.noted ? <span className="chip info" style={{ justifySelf: 'start' }}>Sent to the Genovus team</span> : null}
            {t.savedNote ? <Link className="chip info" href={t.savedNote.href} style={{ justifySelf: 'start' }}>{t.savedNote.kind === 'question' ? 'Sent to the Genovus team' : 'In Helix notes'} · Open</Link> : null}
            {t.followUps?.map((f, j) => (
              <div key={j} className="helix-card"><span><b>Follow-up:</b> {f.who} · {f.due} {f.at}{f.reason ? ` · ${f.reason}` : ''}</span><button className="btn small primary" type="button" onClick={() => addFu(f)}>Add</button></div>
            ))}
            {t.drafts?.map((d, j) => (
              <div key={j} className="helix-card draft"><span className="muted" style={{ fontSize: 12 }}>Draft {d.channel} to {d.to || 'the lead'} · you send it</span><p style={{ margin: 0 }}>{d.body}</p><button className="btn small" type="button" onClick={() => navigator.clipboard.writeText(d.body).then(() => toast({ ok: 'Draft copied.' }), () => toast({ err: 'Copy failed: select the text instead.' }))}>Copy</button></div>
            ))}
          </div>
        </div>))}
        {busy ? <div className="helix-turn helix"><p className="muted">Helix is looking…</p></div> : null}
        <div ref={end} />
      </div>
      {act?.pending ? <HelixActCard page={page} /> : null}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{suggest.map((s) => <button key={s} className="btn small ghost" type="button" disabled={busy} onClick={() => ask(s)}>{s}</button>)}</div>
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about your leads, calendar or results" aria-label="Ask Helix" style={{ flex: 1, minWidth: 0 }} maxLength={1000} />
        <button className="btn primary" type="submit" disabled={busy || !q.trim()}>Ask</button>
      </form>
      {disclosure ? <p className="muted helix-saved">{disclosure}</p> : null}
    </div>
  );
}
