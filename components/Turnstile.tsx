'use client';
// Cloudflare's bot check inside a form. It adds a hidden "cf-turnstile-response" field to the form it sits in.
// Renders nothing until the site key is set (lib/turnstile.ts keeps the server side off too).
import { useEffect, useRef } from 'react';

declare global { interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void } } }
const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function Turnstile() {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!key || !box.current) return;
    let id: string | null = null, gone = false;
    const draw = () => { if (!gone && box.current && window.turnstile && !id) id = window.turnstile.render(box.current, { sitekey: key, appearance: 'interaction-only' }); };
    if (window.turnstile) draw();
    else {
      let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
      if (!s) { s = document.createElement('script'); s.src = SRC; s.async = true; document.head.appendChild(s); }
      s.addEventListener('load', draw);
    }
    return () => { gone = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [key]);
  return key ? <div ref={box} className="turnstile" /> : null;
}
