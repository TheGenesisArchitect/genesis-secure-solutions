'use client';
// Chapter 5: an episode's storyboard renders shot by shot through the provider adapter (model per shot),
// with approve / regenerate per frame. Purely illustrative: frames are drawn, not generated.
import { useEffect, useState } from 'react';
import { SceneArt, SHOT_SCENES } from './SceneArt';
import type { Shot } from '@/data/vision';

export function Storyboard({ shots }: { shots: Shot[] }) {
  const [done, setDone] = useState(0);
  const [approved, setApproved] = useState<Record<number, boolean>>({});
  const [regen, setRegen] = useState<number | null>(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setDone(shots.length); return; }
    let n = 0;
    const t = setInterval(() => { n++; setDone(n); if (n >= shots.length) clearInterval(t); }, 900);
    return () => clearInterval(t);
  }, [shots.length]);
  const redo = (n: number) => { setRegen(n); setApproved((a) => ({ ...a, [n]: false })); setTimeout(() => setRegen(null), 1600); };
  return (
    <div className="vboard">
      {shots.map((s, i) => {
        const generating = i >= done || regen === s.n;
        return (
          <figure key={s.n} className="vshot" style={{ margin: 0 }}>
            <SceneArt scene={SHOT_SCENES[i % SHOT_SCENES.length]} label={s.desc} />
            {generating ? <div className="gen">Generating · {s.model}</div> : null}
            <figcaption>
              <div className="spread"><b>Shot {s.n} · {s.secs}s</b><span className="chip ai" style={{ padding: '3px 7px' }}>{s.model}</span></div>
              <span>{s.desc}</span>
              <span className="muted">{s.camera}</span>
              {!generating ? (
                <span className="row" style={{ gap: 6 }}>
                  <button className={'btn small' + (approved[s.n] ? ' good' : '')} onClick={() => setApproved((a) => ({ ...a, [s.n]: !a[s.n] }))}>{approved[s.n] ? '✓ Approved' : 'Approve'}</button>
                  <button className="btn small ghost" onClick={() => redo(s.n)}>Regenerate</button>
                </span>
              ) : null}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
