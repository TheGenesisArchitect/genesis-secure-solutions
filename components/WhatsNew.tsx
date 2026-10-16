'use client';
// What's new, made usable on the spot: one small toast per session for the newest upgrade this person hasn't seen,
// with "Show me" (a Quick Helix Tour: a few spotlights on the real controls) and "Try it" (opens the feature and
// points at where to start). Seen once per device. Every upgrade stays on the What's new page (WhatsNewArchive),
// where any of them can be replayed. Entries live in lib/whats-new.ts.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { WHATS_NEW, type TourStep, type WhatsNew as Entry } from '@/lib/whats-new';

const SEEN = 'genovus-whats-new';
const RUN = 'genovus:whats-new-run';
const seen = (): string[] => { try { return JSON.parse(localStorage.getItem(SEEN) ?? '[]'); } catch { return []; } };
const markSeen = (id: string) => { try { localStorage.setItem(SEEN, JSON.stringify([id, ...seen().filter((x) => x !== id)].slice(0, 100))); } catch {} };
// This session's toast: the id being shown (it comes back after a reload until acted on), or 'done'.
const session = (v?: string) => { try { if (v) sessionStorage.setItem(SEEN, v); return sessionStorage.getItem(SEEN); } catch { return 'done'; } };
const forSurface = (surface: 'agency' | 'enterprise') => WHATS_NEW.filter((w) => w.surfaces.includes(surface)).sort((a, b) => b.date.localeCompare(a.date));

/** Replay an upgrade's Quick Helix Tour (or its Try it) from anywhere, e.g. the What's new page. */
export const runWhatsNew = (id: string, mode: 'tour' | 'try') => window.dispatchEvent(new CustomEvent(RUN, { detail: { id, mode } }));

export function WhatsNew({ surface, base }: { surface: 'agency' | 'enterprise'; base?: string }) {
  const router = useRouter();
  const path = usePathname();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [tour, setTour] = useState<{ steps: TourStep[]; i: number } | null>(null);
  const [box, setBox] = useState<DOMRect | null>(null);
  // One per session, a moment after the page settles: the newest upgrade for this surface not seen on this device
  // (or the one already showing before a reload).
  useEffect(() => {
    const now = session();
    if (now === 'done') return;
    const t = setTimeout(() => {
      const list = forSurface(surface);
      const next = (now && list.find((w) => w.id === now && !seen().includes(w.id))) || list.find((w) => !seen().includes(w.id));
      if (next) { session(next.id); setEntry(next); }
    }, 2500);
    return () => clearTimeout(t);
  }, [surface]);
  // Replays from the What's new page.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; mode: 'tour' | 'try' }>).detail;
      const w = WHATS_NEW.find((x) => x.id === d?.id);
      if (!w) return;
      setEntry(w);
      setTour({ steps: d.mode === 'try' ? [w.tryIt] : w.tour, i: 0 });
    };
    window.addEventListener(RUN, on);
    return () => window.removeEventListener(RUN, on);
  }, []);

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

  const close = () => { if (entry) markSeen(entry.id); session('done'); setEntry(null); setTour(null); };
  // Opening the tour or trying it counts as seeing it (it stays on the What's new page for later).
  const show = () => { if (entry) { markSeen(entry.id); session('done'); setTour({ steps: entry.tour, i: 0 }); } };
  const tryIt = () => { if (entry) { markSeen(entry.id); session('done'); setTour({ steps: [entry.tryIt], i: 0 }); } };
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
        <a className="btn small ghost" href={base ? `${base}/whats-new` : '/console/whats-new'} onClick={() => { markSeen(entry.id); session('done'); }}>All updates</a>
      </span>
    </div>
  );
}

/** The What's new page: every upgrade for this surface, newest first, each replayable. Seen ones are marked. */
export function WhatsNewArchive({ surface }: { surface: 'agency' | 'enterprise' }) {
  const [seenIds, setSeenIds] = useState<string[]>([]);
  useEffect(() => { setSeenIds(seen()); }, []);
  const list = forSurface(surface);
  const run = (id: string, mode: 'tour' | 'try') => { markSeen(id); setSeenIds(seen()); runWhatsNew(id, mode); };
  return (
    <ul className="whats-new-list">
      {list.map((w) => (
        <li key={w.id} className="whats-new-item" data-helix-item={w.title}>
          <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <b>{w.title}</b>
            {seenIds.includes(w.id) ? <span className="chip">Seen</span> : <span className="chip info">New</span>}
            <span className="muted" style={{ fontSize: 12 }}>{new Date(`${w.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</span>
          </span>
          <p>{w.line}</p>
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="btn small primary" onClick={() => run(w.id, 'tour')}>Show me</button>
            <button type="button" className="btn small" onClick={() => run(w.id, 'try')}>Try it</button>
          </span>
        </li>
      ))}
    </ul>
  );
}
