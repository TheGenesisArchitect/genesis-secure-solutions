'use client';
// Opened from a new-lead alert: scroll to that lead on Today and mark it, so the Call button is right there. If it
// isn't on the list any more (someone already called), say so.
import { useEffect, useState } from 'react';

export function LeadFocus({ id }: { id: string }) {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const el = document.querySelector(`[data-lead-id="${CSS.escape(id)}"]`);
    if (!el) { setMissing(true); return; }
    el.classList.add('lead-focus');
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const t = setTimeout(() => el.classList.remove('lead-focus'), 8000);
    return () => clearTimeout(t);
  }, [id]);
  return missing ? <div className="notice" role="status">That lead isn’t waiting any more: someone already called or updated it. It’s in Leads.</div> : null;
}
