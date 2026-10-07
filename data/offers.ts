// The Genovus offer, in one place: the public site, agency billing and the network view all read this.
// Prices are the operator-approved ones in docs/TECH_SPEC.md (Billing and payments; Pricing for new offers).
// Module pricing is still open, so modules carry no price.

export type Plan = {
  id: 'launch' | 'growth' | 'premium' | 'network' | 'enterprise';
  name: string;
  forWho: string;
  setupCents: number | null;
  careCents: number | null;
  careName: string | null;
  summary: string;
  includes: string[];
};

export const PLANS: Plan[] = [
  {
    id: 'launch', name: 'Launch', forWho: 'A single agency getting started', setupCents: 150_000, careCents: 24_900, careName: 'Essential Care',
    summary: 'A carrier-aware website, Facebook and Instagram set up live with you, and tracked callbacks.',
    includes: ['Landing page built from your agent record', 'Facebook Page and Instagram, set up together on a call', 'Google Business Profile guidance', 'Launch posts drafted for your approval', 'Every callback tagged with its source', 'Personal welcome film and setup guide'],
  },
  {
    id: 'growth', name: 'Growth', forWho: 'Agencies ready to grow', setupCents: 250_000, careCents: 39_900, careName: 'Growth Care',
    summary: 'Up to five pages, intake and booking, and monthly posts with reviews.',
    includes: ['Everything in Launch', 'Up to 5 pages', 'Online intake and booking', 'Monthly content calendar', 'Review requests', 'Monthly report with one improvement'],
  },
  {
    id: 'premium', name: 'Premium', forWho: 'Established agencies', setupCents: 500_000, careCents: 79_900, careName: 'Optimization Care',
    summary: 'Up to eight pages, campaign pages, CRM and an AI concierge that answers only from approved facts.',
    includes: ['Everything in Growth', 'Up to 8 pages plus campaign pages', 'CRM and lead pipeline', 'AI concierge (approved answers only)', 'Ads management available', 'Priority response'],
  },
  {
    id: 'network', name: 'Network', forWho: 'Groups of agencies, such as an owner’s network', setupCents: null, careCents: null, careName: null,
    summary: 'Group onboarding, shared approved templates and referral credit across your agencies.',
    includes: ['Group pricing', 'Shared approved templates and wording', 'One network view of every office', 'Referral credit'],
  },
  {
    id: 'enterprise', name: 'Enterprise', forWho: 'Carriers', setupCents: null, careCents: null, careName: null,
    summary: 'Your wording rules and templates applied to every agency, approval routing and a portfolio dashboard, starting with a 90-day pilot.',
    includes: ['Carrier wording rules and template library', 'Approval routing with an audit trail', 'Portfolio dashboard across agencies', 'Network pricing, starting with a 90-day pilot'],
  },
];

export const ADD_ONS = [
  { name: 'Ads management', price: 'Greater of $300/mo or 15% of spend, plus $350 setup', note: 'Spend stays on your own card; never tied to policies sold.' },
  { name: 'Annual prepay', price: '12 months of care for the price of 10', note: '' },
  { name: 'Launch kit for captives going independent', price: '$3,500 one time', note: 'Growth build, brand identity, domain and business email, social profiles, eight launch posts and the first month of Growth Care.' },
];

export const RESPONSE_TIMES = [
  { plan: 'Launch', reply: '2 business days' },
  { plan: 'Growth', reply: '1 business day' },
  { plan: 'Premium', reply: '4 business hours' },
  { plan: 'Every plan: site down or lead form not delivering', reply: '2 business hours' },
];
