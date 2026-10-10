// The Genovus World: one registry of every module in the platform, which surface it lives on (Enterprise, Agent,
// Network), which package unlocks it, and whether it is Live, Building or still Vision. It drives the World
// sandbox at /vision/world today and is meant to drive the real navigation later, so the map can't drift.
// Preview content is sample data about a fictional world (the demo agency, a sample network and carrier region).

export type Surface = 'enterprise' | 'agent' | 'network';
export type Tier = 'launch' | 'growth' | 'premium';
export type Status = 'live' | 'building' | 'vision';

export type WorldModule = {
  key: string;
  surface: Surface;
  name: string;
  icon: string;
  status: Status;
  /** Agent surface only: the lowest package that includes it. */
  tier?: Tier;
  /** The real page, when it is live (or the vision chapter that shows it). */
  route?: string;
  blurb: string;
  kpis?: [string, string][];
  items?: string[];
};

export const SURFACES: { key: Surface; name: string; who: string; promise: string }[] = [
  { key: 'enterprise', name: 'Enterprise', who: 'The Genovus team', promise: 'Built to serve the expansion: find agencies, win them, launch them, produce for them, and run the business behind it.' },
  { key: 'agent', name: 'Agent', who: 'The agency owner', promise: 'Premium packaging, hands-free: the agency keeps selling and building relationships while Genovus runs the rest.' },
  { key: 'network', name: 'Network', who: 'Agency networks and carrier regions', promise: 'Launch whole networks at once: onboarding status, rollup results and approved templates, never client data.' },
];

export const TIERS: { key: Tier; name: string; price: string; line: string }[] = [
  { key: 'launch', name: 'Launch', price: '$1,500 + $249/mo', line: 'Get found: the site, the profile, follow-ups that never slip.' },
  { key: 'growth', name: 'Growth', price: '$2,500 + $399/mo', line: 'Grow: content, campaigns, one calendar, and Helix, your first hire.' },
  { key: 'premium', name: 'Premium', price: '$5,000 + $799/mo', line: 'Run hands-free: give Helix a role, a task, a department, and your own Studio on autopilot.' },
];

export const STATUS_LABEL: Record<Status, string> = { live: 'Live', building: 'Building', vision: 'Vision' };

export const WORLD = {
  hq: 'Genovus HQ',
  agency: { name: 'Brooks Family Insurance', owner: 'Avery Brooks', slug: 'demo-brooks' },
  network: { name: 'Southern Agency Alliance', region: 'Sample Carrier · Southeast Region', agencies: 48 },
};

const app = (p: string) => `/app/${WORLD.agency.slug}${p}`;

export const MODULES: WorldModule[] = [
  // ---------- Enterprise ----------
  { key: 'radar', surface: 'enterprise', name: 'Radar & Prospects', icon: 'map', status: 'live', route: '/console/prospects',
    blurb: 'Maps every agency office by carrier and fit, then lines up the markets to win next.',
    kpis: [['Offices mapped', '2,750+'], ['Markets ranked', '14'], ['Top market', 'Columbus 86']], items: ['Sweep: Alabama 62% complete', 'New this week: 38 offices, 4 closures'] },
  { key: 'calls', surface: 'enterprise', name: 'Call Desk', icon: 'team', status: 'live', route: '/console/prospects/calls',
    blurb: 'The next best call with the reason, dialed by hand; outcomes logged in one tap.',
    kpis: [['Calls today', '24'], ['Consults booked', '3']], items: ['Next: Peachtree office · warm (opened the brief twice)'] },
  { key: 'pipeline', surface: 'enterprise', name: 'Pipeline & Clients', icon: 'pipeline', status: 'live', route: '/console/pipeline',
    blurb: 'Every agency from first call to launch to care, with what is due and who owns it.',
    kpis: [['In pipeline', '31'], ['Launching', '4'], ['Clients', '12']] },
  { key: 'studio', surface: 'enterprise', name: 'Studio', icon: 'studio', status: 'live', route: '/console/studio',
    blurb: 'A production studio: series, a cast with locked identities, shot-by-shot takes, thumbnails, and Ask Helix in every suite.',
    kpis: [['Series', 'Genovus Just Knows'], ['Episode 001', 'In production'], ['Spend this month', 'within cap']] },
  { key: 'pitch', surface: 'enterprise', name: 'Pitch Room', icon: 'growth', status: 'building',
    blurb: 'Drop a viral link; the Creative Team pitches the fork: why it works, where Genovus lands, cost and projections. Approve, rework or pass.',
    items: ['Rights card first (Remix confirmed)', 'Analyst · Writer · Director · Producer · Strategist', 'Helix presents; the animatic plays in the Screening Room', 'Weekly Pitch Hour on the calendar'] },
  { key: 'calendar', surface: 'enterprise', name: 'Genovus Calendar', icon: 'pipeline', status: 'building', route: '/vision/calendar',
    blurb: 'One calendar for every tenant: Pitch Hour, production deadlines, posts, consults, call blocks and launches, with a subscribe feed.' },
  { key: 'campaigns', surface: 'enterprise', name: 'Campaigns', icon: 'link', status: 'live', route: '/console/campaigns',
    blurb: 'Tracked links and sources for every post and outreach, so every view ties to a tour, an inquiry, a consult.' },
  { key: 'helix-inbox', surface: 'enterprise', name: 'Helix inbox', icon: 'helix', status: 'live', route: '/console/helix',
    blurb: 'Every note Helix takes on a tour or in the Studio; hand one to the build agent and a plan is drafted.' },
  { key: 'growth', surface: 'enterprise', name: 'Growth & financials', icon: 'chart', status: 'live', route: '/console/growth',
    blurb: 'Revenue, expenses (including AI spend), runway and the funnel economics behind the expansion.' },
  { key: 'carrier-rules', surface: 'enterprise', name: 'Carrier rules library', icon: 'carriers', status: 'live', route: '/console/carriers',
    blurb: 'Carrier-approved templates and rules, reused across every agency so one team can serve 100+.' },
  { key: 'approvals', surface: 'enterprise', name: 'Approvals & audit', icon: 'audit', status: 'live', route: '/console/approvals',
    blurb: 'Lane 3 decisions (publish, spend, send) with a hash-chained audit trail.' },
  { key: 'mission', surface: 'enterprise', name: 'Mission Control', icon: 'growth', status: 'vision', route: '/vision/mission',
    blurb: 'A goal becomes a plan approved once; agents run it through the lanes.' },
  { key: 'autopilot', surface: 'enterprise', name: 'Studio Autopilot', icon: 'studio', status: 'vision',
    blurb: 'After a pitch is approved, the departments build the episode while you watch: casting, camera, voice, lip-sync, edit, QA, publish.' },

  // ---------- Agent (Premium packaging) ----------
  { key: 'today', surface: 'agent', tier: 'launch', name: 'Today', icon: 'home', status: 'live', route: app('/today'),
    blurb: 'Open the phone, see the day: tomorrow’s call list, client notes, and anything waiting for one tap.',
    kpis: [['Calls ready', '6'], ['Waiting on you', '2']], items: ['Garcia family: renewal in 14 days', 'Thompson: new baby, review life coverage with a licensed agent'] },
  { key: 'follow-ups', surface: 'agent', tier: 'launch', name: 'Follow-ups', icon: 'clients', status: 'live', route: app('/follow-ups'),
    blurb: 'Log a follow-up in seconds; Genovus lines them up by day so tomorrow’s list is ready tonight.' },
  { key: 'site', surface: 'agent', tier: 'launch', name: 'Website & profile', icon: 'globe', status: 'live', route: app('/assets'),
    blurb: 'The agency’s own site and profile, carrier-approved, edits reviewed before they go live.' },
  { key: 'agent-approvals', surface: 'agent', tier: 'launch', name: 'Approvals', icon: 'approvals', status: 'live', route: app('/approvals'),
    blurb: 'Everything public waits for the owner’s one tap: posts, pages, campaigns.' },
  { key: 'performance', surface: 'agent', tier: 'launch', name: 'Performance', icon: 'chart', status: 'live', route: app('/performance'),
    blurb: 'Leads by source: which post, page or campaign brought each inquiry.' },
  { key: 'agent-calendar', surface: 'agent', tier: 'growth', name: 'Calendar', icon: 'pipeline', status: 'building',
    blurb: 'Their week in one place: consults, posts, renewals, call blocks; subscribe from Google or Apple Calendar.' },
  { key: 'content', surface: 'agent', tier: 'growth', name: 'Content & campaigns', icon: 'assets', status: 'vision', route: '/vision/content',
    blurb: 'Posts written in the agency’s voice, compliance-checked, approved in one tap, published on schedule.' },
  { key: 'ask-helix', surface: 'agent', tier: 'growth', name: 'Ask Helix: your first hire', icon: 'helix', status: 'building',
    blurb: 'Helix knows the business and every role in it: email, follow-ups, social replies, website chat, and the phone (receptionist, assistant).',
    items: ['“Who needs a call today?”', '“Draft a thank-you to the Garcias.”', 'Answers the website chat and books consults', 'Answers the phone, takes messages, warm-transfers'] },
  { key: 'helix-roles', surface: 'agent', tier: 'premium', name: 'Helix on the team', icon: 'team', status: 'vision',
    blurb: 'Assign Helix a role, a task or a department; it works the brief through the approval lanes and reports weekly.',
    items: ['Role: Service Assistant', 'Task: call back every renewal due in 30 days', 'Department: Marketing'] },
  { key: 'agency-studio', surface: 'agent', tier: 'premium', name: 'Agency Studio', icon: 'studio', status: 'vision',
    blurb: 'The agency’s own series on autopilot: pitches arrive, the owner taps approve, episodes post themselves.' },
  { key: 'helix-face', surface: 'agent', tier: 'premium', name: 'Helix on video', icon: 'helix', status: 'vision',
    blurb: 'Face-to-face video for the website concierge, consult intake and welcome calls (Tavus Griffin when it ships). Always disclosed as AI.' },
  { key: 'care', surface: 'agent', tier: 'launch', name: 'Care & billing', icon: 'billing', status: 'live', route: app('/billing'),
    blurb: 'The care plan, invoices and what the monthly plan covers.' },

  // ---------- Network ----------
  { key: 'net-agencies', surface: 'network', name: 'Agencies', icon: 'building', status: 'vision',
    blurb: 'Every agency the network referred, by onboarding stage: invited, profile, site review, live.',
    kpis: [['Referred', '48'], ['Live', '19'], ['In review', '7']] },
  { key: 'net-launch', surface: 'network', name: 'Launch tracker', icon: 'pipeline', status: 'vision',
    blurb: 'Batch launches: what each agency is waiting on and how long it has waited.' },
  { key: 'net-results', surface: 'network', name: 'Rollup results', icon: 'chart', status: 'vision',
    blurb: 'Aggregate only: sites live, inquiries per agency, consults per 100 conversations. Never client data.',
    kpis: [['Inquiries / agency / mo', '11.4'], ['Median time to launch', '9 days']] },
  { key: 'net-templates', surface: 'network', name: 'Approved templates', icon: 'carriers', status: 'vision',
    blurb: 'The carrier or network approves a template once; every agency in it can use it.' },
  { key: 'net-referrals', surface: 'network', name: 'Referrals', icon: 'link', status: 'vision',
    blurb: 'Referral status and credits for the network; matches the partner rule in the spec.' },
];

export const HELIX_ROLES: { key: string; name: string; tier: Tier; day: { t: string; what: string; lane?: string }[] }[] = [
  { key: 'assistant', name: 'Assistant (every channel)', tier: 'growth', day: [
    { t: '7:30', what: 'Prepared today’s follow-ups: 6 calls, each with the reason and a draft opener.' },
    { t: '9:12', what: 'Website chat: a visitor asked about bundling home and auto. Captured the lead with consent; booked a consult Thursday 2:00.', lane: 'auto' },
    { t: '11:40', what: 'Drafted a reply to Mrs. Garcia’s email about her renewal date. Waiting for your tap.', lane: 'one tap' },
    { t: '1:05', what: 'Phone: answered a call while you were with a client; took a message, texted you the summary.', lane: 'auto' },
    { t: '4:30', what: 'Drafted replies to 3 comments on Tuesday’s post. Waiting for your tap.', lane: 'one tap' },
  ] },
  { key: 'receptionist', name: 'Receptionist', tier: 'premium', day: [
    { t: '8:00', what: 'Phones open: answers with “This is Helix, Brooks Family Insurance’s AI assistant.”' },
    { t: '10:22', what: 'Warm-transferred a claims question to Avery; coverage questions always go to a licensed person.' },
    { t: '2:48', what: 'Booked two consults from calls; both on your calendar with notes.' },
  ] },
  { key: 'retention', name: 'Retention (task: renewals in 30 days)', tier: 'premium', day: [
    { t: 'Mon', what: 'Found 14 renewals due in 30 days; ranked by tenure and life events.' },
    { t: 'Tue', what: 'Drafted 14 personal check-in emails. Approved 12 in one batch.', lane: 'one tap' },
    { t: 'Fri', what: 'Weekly report: 9 replies, 4 reviews booked, 0 lapses.' },
  ] },
  { key: 'marketing', name: 'Marketing (department)', tier: 'premium', day: [
    { t: 'Mon', what: 'Planned the week: 3 posts and a Studio episode pitch, placed on the calendar.' },
    { t: 'Wed', what: 'Episode ready: tap to approve and publish.', lane: 'one tap' },
    { t: 'Fri', what: 'Results: 18k views, 41 profile visits, 3 inquiries tied to the episode.' },
  ] },
];

export const tierRank: Record<Tier, number> = { launch: 0, growth: 1, premium: 2 };
