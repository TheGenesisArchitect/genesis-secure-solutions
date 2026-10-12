'use client';
// Ask Helix from anywhere in the agency dashboard: the egg button (or Ctrl+J) opens Helix beside the page, already
// knowing which page you're on. Any "Ask Helix" button on a lead, call or partner opens it with that item loaded and
// the question asked (helixAsk below). One Helix, the same brief everywhere, so answers agree on every screen.
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AskHelixAgency } from './AskHelixAgency';
import { HelixTour } from './vision/HelixTour';

type Ask = { question?: string; context?: string };
const EVT = 'genovus:helix';
/** The event every Ask Helix button sends; the agency drawer and the Enterprise drawer both listen for it. */
export const HELIX_EVT = EVT;

/** Voice Ask Helix: the Talk button (and any button that calls helixTalk) starts a spoken conversation with Helix. */
export const HELIX_VOICE_EVT = 'genovus:helix-voice';
export const helixTalk = () => window.dispatchEvent(new Event(HELIX_VOICE_EVT));
export function HelixTalkButton({ inline }: { inline?: boolean }) {
  return (
    <button className={inline ? 'btn small ghost helix-talk-inline' : 'helix-talk'} type="button" onClick={helixTalk} aria-label="Talk to Helix" title="Talk to Helix">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>{inline ? <span>Talk</span> : <span className="helix-talk-label">Talk to Helix</span>}
    </button>
  );
}

/** Open Helix with a question about a specific item. Use from any client component (or <HelixAskButton>). */
export const helixAsk = (a: Ask) => window.dispatchEvent(new CustomEvent<Ask>(EVT, { detail: a }));

const PAGE: { match: RegExp; name: string; suggest: string[] }[] = [
  { match: /\/leads$/, name: 'Leads', suggest: ['Who should I call first?', 'Which calls did we miss?', 'Draft a reply to my newest lead'] },
  { match: /\/pipeline$/, name: 'Pipeline', suggest: ['Who’s stalling in my pipeline?', 'Which consults are coming up?', 'Draft a nudge for my oldest contacted lead'] },
  { match: /\/calendar$/, name: 'Calendar', suggest: ['Plan my week', 'What’s on my calendar today?', 'Where can I fit partner visits?'] },
  { match: /\/partners$/, name: 'Partners', suggest: ['Which partner should I call first and why?', 'Give me talking points for a car dealer', 'Draft a thank-you after a partner visit'] },
  { match: /\/market$/, name: 'Market', suggest: ['What does my market need this month?', 'Which source brings the cheapest leads?', 'Propose a campaign for this season'] },
  { match: /\/performance$/, name: 'Performance', suggest: ['How is my office doing this month?', 'Why is my contact rate where it is?', 'What one thing should we improve?'] },
  { match: /\/(today|follow-ups)$/, name: 'Today', suggest: ['Who needs a call today?', 'What’s overdue?', 'Draft a text to my next callback'] },
];
const HOME = { name: 'Home', suggest: ['What should I do first today?', 'Where did my leads come from this month?', 'Which partner should I call this week?'] };

export function HelixDrawer({ slug, tenantId }: { slug: string; tenantId: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<Ask & { n: number }>({ n: 0 });
  const page = PAGE.find((p) => p.match.test(path)) ?? HOME;
  useEffect(() => {
    const onAsk = (e: Event) => { const d = (e as CustomEvent<Ask>).detail ?? {}; setAsk((a) => ({ ...d, n: a.n + 1 })); setOpen(true); };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener(EVT, onAsk);
    window.addEventListener('keydown', onKey);
    const onTalk = () => setOpen(false); // voice takes over: the dock is in view
    window.addEventListener(HELIX_VOICE_EVT, onTalk);
    return () => { window.removeEventListener(EVT, onAsk); window.removeEventListener('keydown', onKey); window.removeEventListener(HELIX_VOICE_EVT, onTalk); };
  }, []);
  const voice = <HelixTour context="agency" slug={slug} floating={false} openEvent={HELIX_VOICE_EVT} where={`the ${page.name} page`} />;
  if (/\/helix$/.test(path)) return <>{voice}<HelixTalkButton /></>; // the full Ask Helix page is already open
  return (
    <>
      {voice}
      <HelixTalkButton />
      <button className="helix-fab" type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Ask Helix (Ctrl+J)" title="Ask Helix (Ctrl+J)">
        <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" /><span>Ask Helix</span>
      </button>
      {open ? (
        <aside className="helix-drawer" aria-label="Ask Helix">
          <header className="row" style={{ justifyContent: 'space-between' }}>
            <span className="row" style={{ gap: 8 }}><img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" style={{ width: 20 }} /><b>Helix</b><span className="muted" style={{ fontSize: 12 }}>on {page.name}</span></span>
            <span className="row" style={{ gap: 6 }}><HelixTalkButton inline /><a className="btn small ghost" href={`/app/${slug}/helix`}>Full view</a><button className="btn small ghost" type="button" onClick={() => setOpen(false)} aria-label="Close Helix">✕</button></span>
          </header>
          <AskHelixAgency key={`${path}:${ask.n}`} slug={slug} tenantId={tenantId} compact context={ask.context ?? `the ${page.name} page`} suggest={page.suggest} start={ask.question} />
        </aside>
      ) : null}
    </>
  );
}

/** A small "Ask Helix" button for an item (a lead, a call, a partner): opens the drawer with it loaded. */
export function HelixAskButton({ question, context, label = 'Ask Helix' }: { question: string; context: string; label?: string }) {
  return (
    <button className="btn small ghost helix-ask" type="button" onClick={() => helixAsk({ question, context })}>
      <img src="/brand/genovus/genovus-egg.svg" alt="" aria-hidden="true" />{label}
    </button>
  );
}
