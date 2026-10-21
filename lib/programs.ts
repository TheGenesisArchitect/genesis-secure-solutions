// The agency programs as modules: which program includes each one, and whether it is live in the dashboard yet.
// The agency nav, the home page and the "Your program" page read this, so what an agency sees always matches what
// its program promises (data/offers.ts holds the prices and the public wording).

export type ProgramId = 'launch' | 'growth' | 'premium';
export type ProgramModule = {
  key: string;
  label: string;
  /** The lowest program that includes it (for an option: the program it can be added to). */
  tier: ProgramId;
  /** A paid option: never included by a program, only switched on per agency. */
  option?: boolean;
  /** Live in the dashboard now, or coming (shown honestly as coming). */
  live: boolean;
  /** Path under /app/<slug> ('' = home). */
  path?: string;
  blurb: string;
};

export const PROGRAM_NAME: Record<ProgramId, string> = { launch: 'Launch', growth: 'Growth', premium: 'Premium' };
export const RANK: Record<ProgramId, number> = { launch: 0, growth: 1, premium: 2 };

/** An agency's program: VIP and unknown plans read as Launch until a program is set. */
export const programOf = (plan: string | null | undefined): ProgramId => (plan === 'growth' || plan === 'premium' ? plan : 'launch');
export const includes = (program: ProgramId, m: ProgramModule) => !m.option && RANK[m.tier] <= RANK[program];

export const MODULES: ProgramModule[] = [
  // Launch: get found, answer every lead, keep every promise.
  { key: 'leads', label: 'Leads', tier: 'launch', live: true, path: '/leads', blurb: 'Every callback and phone call in one inbox, tagged with where it came from: your site, Google, Facebook, a partner.' },
  { key: 'today', label: 'Today', tier: 'launch', live: true, path: '/today', blurb: 'Your phone home: tomorrow’s calls, the notes behind them, priorities on top.' },
  { key: 'follow-ups', label: 'Follow-ups', tier: 'launch', live: true, path: '/follow-ups', blurb: 'Log a follow-up in seconds; it comes back the day it’s due.' },
  { key: 'setup', label: 'Setup', tier: 'launch', live: true, path: '/setup', blurb: 'Your welcome guide, Facebook, Instagram and Google profile set up together.' },
  { key: 'approvals', label: 'Approvals', tier: 'launch', live: true, path: '/approvals', blurb: 'Launch posts and page changes wait for your one tap.' },
  { key: 'care', label: 'Monthly care', tier: 'launch', live: true, path: '/care', blurb: 'Ask for a change and see it handled within your plan’s reply time.' },
  { key: 'performance', label: 'Performance', tier: 'launch', live: true, path: '/performance', blurb: 'Leads by source and how fast your office replies.' },
  { key: 'assets', label: 'Assets & documents', tier: 'launch', live: true, path: '/assets', blurb: 'Your site, welcome film, cover art and agreements in one place.' },
  // Growth: Helix, your first hire; a pipeline and calendar that run the week; content and reviews every month.
  { key: 'pipeline', label: 'Pipeline', tier: 'growth', live: true, path: '/pipeline', blurb: 'Every lead by stage, from first call to booked to won, with the next step on each.' },
  { key: 'partners', label: 'Partners', tier: 'growth', live: true, path: '/partners', blurb: 'Local businesses whose customers buy what you sell, mapped near your office, with who to call first and a referral link for each.' },
  { key: 'market', label: 'Market', tier: 'growth', live: true, path: '/market', blurb: 'What your market needs this season, who’s out there, and which sources bring leads for less than the $50 vendors charge.' },
  { key: 'radar', label: 'Competitor Radar', tier: 'growth', live: true, path: '/radar', blurb: 'Every insurance office around yours, by carrier, distance and ZIP, with their Google ratings and a tap to see their ads, so your campaigns lead where they aren’t.' },
  { key: 'calendar', label: 'Calendar', tier: 'growth', live: true, path: '/calendar', blurb: 'Your week in one place: follow-ups, booked consults and scheduled posts; subscribe from Google or Apple Calendar.' },
  { key: 'helix', label: 'Ask Helix', tier: 'growth', live: true, path: '/helix', blurb: 'Helix knows your business: who to call today, where leads come from, a follow-up drafted for one tap.' },
  { key: 'helix-notes', label: 'Helix notes', tier: 'growth', live: true, path: '/helix/notes', blurb: 'What you tell Helix, kept and turned into work: to-dos become follow-ups in one tap, questions go to the Genovus team.' },
  { key: 'kpis', label: 'KPI scorecard', tier: 'growth', live: true, path: '/performance', blurb: 'Contact, booked and won rates, time to first call and posts published, every week.' },
  { key: 'content', label: 'Content calendar', tier: 'growth', live: true, path: '/care', blurb: 'Monthly posts drafted for your approval and scheduled for you.' },
  { key: 'calls', label: 'Call tracking', tier: 'growth', option: true, live: true, path: '/leads', blurb: 'Local numbers for your site, Google profile or partners: every call rings your office, lands in Leads tagged with where it came from, and Helix writes the note. A Growth option.' },
  { key: 'reviews', label: 'Review requests', tier: 'growth', live: false, blurb: 'Mark a lead won and send a ready-made review request in one tap.' },
  { key: 'report', label: 'Monthly report', tier: 'growth', live: false, blurb: 'What worked this month, the numbers, and the one improvement we’ll make next.' },
  { key: 'booking', label: 'Online booking', tier: 'growth', live: false, blurb: 'Visitors request a consult time on your site; it lands on your calendar.' },
  // Premium: run hands-free.
  { key: 'owners', label: 'Lead owners', tier: 'premium', live: false, blurb: 'Assign every lead to a person on your team and see who has what.' },
  { key: 'helix-roles', label: 'Helix on the team', tier: 'premium', live: false, blurb: 'Give Helix a role, a task or a department; it works the brief and reports weekly.' },
  { key: 'concierge', label: 'AI concierge', tier: 'premium', live: false, blurb: 'Answers website visitors from your approved facts only, and books consults.' },
  { key: 'studio', label: 'Agency Studio', tier: 'premium', live: false, blurb: 'Your own series: short episodes made for you, approved in one tap, posted on schedule.' },
  { key: 'campaigns', label: 'Campaign pages', tier: 'premium', live: false, blurb: 'A page per campaign, each tracked to the leads it brings.' },
];

/** Reply time for Monthly care requests, by program (matches RESPONSE_TIMES in data/offers.ts). */
export const REPLY_TIME: Record<ProgramId, string> = { launch: '2 business days', growth: '1 business day', premium: '4 business hours' };
