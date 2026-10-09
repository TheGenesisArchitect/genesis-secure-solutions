'use client';
// Chapter 10: Helix Live. A sample session plays out: the morning briefing (spoken), the owner's request,
// and the actions it takes through HAP: auto (done), queued (digest) and required (waits for a tap).
// Prompt chips replay scripted answers. Sample data only; a real briefing's figures come from queries.
import { useEffect, useRef, useState } from 'react';

type Msg = { who: 'helix' | 'you'; text: string; time?: string };
type Lane = 'auto' | 'queued' | 'required';
type Act = { id: string; title: string; detail: string; lane: Lane; state: 'pending' | 'done' | 'queued' | 'waiting' | 'confirmed' };

const SCRIPT: Msg[] = [
  { who: 'helix', time: '7:02 AM', text: 'Morning. Three things. Columbus organic engagement is up 41% on its own four-week baseline, mostly from episode 2 of The Local Office. Phenix City is flat on a small sample, so I’m not reading anything into it yet. And 18 high-fit Columbus offices engaged this week but haven’t had a call.' },
  { who: 'you', text: 'Build Thursday’s call list from the hottest market, set a Zoom with the team to review it, and start the storyboard for episode 3.' },
  { who: 'helix', text: 'Two are done. The storyboard is queued because it reserves Studio budget, and one thing needs you: the Bright Path office asked for a demo, and an invite to someone outside Genovus needs your confirmation.' },
];
const ACTS: Act[] = [
  { id: 'a1', title: 'Call list · Columbus', detail: '18 offices ranked by fit and warm signal, Do Not Call checked', lane: 'auto', state: 'pending' },
  { id: 'a2', title: 'Zoom · team review', detail: 'Thu 10:00, internal only (standing rule)', lane: 'auto', state: 'pending' },
  { id: 'a3', title: 'Storyboard · The Local Office ep. 3', detail: 'Reserves an estimated $120–$180, within the ceiling', lane: 'queued', state: 'pending' },
  { id: 'a4', title: 'Zoom · Bright Path demo', detail: 'Invite to an external contact', lane: 'required', state: 'pending' },
];
const ASK: Record<string, string> = {
  'What’s hot?': 'Columbus leads at heat 86 with high confidence (214 conversations). Atlanta is 71, medium confidence. Macon is 58 on a low sample. Phenix City isn’t ranked yet: only 11 conversations.',
  'Rescan Columbus.': 'Done: a Radar sweep of Columbus found 3 new offices and 1 closure. Cost $0.41 against the monthly Places budget ($38 of $150 used).',
  'How are your calls doing?': 'Of my last 20 market recommendations, 13 beat baseline. The misses were all low-sample markets, so I’m keeping the 20% exploration share where it is.',
  'Move ad budget to Columbus.': 'I can’t do that on my own: moving ad spend is always a required action. Columbus has cleared its paid gate, so I’ve drafted a $500, 14-day LinkedIn test for you to approve.',
};
const LANE_LABEL: Record<Lane, string> = { auto: 'AUTO', queued: 'QUEUED', required: 'REQUIRED' };

export function HelixLive() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [acts, setActs] = useState<Act[]>(ACTS);
  const [speaking, setSpeaking] = useState(false);
  const [typing, setTyping] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const fast = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const later = (ms: number, f: () => void) => { timers.current.push(setTimeout(f, fast ? 20 : ms)); };
  const log = useRef<HTMLDivElement>(null);

  const play = () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    setMsgs([]); setActs(ACTS); setTyping(true);
    later(900, () => { setTyping(false); setSpeaking(true); setMsgs([SCRIPT[0]]); });
    later(4200, () => { setSpeaking(false); setMsgs((m) => [...m, SCRIPT[1]]); setTyping(true); });
    later(5600, () => setActs((a) => a.map((x) => (x.id === 'a1' ? { ...x, state: 'done' } : x))));
    later(6400, () => setActs((a) => a.map((x) => (x.id === 'a2' ? { ...x, state: 'done' } : x))));
    later(7100, () => setActs((a) => a.map((x) => (x.id === 'a3' ? { ...x, state: 'queued' } : x.id === 'a4' ? { ...x, state: 'waiting' } : x))));
    later(7600, () => { setTyping(false); setSpeaking(true); setMsgs((m) => [...m, SCRIPT[2]]); });
    later(10200, () => setSpeaking(false));
  };
  useEffect(() => { play(); return () => timers.current.forEach(clearTimeout); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }); }, [msgs, typing]);

  const ask = (q: string) => {
    setMsgs((m) => [...m, { who: 'you', text: q }]); setTyping(true);
    later(1100, () => { setTyping(false); setSpeaking(true); setMsgs((m) => [...m, { who: 'helix', text: ASK[q] }]); });
    later(3600, () => setSpeaking(false));
  };
  const confirm = (id: string) => setActs((a) => a.map((x) => (x.id === id ? { ...x, state: 'confirmed' } : x)));

  return (
    <div className="vgrid2" style={{ gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)' }}>
      <div className="hx">
        <div className="hx-head">
          <span className={'hx-orb' + (speaking ? ' on' : '')} aria-hidden="true"><i /><i /><i /></span>
          <span><b>Helix</b><small>{speaking ? 'Speaking · interrupt any time' : typing ? 'Thinking…' : 'Listening'}</small></span>
          <span className="chip sample" style={{ marginLeft: 'auto' }}>Sample session</span>
        </div>
        <div className="hx-log" ref={log} aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={'hx-msg ' + m.who}>
              <small>{m.who === 'helix' ? `Helix${m.time ? ` · ${m.time}` : ''}` : 'You'}</small>{m.text}
            </div>
          ))}
          {typing ? <div className="hx-msg helix typing" aria-label="Helix is thinking"><i /><i /><i /></div> : null}
        </div>
        <div className="hx-asks">
          {Object.keys(ASK).map((q) => <button key={q} className="btn small ghost" onClick={() => ask(q)}>{q}</button>)}
          <button className="btn small" onClick={play}>Replay the briefing ↺</button>
        </div>
      </div>
      <div className="grid" style={{ alignContent: 'start' }}>
        <div className="panel" style={{ padding: 16, display: 'grid', gap: 8 }}>
          <b>What Helix did</b>
          {acts.map((a) => (
            <div key={a.id} className={'hx-act ' + a.lane} data-state={a.state}>
              <span className="hx-dot" />
              <span style={{ minWidth: 0 }}><b>{a.title}</b><small>{a.detail}</small></span>
              {a.state === 'waiting' ? <button className="btn small primary" onClick={() => confirm(a.id)}>Confirm</button>
                : <span className={'hx-lane ' + a.lane}>{a.state === 'pending' ? '…' : a.state === 'done' ? 'Auto · done' : a.state === 'queued' ? 'Queued · digest' : a.state === 'confirmed' ? 'Confirmed · sealed' : LANE_LABEL[a.lane]}</span>}
            </div>
          ))}
        </div>
        <div className="panel" style={{ padding: 16, display: 'grid', gap: 8, fontSize: 13 }}>
          <b>Guardrails</b>
          <span><b>Voice proposes, the screen confirms.</b> A spoken yes is enough for queued work; required actions need a tap or a signed Slack or Telegram approval.</span>
          <span><b>Outside content is data.</b> Web pages, ad text and inbound email can never trigger a tool.</span>
          <span><b>Every action is traceable.</b> Each tool call is logged with its session and mission; one switch pauses every agent.</span>
        </div>
      </div>
    </div>
  );
}
