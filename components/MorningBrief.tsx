'use client';
// Helix's morning brief at the top of Home: the day's plan from the agency's own data (made at 8 a.m. Eastern, or
// on first open). Proposed calls add to Today with one tap; "Ask Helix about this" continues in the drawer.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addFollowUp } from '@/lib/actions';
import { helixAsk } from './HelixDrawer';

type Brief = { answer: string; followUps: { who: string; reason: string; due: string; at: string }[]; drafts: { to: string; channel: string; body: string }[] };
const toast = (r: { ok?: string; err?: string } | null) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } })); };

export function MorningBrief({ slug, tenantId, initial, pulse }: { slug: string; tenantId: string; initial: Brief | null; pulse: string | null }) {
  const router = useRouter();
  const [brief, setBrief] = useState<Brief | null>(initial);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(initial ? 'idle' : 'loading');
  const [added, setAdded] = useState<Set<number>>(new Set());
  useEffect(() => {
    if (initial) return;
    fetch('/api/helix/brief', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }) })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (r.ok) { setBrief(j); setState('idle'); } else setState('error'); })
      .catch(() => setState('error'));
  }, [initial, slug]);
  const add = async (i: number, f: Brief['followUps'][number]) => {
    const fd = new FormData();
    fd.set('tenant', tenantId); fd.set('who', f.who); fd.set('reason', f.reason); fd.set('due', f.due); fd.set('at', f.at);
    const r = await addFollowUp(null, fd); toast(r);
    if (r?.ok) { setAdded((s) => new Set(s).add(i)); router.refresh(); }
  };
  return (
    <section className="morning" aria-label="Helix’s morning brief">
      <header className="row" style={{ gap: 10 }}>
        <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
        <div style={{ display: 'grid' }}><b>Good morning. Here’s your day.</b><span className="muted" style={{ fontSize: 12 }}>Helix’s brief, from your leads, calls, calendar and market</span></div>
      </header>
      {state === 'loading' ? <p className="muted" style={{ margin: 0 }}>Helix is reading your leads, calls and calendar…</p> : null}
      {state === 'error' ? <p className="muted" style={{ margin: 0 }}>Helix couldn’t write today’s brief just now. Ask Helix anything with the egg button.</p> : null}
      {brief ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{brief.answer}</p> : null}
      {brief?.followUps.length ? (
        <div style={{ display: 'grid', gap: 6 }}>
          {brief.followUps.map((f, i) => (
            <div key={i} className="helix-card"><span><b>{f.who}</b> · {f.at}{f.reason ? ` · ${f.reason}` : ''}</span>{added.has(i) ? <span className="chip done">Added</span> : <button className="btn small primary" type="button" onClick={() => add(i, f)}>Add to Today</button>}</div>
          ))}
        </div>
      ) : null}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {pulse ? <span className="chip info">{pulse}</span> : null}
        <button className="btn small ghost" type="button" onClick={() => helixAsk({ question: 'What should I do first today, and why?', context: 'Home: the morning brief' })}>Ask Helix about today</button>
      </div>
    </section>
  );
}
