'use client';
// Loads the 3D scene only in the browser. Until it is ready (or if WebGL is unavailable, as on some
// locked-down laptops and screen shares) the lit static mark stands in, so the hero never looks empty.
import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';

const HeroScene = dynamic(() => import('./HeroScene'), { ssr: false });

export function HeroCanvas() {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  return (
    <div className={'hero-visual' + (ready ? ' is-ready' : '')}>
      <div className="hero-still" aria-hidden="true">
        <span className="hero-halo" />
        <img src="/brand/genovus/genovus-egg.svg" alt="" />
      </div>
      <HeroScene onReady={onReady} />
    </div>
  );
}
