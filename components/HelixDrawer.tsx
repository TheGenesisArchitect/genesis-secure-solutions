'use client';
// Ask Helix from anywhere in the agency dashboard: the egg button (or Ctrl+J) opens Helix beside the page, already
// knowing which page you're on, and listening: talk, or type. One Ask Helix, voice and typing in the same panel. Any "Ask Helix" button on a lead, call or partner opens it with that item loaded and
// the question asked (helixAsk below). One Helix, the same brief everywhere, so answers agree on every screen.
// The agency layout mounts it once (HelixHost), so the conversation travels with you from page to page.
import { usePathname } from 'next/navigation';
import { AskHelixAgency } from './AskHelixAgency';
import { HelixTour } from './vision/HelixTour';
import { HelixDock } from './HelixHost';

type Ask = { question?: string; context?: string };
const EVT = 'genovus:helix';
/** The event every Ask Helix button sends; the agency drawer and the Enterprise drawer both listen for it. */
export const HELIX_EVT = EVT;

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
  const page = PAGE.find((p) => p.match.test(path)) ?? HOME;
  return (
    <HelixDock
      path={path}
      pageName={page.name}
      fullHref={`/app/${slug}/helix`}
      hidden={/\/helix$/.test(path)}
      voice={(autoStart) => <HelixTour embedded autoStart={autoStart} context="agency" slug={slug} where={`the ${page.name} page`} />}
      chat={(ask) => <AskHelixAgency slug={slug} tenantId={tenantId} compact page={page.name} context={ask.context ?? `the ${page.name} page`} suggest={page.suggest} start={ask.question} startN={ask.n} />}
    />
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
