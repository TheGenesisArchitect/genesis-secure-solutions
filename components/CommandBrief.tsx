'use client';
// The Command Brief: the day, ready to run. Helix's one most important move up top (the full written brief folds
// open under it), then action cards built from real records, each a move you finish right here: call, prep, mark
// called (with your yes), review, open, draft. "Do it with Helix" hands any card to Helix (typed or voice). Cards
// check off as you go; progress is counted for the day on this device.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addFollowUp } from '@/lib/actions';
import { helixAsk } from './HelixDrawer';
import { useHelixThread } from './HelixHost';
import { goViaMenu } from '@/lib/helix-menu';
import type { BriefAction, BriefCard } from '@/lib/command-brief';

type Brief = { answer: string; followUps?: { who: string; reason: string; due: string; at: string }[] };
const toast = (r: { ok?: string; err?: string } | null) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } })); };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const doneKey = () => `brief-done-${today()}`;
const greet = () => { const h = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' })); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
/** The first sentence is the headline; the rest is the full brief. */
const split = (t: string) => { const m = t.trim().match(/^(.+?[.!?])(\s|$)([\s\S]*)$/); return m ? { head: m[1], rest: m[3].trim() } : { head: t.trim(), rest: '' }; };

export function CommandBrief({ surface, slug, tenantId, initial, cards, pulse, money, sources }: {
  surface: 'agency' | 'enterprise';
  slug?: string;
  tenantId?: string;
  initial: Brief | null;
  cards: BriefCard[];
  pulse?: string | null;
  money?: string | null;
  sources: string;
}) {
  const router = useRouter();
  const { act } = useHelixThread();
  const [brief, setBrief] = useState<Brief | null>(initial);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(initial ? 'idle' : 'loading');
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string[]>([]);
  const [lane, setLane] = useState<string | null>(null);
  useEffect(() => { try { setDone(JSON.parse(localStorage.getItem(doneKey()) ?? '[]')); } catch {} }, []);
  useEffect(() => {
    if (initial) return;
    const url = surface === 'agency' ? '/api/helix/brief' : '/api/helix/enterprise/brief';
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }) })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (r.ok) { setBrief(j); setState('idle'); } else setState('error'); })
      .catch(() => setState('error'));
  }, [initial, slug, surface]);

  // Helix's suggested calls become cards too ("Add to Today").
  const suggested: BriefCard[] = (brief?.followUps ?? []).map((f, i) => ({ id: `suggest:${today()}:${i}:${f.who}`, lane: 'Helix suggests', tone: 'idea', title: `${f.who} · ${f.at}`, why: f.reason || 'A call Helix suggests for today', actions: [] }));
  const all = [...cards, ...suggested];
  const markDone = (id: string, on = true) => setDone((d) => { const n = on ? [...new Set([...d, id])] : d.filter((x) => x !== id); try { localStorage.setItem(doneKey(), JSON.stringify(n)); } catch {} return n; });
  const run = async (card: BriefCard, a: BriefAction) => {
    if (a.kind === 'tel') { window.location.href = a.href; markDone(card.id); return; }
    if (a.kind === 'link') { void goViaMenu(a.href, () => router.push(a.href)); return; }
    if (a.kind === 'helix') { helixAsk({ question: a.question, context: a.context ?? card.title }); return; }
    if (a.kind === 'act' && act) { window.dispatchEvent(new CustomEvent('genovus:helix-dock', { detail: { state: 'open' } })); const p = await act.propose(a.action, a.args); if (!p.ok) toast({ err: p.error }); }
  };
  const addSuggested = async (i: number, id: string) => {
    const f = brief?.followUps?.[i]; if (!f || !tenantId) return;
    const fd = new FormData(); fd.set('tenant', tenantId); fd.set('who', f.who); fd.set('reason', f.reason); fd.set('due', f.due); fd.set('at', f.at);
    const r = await addFollowUp(null, fd); toast(r);
    if (r?.ok) { markDone(id); router.refresh(); }
  };
  const left = all.filter((c) => !done.includes(c.id));
  const finished = all.length - left.length;
  // Enterprise: one tight grid in department order, with a chip per department to focus on one.
  const lanes = surface === 'enterprise' ? [...new Set(all.map((c) => c.lane))] : null;
  const order = (c: BriefCard) => (lanes ? lanes.indexOf(c.lane) : 0);
  const shown = [...left, ...all.filter((c) => done.includes(c.id))].filter((c) => !lane || c.lane === lane).sort((a, b) => order(a) - order(b));
  const text = brief ? split(brief.answer) : null;

  const Card = ({ c }: { c: BriefCard }) => {
    const isDone = done.includes(c.id);
    const si = c.id.startsWith('suggest:') ? Number(c.id.split(':')[2]) : -1;
    return (
      <article className={`cb-card ${c.tone}${isDone ? ' done' : ''}`} data-helix-item={c.title}>
        <header><span className="cb-lane">{c.lane}</span><button type="button" className="cb-check" aria-pressed={isDone} aria-label={isDone ? 'Mark not done' : 'Mark done'} title={isDone ? 'Done' : 'Mark done'} onClick={() => markDone(c.id, !isDone)}>{isDone ? '✓' : ''}</button></header>
        <b className="cb-title">{c.title}</b>
        <p className="cb-why">{c.why}</p>
        {isDone ? null : (
          <div className="cb-actions">
            {si >= 0 ? <button type="button" className="btn small primary" onClick={() => addSuggested(si, c.id)}>Add to Today</button> : null}
            {c.actions.map((a, i) => (
              a.kind === 'tel'
                ? <a key={i} className={'btn small' + (a.primary ? ' primary' : '')} href={a.href} onClick={() => markDone(c.id)}>{a.label}</a>
                : <button key={i} type="button" className={'btn small' + (a.primary ? ' primary' : ' ghost')} onClick={() => run(c, a)}>{a.label}</button>
            ))}
            <button type="button" className="cb-helix" onClick={() => helixAsk({ question: `Help me with this now: ${c.title}.`, context: `${c.title} · ${c.why}` })}><img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />Do it with Helix</button>
          </div>
        )}
      </article>
    );
  };

  return (
    <section className="cb" aria-label="Your day, ready to run">
      <div className="cb-hero">
        <img className="cb-egg" src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
        <div className="cb-hello">
          <span className="cb-eyebrow">{greet()} · {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' })}</span>
          <h2>{state === 'loading' ? 'Helix is reading your day…' : text?.head ?? 'Your day, ready to run.'}</h2>
          {money ? <p className="cb-money">{money}</p> : null}
          {text?.rest ? (
            <>
              <button type="button" className="cb-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide Helix’s full brief' : 'Read Helix’s full brief'}</button>
              {open ? <p className="cb-full">{text.rest}</p> : null}
            </>
          ) : null}
          {state === 'error' ? <p className="muted" style={{ margin: 0 }}>Helix couldn’t write today’s brief just now; your cards below are live.</p> : null}
        </div>
        <div className="cb-progress" aria-label={`${finished} of ${all.length} done today`}>
          <b>{finished}<span>/{all.length}</span></b>
          <span>done today</span>
          <i style={{ width: all.length ? `${Math.round((finished / all.length) * 100)}%` : '0%' }} />
        </div>
      </div>
      {lanes && lanes.length > 1 ? (
        <div className="cb-filter" role="group" aria-label="Show a department">
          <button type="button" aria-pressed={!lane} onClick={() => setLane(null)}>All <span>{all.length - finished}</span></button>
          {lanes.map((l) => <button key={l} type="button" aria-pressed={lane === l} onClick={() => setLane(lane === l ? null : l)}>{l} <span>{all.filter((c) => c.lane === l && !done.includes(c.id)).length}</span></button>)}
        </div>
      ) : null}
      {all.length === 0 ? <p className="cb-clear">Nothing waiting. Ask Helix what would move the business most today.</p> : (
        <div className="cb-grid">{shown.map((c) => <Card key={c.id} c={c} />)}</div>
      )}
      <div className="cb-foot">
        {pulse ? <span className="chip info">{pulse}</span> : null}
        <span className="muted">{sources}</span>
        <button type="button" className="btn small ghost" onClick={() => helixAsk({ question: surface === 'agency' ? 'What should I do first today, and why?' : 'What should the team do first today, and why?', context: 'the brief' })}>Ask Helix about today</button>
      </div>
    </section>
  );
}
