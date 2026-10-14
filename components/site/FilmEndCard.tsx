'use client';
// The homepage film with a clickable end card: when the film ends, Helix's promise and the three packages appear as
// real buttons into the tour (no prices). Replay is one tap.
import { useRef, useState } from 'react';
import Link from 'next/link';

const PACKAGES = [
  { plan: 'launch', name: 'Launch', line: 'Get found. Answer every lead.' },
  { plan: 'growth', name: 'Growth', line: 'Helix joins your team.' },
  { plan: 'premium', name: 'Premium', line: 'Run it hands-free.' },
];

export function FilmEndCard({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  const replay = () => { const v = ref.current; if (!v) return; setEnded(false); v.currentTime = 0; v.play().catch(() => {}); };
  return (
    <div className="film-end">
      <video ref={ref} className="film-frame" controls playsInline preload="metadata" poster={poster} src={src} onEnded={() => setEnded(true)} onPlay={() => setEnded(false)}>
        Your browser can’t play this film.
      </video>
      {ended ? (
        <div className="film-end-card" role="dialog" aria-label="Take the tour with Helix">
          <b>Helix: the agent that knows and grows with your business.</b>
          <span className="film-end-ask">Take the tour</span>
          <div className="film-end-pk">
            {PACKAGES.map((p) => (
              <Link key={p.plan} href={`/tour?plan=${p.plan}`}><b>{p.name}</b><small>{p.line}</small><i>Tour {p.name} →</i></Link>
            ))}
          </div>
          <button type="button" className="btn small ghost" onClick={replay}>↺ Watch again</button>
        </div>
      ) : null}
    </div>
  );
}
