'use client';
// The Studio's screening player: press play on a finished scene (or the whole cut so far) and it opens full screen,
// streaming-service style. A list of clips plays back to back; Esc or the backdrop closes it.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type Clip = { src: string; title: string; poster?: string };
const EVT = 'genovus:screen';
/** Open the player from anywhere (a card's play button, the hero's Play). */
export const screen = (clips: Clip[], start = 0) => window.dispatchEvent(new CustomEvent(EVT, { detail: { clips, start } }));

export function PlayButton({ clips, start = 0, label, big }: { clips: Clip[]; start?: number; label?: string; big?: boolean }) {
  if (!clips.length) return null;
  return big
    ? <button type="button" className="sp-play" aria-label={label ?? `Play ${clips[start]?.title ?? ''}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); screen(clips, start); }}><span aria-hidden="true">▶</span></button>
    : <button type="button" className="sx-btn play" onClick={() => screen(clips, start)}>▶ {label ?? 'Play'}</button>;
}

export function ScenePlayer() {
  const [s, setS] = useState<{ clips: Clip[]; i: number } | null>(null);
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const open = (e: Event) => { const d = (e as CustomEvent).detail as { clips: Clip[]; start: number }; if (d?.clips?.length) setS({ clips: d.clips, i: d.start ?? 0 }); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setS(null); };
    window.addEventListener(EVT, open); window.addEventListener('keydown', key);
    return () => { window.removeEventListener(EVT, open); window.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => { ref.current?.play().catch(() => {}); }, [s?.i, s?.clips]);
  if (!s) return null;
  const c = s.clips[s.i];
  return createPortal(
    <div className="sp-back" role="dialog" aria-label={`Playing ${c.title}`} onClick={() => setS(null)}>
      <div className="sp-box" onClick={(e) => e.stopPropagation()}>
        <video ref={ref} key={c.src} src={c.src} poster={c.poster} controls autoPlay playsInline onEnded={() => setS((x) => (x && x.i + 1 < x.clips.length ? { ...x, i: x.i + 1 } : x))} />
        <div className="sp-bar">
          <span><b>{c.title}</b>{s.clips.length > 1 ? <small> · {s.i + 1} of {s.clips.length}</small> : null}</span>
          <span className="row" style={{ gap: 6 }}>
            {s.clips.length > 1 ? <><button className="btn small ghost" type="button" disabled={s.i === 0} onClick={() => setS({ ...s, i: s.i - 1 })}>‹ Prev</button><button className="btn small ghost" type="button" disabled={s.i + 1 >= s.clips.length} onClick={() => setS({ ...s, i: s.i + 1 })}>Next ›</button></> : null}
            <button className="btn small" type="button" onClick={() => setS(null)} aria-label="Close the player">✕</button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
