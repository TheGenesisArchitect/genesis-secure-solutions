'use client';
// Enterprise Helix ("Helix Knows"): the copilot that knows the Genovus business better over time. The egg button
// (or Ctrl+J) on every console page opens Helix beside the page, already knowing where you are; any Ask Helix button
// sends the same event. Answers can end in a draft to copy, a note for the Helix notes inbox, or "Remember this?",
// which a person keeps with one tap (nothing is remembered silently). Shares the agency drawer's look.
// The console layout mounts it once (HelixHost), so the conversation travels with you from page to page.
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { helixAsk } from './HelixDrawer';
import { HelixTour } from './vision/HelixTour';
import { HelixDock, useHelixThread } from './HelixHost';
import { helixNote, rememberEnterprise } from '@/lib/helix-memory-actions';

type Memory = { department: string; kind: string; text: string };
const toast = (r: { ok?: string; err?: string } | null) => { if (r) window.dispatchEvent(new CustomEvent('genovus:toast', { detail: { ...r, at: Date.now() } })); };

const PAGES: { match: RegExp; name: string; suggest: string[] }[] = [
  { match: /^\/console\/growth/, name: 'Growth & financials', suggest: ['Where is margin leaking this month?', 'What is our runway and what moves it most?', 'Is our CAC healthy for what we charge?'] },
  { match: /^\/console\/pipeline/, name: 'Pipeline', suggest: ['Who’s stuck and what’s the next move?', 'Which client is closest to going live?', 'What’s blocking our open gates?'] },
  { match: /^\/console\/prospects\/calls/, name: 'Call list', suggest: ['Who called the Genovus line and what did they want?', 'Which states should we call first this week?', 'Draft a call-back for our last missed caller'] },
  { match: /^\/console\/prospects/, name: 'Prospects', suggest: ['Where is the funnel leaking?', 'Which states are replying best?', 'How many offices should we call this week to win one client?'] },
  { match: /^\/console\/clients\/[^/]+/, name: 'this client', suggest: ['How is this agency doing, and what should we improve?', 'Is this agency ready for Growth?', 'What is waiting on us for this client?'] },
  { match: /^\/console\/clients/, name: 'Clients', suggest: ['Which agency needs attention this week?', 'Which agencies are ready to upgrade?', 'Who has a trial ending soon?'] },
  { match: /^\/console\/inquiries/, name: 'Inquiries', suggest: ['Which campaign brings the best inquiries?', 'Who should we call back first?', 'Draft a reply to the newest inquiry'] },
  { match: /^\/console\/campaigns/, name: 'Campaigns', suggest: ['Which campaign is worth more budget?', 'What does an inquiry cost us by campaign?', 'Propose next month’s campaign'] },
  { match: /^\/console\/studio/, name: 'Studio', suggest: ['Are we on budget this month?', 'What would prove a clean episode fastest?', 'What should the next episode be about?'] },
  { match: /^\/console\/(care|approvals)/, name: 'Delivery', suggest: ['What is overdue on our side?', 'Which care requests keep coming back?', 'How fast are we turning approvals around?'] },
  { match: /^\/console\/helix/, name: 'Helix', suggest: ['What do you know about our business so far?', 'What should I tell you to remember?', 'What would make you more useful?'] },
];
const HOME = { name: 'Overview', suggest: ['What should the team do first today?', 'How is the business doing this month?', 'Which department needs attention?'] };
const DEPT: Record<string, string> = { sales: 'Sales', pipeline: 'Pipeline', clients: 'Clients', finance: 'Finance', studio: 'Studio', operations: 'Operations', general: 'General' };

/** The Enterprise Helix chat: in the drawer (compact) and on the full Ask page. */
export function AskHelixEnterprise({ context, suggest = HOME.suggest, start, startN = 0, page, compact }: { context?: string; suggest?: string[]; start?: string; startN?: number; page?: string; compact?: boolean }) {
  const { turns, setTurns, asked } = useHelixThread();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const end = useRef<HTMLDivElement>(null);
  const ask = async (question: string) => {
    const text = question.trim();
    if (!text || busy) return;
    const history = turns.map((t) => ({ role: t.role, text: t.text }));
    setTurns((t) => [...t, { role: 'user', text, page }]);
    setQ(''); setBusy(true);
    const r = await fetch('/api/helix/enterprise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ history, question: text, context }) })
      .then(async (x) => ({ okay: x.ok, j: await x.json().catch(() => ({})) }), () => ({ okay: false, j: {} as Record<string, string> }));
    setBusy(false);
    setTurns((t) => [...t, r.okay ? { role: 'helix', page, text: r.j.answer, noted: r.j.noted, drafts: r.j.drafts, remember: r.j.remember } : { role: 'helix', page, text: r.j.error ?? 'Helix couldn’t answer just now.' }]);
    setTimeout(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 50);
  };
  // Each "Ask Helix" button press asks once, adding to the thread.
  useEffect(() => { if (start && startN && asked.current !== startN) { asked.current = startN; void ask(start); } }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, []);
  const keep = async (m: Memory) => { const r = await rememberEnterprise({ ...m, source: 'conversation' }); toast(r); if (r.ok) setKept((s) => new Set(s).add(m.text)); };
  return (
    <div className={'helix-chat' + (compact ? ' compact' : '')}>
      {!turns.length && !start ? (
        <div className="helix-hello">
          <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
          <div><b>Helix Knows.</b><p className="muted" style={{ margin: 0 }}>The copilot that knows Genovus better over time: sales, pipeline, clients, Studio, spend{compact ? '' : ' and, for admins, the money'}. It drafts, you send.</p></div>
        </div>
      ) : null}
      <div className="helix-turns">
        {turns.map((t, i) => (<div key={i} style={{ display: 'contents' }}>
          {i > 0 && t.role === 'user' && t.page && turns[i - 1].page && t.page !== turns[i - 1].page ? <div className="helix-moved">→ {t.page}</div> : null}
          <div className={`helix-turn ${t.role}`}>
            <p>{t.text}</p>
            {t.noted ? <a className="chip info" href="/console/helix" style={{ justifySelf: 'start' }}>Added to Helix notes</a> : null}
            {t.drafts?.map((d, j) => (
              <div key={j} className="helix-card draft"><span className="muted" style={{ fontSize: 12 }}>Draft {d.channel}{d.to ? ` to ${d.to}` : ''} · you send it</span><p style={{ margin: 0 }}>{d.body}</p><button className="btn small" type="button" onClick={() => navigator.clipboard.writeText(d.body).then(() => toast({ ok: 'Draft copied.' }), () => toast({ err: 'Copy failed: select the text instead.' }))}>Copy</button></div>
            ))}
            {t.remember?.map((m, j) => (
              <div key={j} className="helix-card remember"><span><b>Remember this?</b> <span className="muted" style={{ fontSize: 12 }}>{DEPT[m.department] ?? 'General'}</span><br />{m.text}</span>{kept.has(m.text) ? <span className="chip done">Kept</span> : <button className="btn small primary" type="button" onClick={() => keep(m)}>Keep</button>}</div>
            ))}
            {t.role === 'helix' && !t.noted && i === turns.length - 1 && !busy ? <button className="btn small ghost" type="button" style={{ justifySelf: 'start' }} onClick={async () => toast(await helixNote(t.text))}>Make it a note</button> : null}
          </div>
        </div>))}
        {busy ? <div className="helix-turn helix"><p className="muted">Helix is looking…</p></div> : null}
        <div ref={end} />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{suggest.map((s) => <button key={s} className="btn small ghost" type="button" disabled={busy} onClick={() => ask(s)}>{s}</button>)}</div>
      <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about any part of the business" aria-label="Ask Helix" style={{ flex: 1, minWidth: 0 }} maxLength={1000} />
        <button className="btn primary" type="submit" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  );
}

/** Where the Studio is on screen, from the page address: Studio voice knows the bible and this page's focus. */
function studioFocus(path: string): { kind: 'home' | 'bible' | 'cast' | 'episode' | 'character'; code?: string; label: string } | null {
  const m = path.match(/^\/console\/studio(?:\/(.*))?$/);
  if (!m) return null;
  const rest = m[1] ?? '';
  if (!rest) return { kind: 'home', label: 'the Studio' };
  if (rest === 'bible') return { kind: 'bible', label: 'the Character Bible' };
  if (rest === 'cast') return { kind: 'cast', label: 'the cast' };
  const c = rest.match(/^cast\/([A-Za-z0-9-]{1,30})$/);
  if (c) return { kind: 'character', code: c[1], label: c[1] };
  const e = rest.match(/^([A-Za-z0-9-]{1,30})$/);
  return e ? { kind: 'episode', code: e[1], label: `episode ${e[1]}` } : { kind: 'home', label: 'the Studio' };
}

/** The voice bar in Ask Helix: Studio voice on Studio pages, Enterprise voice everywhere else. */
export function EnterpriseVoice({ path, autoStart, where }: { path: string; autoStart?: boolean; where?: string }) {
  const sf = studioFocus(path);
  return sf
    ? <HelixTour embedded autoStart={autoStart} context={sf.kind === 'bible' ? 'bible' : 'studio'} focus={sf} key={path} />
    : <HelixTour embedded autoStart={autoStart} context="enterprise" where={where} key="enterprise" />;
}

/** The drawer on every console page. */
export function EnterpriseHelixDrawer() {
  const path = usePathname();
  const page = PAGES.find((p) => p.match.test(path)) ?? HOME;
  return (
    <HelixDock
      path={path}
      pageName={page.name}
      fullHref="/console/helix/ask"
      hidden={path === '/console/helix/ask'}
      voice={(autoStart) => <EnterpriseVoice path={path} autoStart={autoStart} where={`the ${page.name} page`} />}
      chat={(ask) => <AskHelixEnterprise compact page={page.name} context={ask.context ?? `the ${page.name} page (${path})`} suggest={page.suggest} start={ask.question} startN={ask.n} />}
    />
  );
}

/** Helix's morning brief at the top of the Enterprise overview; the money line comes from the server (money roles). */
export function EnterpriseMorningBrief({ initial, money }: { initial: { answer: string } | null; money: string | null }) {
  const [brief, setBrief] = useState(initial);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>(initial ? 'idle' : 'loading');
  useEffect(() => {
    if (initial) return;
    fetch('/api/helix/enterprise/brief', { method: 'POST' })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (r.ok) { setBrief(j); setState('idle'); } else setState('error'); })
      .catch(() => setState('error'));
  }, [initial]);
  return (
    <section className="morning" aria-label="Helix’s morning brief">
      <header className="row" style={{ gap: 10 }}>
        <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />
        <div style={{ display: 'grid' }}><b>Good morning. Here’s the business today.</b><span className="muted" style={{ fontSize: 12 }}>Helix Knows · from sales, pipeline, clients, Studio and spend</span></div>
      </header>
      {money ? <p className="cfo-line">{money}</p> : null}
      {state === 'loading' ? <p className="muted" style={{ margin: 0 }}>Helix is reading every department…</p> : null}
      {state === 'error' ? <p className="muted" style={{ margin: 0 }}>Helix couldn’t write today’s brief just now. Ask Helix anything with the egg button.</p> : null}
      {brief ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{brief.answer}</p> : null}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn small ghost" type="button" onClick={() => helixAsk({ question: 'What should the team do first today, and why?', context: 'Enterprise overview: the morning brief' })}>Ask Helix about today</button>
        <a className="btn small ghost" href="/console/helix/knows">What Helix knows</a>
      </div>
    </section>
  );
}
