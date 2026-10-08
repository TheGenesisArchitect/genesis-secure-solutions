'use client';
// First-touch campaign attribution: when a visitor arrives on a tracked link (?c=campaign&src=channel&p=prospect),
// remember it for 30 days so an inquiry sent later, from any page, still credits that campaign. Only campaign
// codes are stored, never anything personal, and a later tracked visit does not overwrite the first.
import { useEffect } from 'react';

export function RefCapture() {
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const c = q.get('c'), src = q.get('src'), p = q.get('p');
      if (!c && !src && !p) return;
      if (document.cookie.split('; ').some((x) => x.startsWith('gv_ref='))) return;
      const clean = (v: string | null, n: number) => (v ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, n);
      const ref = { c: clean(c, 41), src: clean(src, 20), p: clean(p, 24), l: window.location.pathname.slice(0, 80), t: Date.now() };
      document.cookie = `gv_ref=${encodeURIComponent(JSON.stringify(ref))}; path=/; max-age=${30 * 86400}; samesite=lax; secure`;
    } catch {}
  }, []);
  return null;
}
