'use client';
// What's new, made usable on the spot: one small toast per session for the newest upgrade this person hasn't seen,
// with "Show me" (a Quick Helix Tour: a few spotlights on the real controls) and "Try it" (opens the feature and
// points at where to start). Seen once per device. Entries live in lib/whats-new.ts.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { WHATS_NEW, type TourStep, type WhatsNew as Entry } from '@/lib/whats-new';

const SEEN = 'genovus-whats-new';
const seen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN) ?? '[]'); } catch { return []; } };
const markSeen = (id: string) => { try { localStorage.setItem(SEEN, JSON.stringify([id, ...seen().filter((x) => x !== id)].slice(0, 100))); } catch {} };

export function WhatsNew({ surface, base }: { surface: 'agency' | 'enterprise'; base?: string }) {
  const router = useRouter();
  const path = usePathname();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [tour, setTour] = useState<{ steps: TourStep[]; i: number } | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  // One per session, a moment after the page settles: the newest upgrade for this surface not seen on this device.
  useEffect(() => {
    let shown = false;
    try { shown = sessionStorage.getItem(SEEN) === '1'; } catch {}
    if (shown) return;
    const t = setTimeout(() => {
      const next = WHATS_NEW.filter((w) => w.surfaces.includes(surface) && !seen().includes(w.id)).sort((a, b) => b.date.localeCompare(a.date))[0];
      if (next) { setEntry(next); try { sessionStorage.setItem(SEEN, '1'); } catch {} }
    }, 2500);
    return () => clearTimeout(t);
  }, [surface]);

  // Run a step: open its page and/or Ask Helix, then find what to point at.
  const step = tour?.steps[tour.i];
  useEffect(() => {
    if (!step) { setBox(null); return; }
    let live = true, raf = 0;
    (async () => {
      if (step.page !== undefined && base) {
        const href = step.page ? `${base}/${step.page}` : base;
        if (location.pathname !== href) { router.push(href); for (let i = 0; i < 40 && location.pathname !== href; i++) await new Promise((r) => setTimeout(r, 150)); }
      }
      if (step.helix) window.dispatchEvent(new CustomEvent('genovus:helix-dock', { detail: { state: 'open' } }));
      let el: Element | null = null;
      for (let i = 0; i < 25 && live && !(el = step.at ? document.querySelector(step.at) : null) && step.at; i++) await new Promise((r) => setTimeout(r, 120));
      if (!live) return;
      if (!el) { setBox(null); return; }
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const loop = () => { if (live) { setBox(el!.getBoundingClientRect()); raf = requestAnimationFrame(loop); } };
      loop();
    })();
    return () => { live = false; cancelAnimationFrame(raf); };
  }, [step, base, router, path]);

  const close = () => { if (entry) markSeen(entry.id); setEntry(null); setTour(null); };
  const show = () => { if (entry) setTour({ steps: entry.tour, i: 0 }); };
  const tryIt = () => { if (entry) setTour({ steps: [entry.tryIt], i: 0 }); };
  if (!entry) return null;

  if (tour && step) {
    const last = tour.i === tour.steps.length - 1;
    // The caption sits below what it points at (or above, near the bottom of the screen), inside the window.
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200, vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const w = Math.min(340, vw - 32);
    const pos = box
      ? { left: Math.max(16, Math.min(vw - w - 16, box.left + box.width / 2 - w / 2)), ...(box.bottom + 180 < vh ? { top: box.bottom + 14 } : { bottom: Math.max(16, vh - box.top + 14) }) }
      : { left: (vw - w) / 2, top: vh / 2 - 80 };
    return createPortal(
      <>
        {box ? <div className="hx-spot tour" style={{ top: box.top - 8, left: box.left - 8, width: box.width + 16, height: box.height + 16 }} aria-hidden="true" /> : null}
        <div className="qt-card" role="dialog" aria-label={`${entry.title}: step ${tour.i + 1} of ${tour.steps.length}`} style={{ width: w, ...pos }}>
          <span className="qt-eyebrow"><img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />Quick Helix Tour{tour.steps.length > 1 ? ` · ${tour.i + 1} of ${tour.steps.length}` : ''}</span>
          <p>{step.caption}</p>
          <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn small ghost" onClick={close}>{last ? 'Close' : 'Skip'}</button>
            {last ? <button type="button" className="btn small primary" onClick={close}>Got it</button>
              : <button type="button" className="btn small primary" onClick={() => setTour({ ...tour, i: tour.i + 1 })}>Next</button>}
          </span>
        </div>
      </>, document.body);
  }
  return (
    <div className="whats-new" role="status">
      <span className="qt-eyebrow"><img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />New in Genovus</span>
      <b>{entry.title}</b>
      <p>{entry.line}</p>
      <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className="btn small primary" onClick={show}>Show me</button>
        <button type="button" className="btn small" onClick={tryIt}>Try it</button>
        <button type="button" className="btn small ghost" onClick={close} aria-label="Dismiss what’s new">Not now</button>
      </span>
    </div>
  );
}
