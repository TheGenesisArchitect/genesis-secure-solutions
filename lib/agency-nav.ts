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
        { href: `${base}/program`, label: 'Your program', icon: 'overview' },
      ],
    },
    ...(opts.staffSlug ? [{ title: 'Genovus team', items: [{ href: `/console/clients/${opts.staffSlug}`, label: 'This client in the console' }] }] : []),
  ];
}

/** Pages Helix can take someone to by voice or text: the menu, minus the pages that would end a voice session
 *  (the full Ask Helix page, the Studio) and the hop out to the console. */
export function helixPages(nav: NavSection[]): { label: string; href: string }[] {
  return nav.flatMap((s) => s.items).filter((i) => !/\/helix$|^\/console\/(studio|helix\/ask)|^\/console\/clients\//.test(i.href)).map((i) => ({ label: i.label, href: i.href }));
}
