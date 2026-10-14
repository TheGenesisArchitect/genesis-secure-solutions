'use client';
// The package tour: pick Launch, Growth or Premium and Helix walks through exactly what it includes, one real screen
// at a time. The guided walkthrough always works (captions, auto-advance, tap any step); "Talk with Helix" opens a
// voice tour that drives the same steps (show_step / switch_package arrive as window events from HelixTour).
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { HelixTour } from '@/components/vision/HelixTour';
import type { PackageTour as Tour } from '@/lib/package-tour';

const STEP_MS = 6500;

export function PackageTour({ tours, initial }: { tours: Tour[]; initial: Tour['plan'] }) {
  const [plan, setPlan] = useState<Tour['plan']>(initial);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const tour = tours.find((t) => t.plan === plan) ?? tours[0];
  const step = tour.steps[Math.min(i, tour.steps.length - 1)];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const choose = useCallback((p: Tour['plan']) => {
    setPlan(p); setI(0); setPlaying(true);
    try { history.replaceState(null, '', `/tour?plan=${p}`); } catch {}
  }, []);

  // Guided walkthrough: advance on a steady beat; stop at the last step.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!playing) return;
    if (i >= tour.steps.length - 1) { setPlaying(false); return; }
    timer.current = setTimeout(() => setI((x) => x + 1), STEP_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [i, playing, tour.steps.length]);

  // Helix's voice tour drives the same screen.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ tool: string; args: Record<string, string> }>).detail;
      if (d.tool === 'switch_package' && ['launch', 'growth', 'premium'].includes(d.args.plan)) choose(d.args.plan as Tour['plan']);
      if (d.tool === 'show_step') { setPlaying(false); setI((x) => { const k = tour.steps.findIndex((s) => s.key === d.args.key); return k >= 0 ? k : x; }); }
    };
    window.addEventListener('genovus:package-tour', on);
    return () => window.removeEventListener('genovus:package-tour', on);
  }, [choose, tour.steps]);

  const go = (k: number) => { setPlaying(false); setI(Math.max(0, Math.min(tour.steps.length - 1, k))); };
  const src = step.screen ? `/tour/${step.screen}-${step.device}.jpg` : null;
  const live = tour.steps.filter((s) => s.live).length;

  return (
    <div className="ptour">
      <div className="ptour-tabs" role="tablist" aria-label="Packages">
        {tours.map((t) => (
          <button key={t.plan} role="tab" aria-selected={t.plan === plan} type="button" onClick={() => choose(t.plan)}>
            <b>{t.name}</b><small>{t.promise}</small>
          </button>
        ))}
      </div>

      <div className="ptour-main">
        <figure className={'ptour-stage ' + (step.device === 'phone' ? 'phone' : 'desk')} aria-live="polite">
          {src ? <img key={src} src={src} alt={`${step.label} in Genovus (fictional demo agency)`} /> : (
            <div className="ptour-dev"><span className="chip dev">In development</span><b>{step.label}</b><p>{step.blurb}</p></div>
          )}
          <figcaption className="ptour-helix">
            <span className="ptour-orb" aria-hidden="true" />
            <span><b>Helix</b> {i === 0 ? `${tour.intro} ` : ''}{step.label}{step.live ? '' : ' is in development'}{step.option ? ' (an option on Growth)' : ''}. {step.blurb}</span>
          </figcaption>
        </figure>

        <aside className="ptour-side">
          <div className="ptour-head">
            <h2>{tour.name}</h2>
            <span className="muted">{live} live{tour.steps.length - live ? ` · ${tour.steps.length - live} in development` : ''}</span>
          </div>
          <ol className="ptour-steps">
            {tour.steps.map((s, k) => (
              <li key={s.key}>
                <button type="button" aria-current={k === i ? 'step' : undefined} onClick={() => go(k)}>
                  <span>{s.label}</span>
                  <span className={'chip ' + (s.live ? 'live' : 'dev')}>{s.live ? (s.option ? 'Option' : 'Live') : 'In development'}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="ptour-ctrl">
            <button className="btn small ghost" type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous step">←</button>
            <button className="btn small" type="button" onClick={() => { if (i >= tour.steps.length - 1) setI(0); setPlaying((p) => !p); }}>{playing ? 'Pause' : i >= tour.steps.length - 1 ? 'Replay' : 'Play'}</button>
            <button className="btn small ghost" type="button" onClick={() => go(i + 1)} disabled={i >= tour.steps.length - 1} aria-label="Next step">→</button>
            <button className="btn small primary" type="button" onClick={() => window.dispatchEvent(new CustomEvent('genovus:package-helix'))}>Talk with Helix</button>
          </div>
          <div className="ptour-cta">
            <Link className="btn primary" href={`/start?plan=${plan}`}>Start with {tour.name}</Link>
            <span className="muted">Pricing is covered on a short call with the team.</span>
          </div>
        </aside>
      </div>
      <p className="muted ptour-note">Brooks Family Insurance is a fictional demo agency. Screens are the real Genovus product; anything marked In development is not available yet.</p>
      <HelixTour context="packages" floating={false} openEvent="genovus:package-helix" focus={{ kind: 'package', code: plan, label: `the ${tour.name} tour` }} />
    </div>
  );
}
