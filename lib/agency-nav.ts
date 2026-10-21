// The agency dashboard's pages, as one list: the rail, Ctrl+K and Helix's "go to" all read it, so Helix only offers
// pages this agency can open (its program plus any grant or trial).
import type { NavSection } from '@/components/Shell';

type Count = Promise<number> | undefined;

export function agencyNav(base: string, has: (k: string) => boolean, opts: { isOwner: boolean; programTitle: string; staffSlug?: string; counts?: { fresh?: Count; due?: Count; pending?: Count; open?: Count } }): NavSection[] {
  const c = opts.counts ?? {};
  return [
    {
      items: [
        { href: base, label: 'Home', exact: true },
        { href: `${base}/leads`, label: 'Leads', icon: 'inbox', count: c.fresh },
        ...(has('pipeline') ? [{ href: `${base}/pipeline`, label: 'Pipeline', icon: 'pipeline' }] : []),
        ...(has('partners') ? [{ href: `${base}/partners`, label: 'Partners', icon: 'team' }] : []),
        ...(has('calendar') ? [{ href: `${base}/calendar`, label: 'Calendar', icon: 'target' }] : []),
        { href: `${base}/today`, label: 'Today', icon: 'home' },
        { href: `${base}/follow-ups`, label: 'Follow-ups', count: c.due },
      ],
    },
    {
      title: opts.programTitle,
      items: [
        ...(has('helix') ? [{ href: `${base}/helix`, label: 'Ask Helix', icon: 'helix', exact: true }] : []),
        ...(has('helix-notes') ? [{ href: `${base}/helix/notes`, label: 'Helix notes', icon: 'inbox' }] : []),
        ...(has('market') ? [{ href: `${base}/market`, label: 'Market', icon: 'globe' }] : []),
        ...(has('radar') ? [{ href: `${base}/radar`, label: 'Competitor Radar', icon: 'target' }] : []),
        { href: `${base}/setup`, label: 'Setup' },
        { href: `${base}/approvals`, label: 'Approvals', count: c.pending },
        { href: `${base}/care`, label: has('content') ? 'Care & content' : 'Monthly care', count: c.open },
        { href: `${base}/performance`, label: has('kpis') ? 'Performance & KPIs' : 'Performance' },
      ],
    },
    {
      title: 'Your business',
      items: [
        { href: `${base}/assets`, label: 'Assets & documents' },
        ...(opts.isOwner ? [{ href: `${base}/billing`, label: 'Billing & maintenance' }] : []),
        { href: `${base}/team`, label: 'Team' },
        { href: `${base}/whats-new`, label: 'What’s new', icon: 'helix' },
        { href: `${base}/program`, label: 'Your program', icon: 'overview' },
      ],
    },
    ...(opts.staffSlug ? [{ title: 'Genovus team', items: [{ href: `/console/clients/${opts.staffSlug}`, label: 'This client in the console' }] }] : []),
  ];
}

/** Pages Helix can take someone to by voice or text: the menu, minus only the pages that would end a voice session
 *  (the full Ask Helix page of an agency or the console, and the Studio) and the hop from an agency to the console. */
const OFF = /^\/app\/[^/]+\/helix$|^\/console\/helix\/ask$|^\/console\/studio(\/|$)|^\/console\/clients\/[^/]+$/;
export function helixPages(nav: NavSection[]): { label: string; href: string }[] {
  return nav.flatMap((s) => s.items).filter((i) => !OFF.test(i.href)).map((i) => ({ label: i.label, href: i.href }));
}

/** Every menu page with its name, for telling Helix which page the person is on. */
export const navPages = (nav: NavSection[]): { label: string; href: string }[] => nav.flatMap((s) => s.items).map((i) => ({ label: i.label, href: i.href }));

/** The page the person is on, by the longest menu link that matches the address (a client page is "Clients"). */
export function pageNameFor(path: string, pages: { label: string; href: string }[]): string | null {
  let best: { label: string; href: string } | null = null;
  for (const p of pages) if ((path === p.href || path.startsWith(p.href + '/')) && (!best || p.href.length > best.href.length)) best = p;
  return best?.label ?? null;
}
