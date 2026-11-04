'use client';
// First-touch tags for a visit to a site Genovus hosts: kept for the browser session, per site, so the source
// survives moving between pages and rides along with the contact form (components/site/SiteContact.tsx).
import { useEffect } from 'react';

const PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'msclkid'];
export const attrKey = (slug: string) => `gv_attr:${slug}`;

export function readSiteAttribution(slug: string): Record<string, string> {
  try { return JSON.parse(sessionStorage.getItem(attrKey(slug)) ?? '{}'); } catch { return {}; }
}

export function SiteAttribution() {
  useEffect(() => {
    const slug = location.pathname.split('/')[2];
    if (!slug) return;
    try {
      if (sessionStorage.getItem(attrKey(slug))) return;
      const q = new URLSearchParams(location.search), a: Record<string, string> = {};
      for (const p of PARAMS) { const v = q.get(p); if (v) a[p] = v.slice(0, 300); }
      const ref = document.referrer && new URL(document.referrer).host !== location.host ? document.referrer.slice(0, 300) : '';
      if (ref) a.referrer = ref;
      a.landing = location.pathname.slice(0, 300);
      sessionStorage.setItem(attrKey(slug), JSON.stringify(a));
    } catch { /* storage blocked: the lead still goes through, untagged */ }
  }, []);
  return null;
}
