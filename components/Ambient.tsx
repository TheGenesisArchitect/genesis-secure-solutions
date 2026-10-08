'use client';
// Small global behaviours for the v2 look: a soft light that follows the cursor across lit surfaces
// (sets --mx/--my on the hovered card) and numbers that count up when they first appear.
// Mounted once in the root layout; does nothing under prefers-reduced-motion.
import { useEffect } from 'react';

const LIT = '.panel,.tile,.feature,.price,.door,.card';

export function Ambient() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(LIT) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    // Count up any number marked .num inside a KPI tile value or metric, once, when visible.
    const counted = new WeakSet<Element>();
    const countUp = (el: HTMLElement) => {
      if (counted.has(el) || reduce) return;
      counted.add(el);
      const text = el.textContent ?? '';
      const m = text.match(/-?[\d,]+(\.\d+)?/);
      if (!m) return;
      const target = Number(m[0].replace(/,/g, ''));
      if (!isFinite(target) || target === 0) return;
      const decimals = m[1] ? m[1].length - 1 : 0;
      const [pre, post] = [text.slice(0, m.index), text.slice((m.index ?? 0) + m[0].length)];
      const start = performance.now(), dur = 1100;
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / dur), eased = 1 - Math.pow(1 - t, 3);
        const v = target * eased;
        el.textContent = pre + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + post;
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = text;
      };
      requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((entries) => entries.forEach((en) => en.isIntersecting && countUp(en.target as HTMLElement)), { threshold: 0.4 });
    const scan = () => document.querySelectorAll<HTMLElement>('.tile .value .num, .tile .value:not(:has(*)), .chain .v, .count-up').forEach((el) => io.observe(el));
    // Start only after the page has loaded and React has hydrated the streamed content: changing a number's
    // text before then makes React's hydration check fail and re-render the page.
    const mo = new MutationObserver(scan);
    let started = false;
    // Count up only what is on the page as it first loads; later updates (a save refreshing the data) must
    // not replay the animation, or every click looks like a page reload.
    const begin = () => { if (started) return; started = true; scan(); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 1500); };
    const delayed = () => setTimeout(begin, 350);
    if (document.readyState === 'complete') delayed(); else window.addEventListener('load', delayed, { once: true });
    return () => {
      window.removeEventListener('load', delayed);
      window.removeEventListener('pointermove', onMove);
      io.disconnect();
      mo.disconnect();
    };
  }, []);
  return null;
}
