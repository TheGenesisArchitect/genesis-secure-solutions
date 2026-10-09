'use client';
// Chapter 3: a mission runs. One batch approval starts it; Lane 1–2 steps run and seal into the audit chain;
// any Lane 3 step (publish, spend, send) stops and waits for a person, then the mission continues.
import { useEffect, useRef, useState } from 'react';
import type { Step } from '@/data/vision';

type State = 'queued' | 'running' | 'sealed' | 'waiting';
const LANE = { 1: 'LANE 1 · AUTO', 2: 'LANE 2 · TEAM', 3: 'LANE 3 · PERSON' } as const;

export function MissionRun({ title, goal, budget, forecast, steps }: { title: string; goal: string; budget: string; forecast: string; steps: Step[] }) {
  const [phase, setPhase] = useState<'plan' | 'running' | 'done'>('plan');
  const [states, setStates] = useState<Record<string, State>>(() => Object.fromEntries(steps.map((s) => [s.id, 'queued'])));
  const [seals, setSeals] = useState<Record<string, number>>({});
  const [chain, setChain] = useState(1031);
  const cursor = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fast = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const advance = () => {
    const i = cursor.current;
    if (i >= steps.length) { setPhase('done'); return; }
    const s = steps[i];
    if (s.lane === 3) { setStates((x) => ({ ...x, [s.id]: 'waiting' })); return; } // stop for a person
    setStates((x) => ({ ...x, [s.id]: 'running' }));
    timer.current = setTimeout(() => seal(s.id), fast ? 50 : 1100);
  };
  const seal = (id: string) => {
    setChain((c) => { const n = c + 1; setSeals((x) => ({ ...x, [id]: n })); return n; });
    setStates((x) => ({ ...x, [id]: 'sealed' }));
    cursor.current += 1;
    timer.current = setTimeout(advance, fast ? 50 : 450);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const start = () => { setPhase('running'); cursor.current = 0; advance(); };
  const confirm = (id: string) => { setStates((x) => ({ ...x, [id]: 'running' })); timer.current = setTimeout(() => seal(id), fast ? 50 : 900); };
  const reset = () => { if (timer.current) clearTimeout(timer.current); cursor.current = 0; setPhase('plan'); setSeals({}); setChain(1031); setStates(Object.fromEntries(steps.map((s) => [s.id, 'queued']))); };
  const sealed = Object.values(states).filter((s) => s === 'sealed').length;

  return (
    <div className="vgrid2" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }}>
      <div className="panel" style={{ padding: 18, display: 'grid', gap: 14 }}>
        <div className="spread" style={{ alignItems: 'flex-start' }}>
          <div><span className="v-eyebrow">Mission</span><h2 style={{ margin: '4px 0 0', font: '800 22px var(--display)' }}>{title}</h2><p className="muted" style={{ margin: '4px 0 0' }}>{goal}</p></div>
          {phase === 'plan' ? <button className="btn primary" onClick={start}>Approve mission (one batch)</button>
            : phase === 'done' ? <button className="btn" onClick={reset}>Replay ↺</button>
            : <span className="chip info">Running · {sealed}/{steps.length}</span>}
        </div>
        <div className="mission">
          {steps.map((s, i) => {
            const st = states[s.id];
            return (
              <div key={s.id} className="mstep" data-state={st}>
                <span className="dot">{st === 'sealed' ? '✓' : i + 1}</span>
                <span><b>{s.title}</b><small>{s.detail} · {s.agent} agent</small>
                  {st === 'sealed' ? <span className="seal" style={{ display: 'block' }}>Sealed in the audit chain · #{seals[s.id]?.toLocaleString('en-US')}</span> : null}
                </span>
                <span style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                  <span className={`vlane l${s.lane}`}>{LANE[s.lane]}</span>
                  {st === 'waiting' ? <button className="btn small primary" onClick={() => confirm(s.id)}>Confirm publish</button> : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="grid" style={{ alignContent: 'start' }}>
        <div className="tile"><span className="label">Audit chain</span><span className="value num">#{chain.toLocaleString('en-US')}</span><span className="hint">Every step sealed with the mission’s ID; nothing runs outside the chain.</span></div>
        <div className="tile"><span className="label">Mission budget</span><span className="value" style={{ fontSize: 20 }}>{budget}</span><span className="hint">Steps that would exceed it stop and ask.</span></div>
        <div className="tile"><span className="label">If it works</span><span className="value" style={{ fontSize: 18 }}>{forecast}</span></div>
        <div className="panel" style={{ padding: 16, display: 'grid', gap: 8, fontSize: 13 }}>
          <b>The three lanes</b>
          <span><span className="vlane l1">LANE 1</span> Reads and checks run on their own.</span>
          <span><span className="vlane l2">LANE 2</span> Internal work runs after the one batch approval.</span>
          <span><span className="vlane l3">LANE 3</span> Anything public or paid always stops for a named person, even inside an approved mission.</span>
        </div>
      </div>
    </div>
  );
}
