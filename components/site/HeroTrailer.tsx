'use client';
// The homepage trailer: full-bleed behind the headline, muted and looping like a title sequence. One tap plays it
// from the top with sound. It pauses when scrolled away, loads the 720p cut on phones, and holds on the poster for
// people who prefer reduced motion (they can still press play).
import { useEffect, useRef, useState } from 'react';

const SRC = { full: '/site/genovus-trailer.mp4', phone: '/site/genovus-trailer-720.mp4', poster: '/site/genovus-trailer-poster.jpg' };

export function HeroTrailer() {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const phone = window.matchMedia('(max-width: 760px)').matches;
    const save = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    setSrc(phone || save ? SRC.phone : SRC.full);
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!still) v.play().catch(() => {});
    // Pause off-screen; resume (muted loop or the sound cut) when it comes back.
    const io = new IntersectionObserver(([e]) => { if (!e.isIntersecting) v.pause(); else if (!still || !v.muted) v.play().catch(() => {}); }, { threshold: 0.15 });
    io.observe(v);
    return () => io.disconnect();
  }, [src]);

  const withSound = () => {
    const v = ref.current;
    if (!v) return;
    if (!muted) { v.muted = true; setMuted(true); return; }
    v.currentTime = 0;
    v.muted = false;
    setMuted(false);
    v.play().catch(() => {});
  };

  return (
    <div className="hero-trailer" data-playing={playing ? 'yes' : 'no'}>
      <video
        ref={ref}
        className="hero-trailer-video"
        src={src ?? undefined}
        poster={SRC.poster}
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        onPlaying={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="hero-trailer-scrim" aria-hidden="true" />
      <div className="hero-trailer-meta">
        <span className="hero-trailer-cap"><i aria-hidden="true" />Featured trailer · Genovus Just Knows</span>
        <button type="button" className="hero-trailer-sound" onClick={withSound} aria-pressed={!muted}>
          {muted ? <><SoundIcon off /> Watch with sound</> : <><SoundIcon /> Mute</>}
        </button>
      </div>
    </div>
  );
}

function SoundIcon({ off }: { off?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H2v6h4l5 4z" />
      {off ? <><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></> : <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></>}
    </svg>
  );
}
