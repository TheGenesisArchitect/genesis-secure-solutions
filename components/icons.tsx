// Small stroke icons for the rail and command bar, drawn inline so there is no icon dependency.
// 24×24 grid, currentColor, 1.8 stroke.
const P: Record<string, string> = {
  overview: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  helix: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  studio: 'M4 7h16v12H4zM4 7l3-3h4l-3 3M12 7l3-3h4l-3 3M10 10.5v5l4.5-2.5z',
  check: 'M5 12.5l4.5 4.5L19 7',
  menu: 'M4 7h16M4 12h16M4 17h16',
  inbox: 'M4 13l2.5-8h11L20 13v6H4zM4 13h5l1.5 2.5h3L15 13h5',
  pipeline: 'M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v5h-4z',
  clients: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 6.5M21 20c0-2.6-1.6-4.8-4-5.6',
  approvals: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.6 2.5L16 9.5',
  care: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  assets: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  audit: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6zM9 12l2 2 4-4',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  setup: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  billing: 'M3 6h18v12H3zM3 10h18M7 15h4',
  team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3 2.7-5 6-5s6 2 6 5M14 15.3c.6-.2 1.3-.3 2-.3 3.3 0 6 2 6 5',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  building: 'M5 21V5l7-2v18M12 8l7 2v11M3 21h18M8 8h1M8 12h1M8 16h1M15 13h1M15 17h1',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  collapse: 'M15 6l-6 6 6 6M20 4v16',
  expand: 'M9 6l6 6-6 6M4 4v16',
  signout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  carriers: 'M4 8h16v11H4zM9 8V5h6v3M4 13h16',
  growth: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  dot: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const d = P[name] ?? P.dot;
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** Pick an icon for a nav item from its label or address, so every shell gets icons without listing them. */
export function iconFor(label: string, href: string): string {
  const l = label.toLowerCase();
  const rules: [RegExp, string][] = [
    [/overview/, 'overview'], [/helix/, 'helix'], [/follow/, 'check'], [/inquir/, 'inbox'], [/pipeline/, 'pipeline'], [/prospect|scanner/, 'target'], [/carrier/, 'carriers'],
    [/growth|financ/, 'growth'], [/client|agencies/, 'clients'], [/approv/, 'approvals'], [/care/, 'care'], [/asset|document/, 'assets'],
    [/audit/, 'audit'], [/domain|email/, 'globe'], [/meta|connector/, 'link'], [/^home$/, 'home'], [/setup/, 'setup'],
    [/performance/, 'chart'], [/billing/, 'billing'], [/team/, 'team'], [/console/, 'building'],
  ];
  for (const [re, name] of rules) if (re.test(l)) return name;
  if (href.startsWith('/network')) return 'map';
  return 'dot';
}
