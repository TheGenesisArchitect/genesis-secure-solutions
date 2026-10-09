'use client';
// Chapter 7: the next best call. The brief, then a CallRail-tracked call (simulated): ringing, a live
// transcript, an AI summary with a suggested outcome, and one tap to log it and book the consult.
import { useEffect, useRef, useState } from 'react';

type Props = { office: string; carrier: string; market: string; fit: number; local: string; reasons: string[]; hook: string; opener: string; never: string[] };
const LINES: [string, string][] = [
  ['Anthony', 'Hi, this is Anthony with Genovus in Columbus. Do you have a minute?'],
  ['Office', 'Sure, what’s this about?'],
  ['Anthony', 'We help local agents get found online, built to your carrier’s rules. You might have seen our “neighbors are searching” post this week.'],
  ['Office', 'I did, actually. We only have the carrier page right now.'],
  ['Anthony', 'That’s exactly who we help. Could I show you what Columbus searches for in 15 minutes, Tuesday at 10?'],
  ['Office', 'Tuesday at 10 works.'],
];

export function CallSim(p: Props) {
  const [phase, setPhase] = useState<'brief' | 'ringing' | 'live' | 'ended' | 'logged'>('brief');
  const [shown, setShown] = useState(0);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fast = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const call = () => {
    setPhase('ringing'); setShown(0);
    t.current = setTimeout(() => {
      setPhase('live');
      let n = 0;
      const step = () => { n++; setShown(n); if (n < LINES.length) t.current = setTimeout(step, fast ? 30 : 1300); else t.current = setTimeout(() => setPhase('ended'), fast ? 30 : 900); };
      step();
    }, fast ? 30 : 1800);
  };
  return (
    <div className="vgrid2" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
      <div className="callcard" data-tour="call-card">
        <div className="spread"><div><span className="v-eyebrow">Next best call · {p.market}</span><h2 style={{ margin: '4px 0 0', font: '800 22px var(--display)' }}>{p.office}</h2><span className="muted">{p.carrier} · fit {p.fit}/100 · {p.local} local · good time to call</span></div><span className="chip sample">Sample</span></div>
        <div><b style={{ fontSize: 13 }}>Why this office</b><ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 14, display: 'grid', gap: 4 }}>{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul></div>
        <div className="check pass"><span>↗</span><span><b style={{ color: 'var(--ink)' }}>Warm signal:</b> {p.hook}</span></div>
        <div><b style={{ fontSize: 13 }}>Opener</b><p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--soft)' }}>“{p.opener}”</p></div>
        {phase === 'brief' ? <button className="btn primary" onClick={call} data-tour-action="place_call" style={{ justifySelf: 'start' }}>Call through CallRail</button> : null}
        {phase === 'ringing' ? <div className="ringing"><span className="wave">✆</span><span><b>Calling…</b><br /><span className="muted" style={{ fontSize: 13 }}>Local Columbus number · tracked to campaign “columbus-organic”</span></span></div> : null}
        {phase === 'live' || phase === 'ended' || phase === 'logged' ? (
          <div className="panel" style={{ padding: 14, display: 'grid', gap: 8 }}>
            <div className="spread"><b>{phase === 'live' ? '● Live · recording (one-party state)' : 'Call ended · 4:12'}</b><span className="chip info">CallRail</span></div>
            <div className="transcript">{LINES.slice(0, shown).map(([w, l], i) => <p key={i}><span className="who">{w}</span>{l}</p>)}</div>
          </div>
        ) : null}
        {phase === 'ended' ? (
          <div className="check pass" style={{ display: 'grid', gap: 8 }}>
            <span><b style={{ color: 'var(--ink)' }}>Summary (Call Desk agent):</b> Owner uses only the carrier page; interested; agreed to a 15-minute consult Tuesday 10:00.</span>
            <span><b style={{ color: 'var(--ink)' }}>Suggested outcome:</b> Booked a consult · Tue Oct 13, 10:00 AM</span>
            <button className="btn primary small" style={{ justifySelf: 'start' }} onClick={() => setPhase('logged')} data-tour-action="log_call">Log it and book the consult</button>
          </div>
        ) : null}
        {phase === 'logged' ? <div className="check pass"><span>✓</span><span><b style={{ color: 'var(--ink)' }}>Logged.</b> Status → Consult booked. On the calendar Tue 10:00 with a confirmation email sent. Sealed in the audit chain.</span></div> : null}
        {phase !== 'brief' ? <button className="btn ghost small" style={{ justifySelf: 'start' }} onClick={() => { if (t.current) clearTimeout(t.current); setPhase('brief'); }}>Replay ↺</button> : null}
      </div>
      <div className="grid" style={{ alignContent: 'start' }}>
        <div className="panel" data-tour="up-next" style={{ padding: 16, display: 'grid', gap: 8 }}>
          <b>Up next</b>
          {[['Riverwalk Insurance (Sample)', 'Allstate · fit 91'], ['Main St Family Agency (Sample)', 'Independent · fit 89'], ['Midland Office (Sample)', 'Georgia Farm Bureau · fit 88']].map(([n, d]) => (
            <div key={n} className="spread" style={{ fontSize: 14 }}><span>{n}</span><span className="muted">{d}</span></div>
          ))}
        </div>
        <div className="panel" data-tour="never" style={{ padding: 16, display: 'grid', gap: 8 }}>
          <b>Never on a call</b>
          {p.never.map((n) => <span key={n} style={{ fontSize: 14 }}>✕ {n}</span>)}
        </div>
        <div className="tile"><span className="label">Today</span><span className="value num">14 calls · 3 consults</span><span className="hint">Columbus call block · 2 callers <b className="chip sample" style={{ padding: '1px 6px' }}>Sample</b></span></div>
      </div>
    </div>
  );
}
