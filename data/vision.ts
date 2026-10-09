// Sample data for the Genovus Growth Engine vision (/vision). Every figure here is illustrative and is shown
// with a Sample or Projection label; nothing is a real prospect, office or result.

export const CHAPTERS = [
  { slug: '', n: 1, title: 'The national map comes alive', short: 'National map', icon: 'map' },
  { slug: 'market', n: 2, title: 'Market brief: Columbus, GA', short: 'Market brief', icon: 'target' },
  { slug: 'mission', n: 3, title: 'Mission Control', short: 'Mission Control', icon: 'growth' },
  { slug: 'content', n: 4, title: 'Content Desk', short: 'Content Desk', icon: 'assets' },
  { slug: 'studio', n: 5, title: 'Genovus Studio', short: 'Studio', icon: 'overview' },
  { slug: 'calendar', n: 6, title: 'One calendar for the business', short: 'Calendar', icon: 'pipeline' },
  { slug: 'calls', n: 7, title: 'Call Desk', short: 'Call Desk', icon: 'team' },
  { slug: 'funnel', n: 8, title: 'Funnel and business intelligence', short: 'Funnel & BI', icon: 'chart' },
  { slug: 'flywheel', n: 9, title: 'Side B: the flywheel', short: 'Flywheel', icon: 'care' },
  { slug: 'briefing', n: 10, title: 'Helix Live', short: 'Helix Live', icon: 'inbox' },
] as const;

export type Market = { slug: string; name: string; state: string; lat: number; lon: number; offices: number; captive: number; fit: number; status: 'live' | 'warming' | 'next' | 'radar' };

// Illustrative market sizes (Sample), placed at real city coordinates.
export const MARKETS: Market[] = [
  { slug: 'columbus-ga', name: 'Columbus', state: 'GA', lat: 32.46, lon: -84.99, offices: 142, captive: 108, fit: 91, status: 'live' },
  { slug: 'atlanta-ga', name: 'Atlanta', state: 'GA', lat: 33.75, lon: -84.39, offices: 980, captive: 742, fit: 86, status: 'warming' },
  { slug: 'macon-ga', name: 'Macon', state: 'GA', lat: 32.84, lon: -83.63, offices: 118, captive: 91, fit: 84, status: 'next' },
  { slug: 'savannah-ga', name: 'Savannah', state: 'GA', lat: 32.08, lon: -81.09, offices: 133, captive: 97, fit: 82, status: 'next' },
  { slug: 'augusta-ga', name: 'Augusta', state: 'GA', lat: 33.47, lon: -81.97, offices: 121, captive: 90, fit: 80, status: 'radar' },
  { slug: 'birmingham-al', name: 'Birmingham', state: 'AL', lat: 33.52, lon: -86.81, offices: 296, captive: 214, fit: 85, status: 'next' },
  { slug: 'montgomery-al', name: 'Montgomery', state: 'AL', lat: 32.37, lon: -86.3, offices: 124, captive: 96, fit: 83, status: 'radar' },
  { slug: 'mobile-al', name: 'Mobile', state: 'AL', lat: 30.69, lon: -88.04, offices: 139, captive: 99, fit: 79, status: 'radar' },
  { slug: 'jacksonville-fl', name: 'Jacksonville', state: 'FL', lat: 30.33, lon: -81.66, offices: 402, captive: 268, fit: 78, status: 'radar' },
  { slug: 'tampa-fl', name: 'Tampa', state: 'FL', lat: 27.95, lon: -82.46, offices: 611, captive: 389, fit: 77, status: 'radar' },
  { slug: 'orlando-fl', name: 'Orlando', state: 'FL', lat: 28.54, lon: -81.38, offices: 547, captive: 352, fit: 77, status: 'radar' },
  { slug: 'miami-fl', name: 'Miami', state: 'FL', lat: 25.76, lon: -80.19, offices: 893, captive: 471, fit: 74, status: 'radar' },
  { slug: 'houston-tx', name: 'Houston', state: 'TX', lat: 29.76, lon: -95.37, offices: 1288, captive: 801, fit: 81, status: 'radar' },
  { slug: 'dallas-tx', name: 'Dallas–Fort Worth', state: 'TX', lat: 32.78, lon: -96.8, offices: 1402, captive: 912, fit: 82, status: 'radar' },
  { slug: 'san-antonio-tx', name: 'San Antonio', state: 'TX', lat: 29.42, lon: -98.49, offices: 611, captive: 402, fit: 80, status: 'radar' },
  { slug: 'austin-tx', name: 'Austin', state: 'TX', lat: 30.27, lon: -97.74, offices: 498, captive: 311, fit: 79, status: 'radar' },
];

export const MARKET_STATUS: Record<Market['status'], { label: string; tone: string }> = {
  live: { label: 'Live campaign', tone: 'done' },
  warming: { label: 'Warming (organic)', tone: 'info' },
  next: { label: 'Up next', tone: 'pending' },
  radar: { label: 'On Radar', tone: 'dev' },
};

// Columbus, GA brief (Sample).
export const COLUMBUS = {
  carriers: [
    { name: 'State Farm', n: 41 }, { name: 'Allstate', n: 22 }, { name: 'Farmers', n: 14 }, { name: 'Georgia Farm Bureau', n: 11 },
    { name: 'GEICO', n: 6 }, { name: 'Alfa', n: 4 }, { name: 'Other captive', n: 10 }, { name: 'Independent', n: 34 },
  ],
  noOwnSite: 63, // % of offices with only a carrier page or no site
  searches: 18400, // monthly local searches for insurance terms (Sample)
  competitorAds: 9, // agencies running Meta ads in the market (Sample)
  fitBands: [{ band: '90+', n: 38 }, { band: '80–89', n: 51 }, { band: '70–79', n: 33 }, { band: '<70', n: 20 }],
};

export type Step = { id: string; title: string; detail: string; lane: 1 | 2 | 3; agent: string; cost?: string };
export const MISSION: { title: string; goal: string; budget: string; forecast: string; steps: Step[] } = {
  title: 'Launch market: Columbus, GA',
  goal: '8 consults and 3 new clients in 6 weeks, organic + calls only',
  budget: '$0 media · ~$120 data and tools',
  forecast: '3 clients × $1,500 setup + $249/mo care (Projection)',
  steps: [
    { id: 's1', title: 'Market brief', detail: '142 offices ranked by fit; 63% have no site of their own', lane: 1, agent: 'Radar' },
    { id: 's2', title: 'Content series: “Columbus agents”', detail: '12 posts + 2 Studio shorts drafted for FB, IG, LinkedIn', lane: 2, agent: 'Content' },
    { id: 's3', title: 'Compliance check', detail: 'Carrier wording, no quotes, AI disclosure on shorts', lane: 1, agent: 'Verified Work' },
    { id: 's4', title: 'Publish week 1 on Genovus profiles', detail: '4 posts + 1 Reel, tracked links per market', lane: 3, agent: 'Content' },
    { id: 's5', title: 'Call blocks on the calendar', detail: 'Tue/Thu 10–12 and 2–4 local time, 2 callers', lane: 2, agent: 'Scheduler' },
    { id: 's6', title: 'Call briefs for the top 40', detail: 'Fit reasons, local hook, last touch', lane: 1, agent: 'Call Desk' },
    { id: 's7', title: 'Book consults', detail: 'Live booking page; confirmation + reminder emails', lane: 2, agent: 'Scheduler' },
  ],
};

export type Post = { id: string; network: 'facebook' | 'instagram' | 'linkedin'; audience: string; hook: string; body: string; image: string; check: 'pass' | 'fixed'; note: string };
export const POSTS: Post[] = [
  { id: 'p1', network: 'instagram', audience: 'State Farm agents', hook: 'Your neighbors are searching. Are they finding you?', body: '18,400 insurance searches a month in Columbus. We build the local page, profiles and reviews that put your office in front of them, approved by you, built to your carrier’s rules.', image: '/site/stills/s03.jpg', check: 'pass', note: 'Carrier named in text only; no logos' },
  { id: 'p2', network: 'linkedin', audience: 'Independent agencies', hook: 'Many carriers. One local brand.', body: 'Independent agencies win on trust. Genovus gives you a site, social and tracked callbacks that sound like you, live in days, with every word approved by you.', image: '/site/stills/s05.jpg', check: 'pass', note: 'No coverage or price claims' },
  { id: 'p3', network: 'facebook', audience: 'New agency owners', hook: 'Opened your office this year?', body: 'New offices need to be found from day one. Launch includes your page, profiles and a welcome film, set up live with you in a single call.', image: '/site/stills/s07.jpg', check: 'fixed', note: 'Removed “guaranteed leads”: outcome claims need proof' },
  { id: 'p4', network: 'instagram', audience: 'Spanish-speaking agents', hook: 'Tu oficina, encontrada.', body: 'Páginas y perfiles en español e inglés para tu agencia, aprobados por ti, conforme a las reglas de tu aseguradora.', image: '/site/stills/s09.jpg', check: 'pass', note: 'Bilingual copy reviewed by a person' },
];

export type Shot = { n: number; desc: string; camera: string; model: string; secs: number; still: string };
// The programming slate: two editorial divisions on one production system.
export const SERIES = [
  { name: 'The Local Office', division: 'Genovus Originals', kind: 'Workplace comedy and drama', episodes: 6, status: 'Season 1 in production', views: 48200, watch: 71, scene: 'desk' },
  { name: 'Genovus Just Knows', division: 'Genovus Originals', kind: 'Comedy spots: chaos in the scene, calm on the phone', episodes: 3, status: 'Concepts in development', views: 0, watch: 0, scene: 'skyline' },
  { name: 'After Hours', division: 'Genovus Originals', kind: 'Owners balancing business and home', episodes: 3, status: 'Scripts in review', views: 0, watch: 0, scene: 'skyline' },
  { name: 'Main Street', division: 'Both', kind: 'Real agencies, written consent', episodes: 1, status: 'E1: JAVA Agency (pending consent)', views: 0, watch: 0, scene: 'street' },
  { name: 'Life Changed. Did Your Coverage?', division: 'Agency Originals', kind: 'Moving, buying, family, business', episodes: 4, status: 'Template ready for agencies', views: 15600, watch: 62, scene: 'dawn' },
  { name: 'The Group Chat', division: 'Agency Originals', kind: 'Comedy: confident advice, unexpected question', episodes: 5, status: 'Live', views: 21900, watch: 66, scene: 'kitchen' },
  { name: 'Before You Assume', division: 'Agency Originals', kind: 'Short scenarios, one practical question', episodes: 4, status: 'Live', views: 9300, watch: 58, scene: 'endcard' },
] as const;

// "Genovus Just Knows": short comedy spots built for sharing. The scene is loud and absurd; the agent who uses
// Genovus stays calm, and the product moment is a real capture. Viral reels are vibe references only: never their
// footage, audio, performers or likeness. Characters are original designs.
export const SPOTS = [
  { name: '“The Night Out”', hook: 'A showman’s dance move, mid-spin (first 2 seconds)', beats: ['Five seconds of the performance on stage.', 'Cut to three agents in the crowd: two realize they forgot tomorrow’s follow-ups.', 'The third checks Genovus on her phone: tomorrow’s call list is ready, the follow-ups are already on it.', '“We’re good.” Cut back to the dancer; the friends cheer, relieved.'], product: 'Call list and follow-ups on the phone', end: 'She looks into the camera: “Genovus just knows.”' },
  { name: '“The Tin Man and the Lion”', hook: 'Two storybook characters mid-argument as the door opens', beats: ['The agent walks into the next appointment and finds a tin man and a lion arguing.', 'They freeze. Awkward silence. A notification lights up the agent’s phone.', 'The argument resumes in the background while the agent works through leads and approves a task.', 'Cut back: the tin man storms out the door.'], product: 'Leads list and one-tap approval', end: 'The agent shrugs at the camera: “Genovus just knows.”' },
  { name: '“The Gas Station”', hook: 'A leprechaun dancing under parking-lot lights', beats: ['Young coworkers wait late at a gas station: their new client wanted to meet after work.', 'A notification: the client’s photo appears, and he is a leprechaun.', 'The client is a lot of fun; between dance breaks the agent adds a note and the follow-up lands on the Genovus calendar.', 'Cut back to the leprechaun, still dancing.'], product: 'Client note → follow-up on the calendar', end: '“Genovus just knows.”' },
];

export const PILOTS = [
  { name: '“I Thought You Called Them”', division: 'Genovus Originals · The Local Office', beats: ['Two employees each assume the other followed up.', 'A third asks who actually owns the inquiry.', 'Cut to a real Genovus capture: assignment and acknowledgment.', 'The inquiry reaches the right person.'], end: 'Give every inquiry a next step.' },
  { name: '“The Moving Checklist”', division: 'Agency Originals · JAVA Agency', beats: ['Someone carefully packs for a move.', 'A friend asks: did you review your insurance for the move?', 'A beat of realization; one more line on the checklist.'], end: 'An invitation to talk with Mendez’s office.' },
];

// Market heat (Sample): engagement lift vs own baseline, consults per 100 conversations, fit density, cost per conversation.
export const HEAT = [
  { market: 'Columbus, GA', heat: 86, lift: 41, consults: 14.5, fit: 0.76, cpc: 3.1, sample: 214, confidence: 'High' },
  { market: 'Atlanta, GA', heat: 71, lift: 22, consults: 9.8, fit: 0.71, cpc: 5.4, sample: 162, confidence: 'Medium' },
  { market: 'Macon, GA', heat: 58, lift: 18, consults: 6.0, fit: 0.69, cpc: 4.2, sample: 50, confidence: 'Low' },
  { market: 'Phenix City, AL', heat: null as number | null, lift: 3, consults: 0, fit: 0.72, cpc: 0, sample: 11, confidence: 'Not enough data' },
];
export const EPISODE = {
  title: 'The Local Office · S1E1 “Found”',
  logline: 'A new agent opens her office on Main Street. Nobody can find it, until the night a neighbor does.',
  shots: [
    { n: 1, desc: 'Dawn over a small-town main street; a hand flips the office sign to OPEN', camera: 'Slow push-in, golden hour', model: 'Veo 3.1', secs: 5, still: '/site/stills/s01.jpg' },
    { n: 2, desc: 'The agent at her desk, phone silent, empty waiting chairs', camera: 'Static wide, then rack focus', model: 'Runway', secs: 6, still: '/site/stills/s02.jpg' },
    { n: 3, desc: 'Across town, a neighbor searches “insurance agent near me” at the kitchen table', camera: 'Over-the-shoulder, screen glow', model: 'Kling 3.0', secs: 5, still: '/site/stills/s03.jpg' },
    { n: 4, desc: 'Her new page appears: photo, reviews, “Call the office”', camera: 'Macro on phone screen', model: 'Veo 3.1', secs: 4, still: '/site/stills/s04.jpg' },
    { n: 5, desc: 'The office phone rings; she smiles and answers', camera: 'Handheld close-up', model: 'Runway', secs: 5, still: '/site/stills/s05.jpg' },
    { n: 6, desc: 'End card: “Be found. Genovus.” + tracked link', camera: 'Motion graphics', model: 'Render worker', secs: 4, still: '/site/stills/s06.jpg' },
  ] as Shot[],
};

export type CalItem = { day: number; kind: 'post' | 'short' | 'calls' | 'consult' | 'launch' | 'care' | 'carrier'; label: string; market?: string; lane?: 1 | 2 | 3 };
// October 2026 (Sample). Day = day of month.
export const CALENDAR: CalItem[] = [
  { day: 1, kind: 'care', label: 'Care invoices drafted (12)' },
  { day: 5, kind: 'post', label: 'Columbus: “Neighbors searching”', market: 'Columbus', lane: 3 },
  { day: 6, kind: 'calls', label: 'Call block 10–12 · Columbus', market: 'Columbus' },
  { day: 7, kind: 'short', label: 'The Local Office S1E1', lane: 3 },
  { day: 8, kind: 'calls', label: 'Call block 2–4 · Columbus', market: 'Columbus' },
  { day: 8, kind: 'consult', label: 'Consult: Peachtree office', market: 'Columbus' },
  { day: 9, kind: 'post', label: 'LinkedIn: “One local brand”', lane: 3 },
  { day: 12, kind: 'post', label: 'Atlanta warm-up series begins', market: 'Atlanta', lane: 3 },
  { day: 13, kind: 'calls', label: 'Call block 10–12 · Columbus', market: 'Columbus' },
  { day: 14, kind: 'consult', label: 'Consult: Riverwalk office', market: 'Columbus' },
  { day: 14, kind: 'short', label: '60 Seconds to Found #5', lane: 3 },
  { day: 15, kind: 'calls', label: 'Call block 2–4 · Columbus', market: 'Columbus' },
  { day: 16, kind: 'launch', label: 'Client launch: Phenix City office' },
  { day: 19, kind: 'post', label: 'Atlanta: “New owners” spot', market: 'Atlanta', lane: 3 },
  { day: 20, kind: 'calls', label: 'Call block · Atlanta pilot', market: 'Atlanta' },
  { day: 21, kind: 'consult', label: 'Consult: Midtown office', market: 'Atlanta' },
  { day: 21, kind: 'short', label: 'The Local Office S1E2', lane: 3 },
  { day: 22, kind: 'carrier', label: 'Carrier compliance review window' },
  { day: 26, kind: 'calls', label: 'Call block · Atlanta pilot', market: 'Atlanta' },
  { day: 28, kind: 'consult', label: 'Consult: Buckhead office', market: 'Atlanta' },
  { day: 28, kind: 'post', label: 'Main Street E1 (with consent)', lane: 3 },
  { day: 30, kind: 'launch', label: 'Client launch: Midtown office' },
];

export const CALL = {
  office: 'Peachtree Insurance Office (Sample)', carrier: 'State Farm', market: 'Columbus, GA', fit: 94, local: '10:42 AM EDT',
  reasons: ['No website of its own: only a carrier page', '4.8★ with 61 reviews: strong word of mouth to amplify', 'Opened 2 years ago: still building local presence'],
  hook: 'Saw our “Neighbors are searching” post on Facebook on Monday (tracked link: 2 visits).',
  opener: 'Hi, this is Anthony with Genovus in Columbus. We help local agents get found online, built to your carrier’s rules. Do you have 15 minutes this week for a quick look at what Columbus searches for?',
  never: ['Quote or discuss coverage', 'Claim a carrier partnership', 'Call back after “do not call”'],
};

export const FUNNEL = [
  { stage: 'Reached (organic)', n: 12400, cost: 0 },
  { stage: 'Engaged', n: 860, cost: 0 },
  { stage: 'Conversations', n: 214, cost: 0 },
  { stage: 'Consults', n: 31, cost: 0 },
  { stage: 'Proposals', n: 14, cost: 0 },
  { stage: 'Deposits', n: 6, cost: 0 },
  { stage: 'Live', n: 5, cost: 0 },
  { stage: 'On care', n: 4, cost: 0 },
];
export const GATE = { metric: 'Consults per 100 conversations', threshold: 3, actual: 14.5 };

export const MARKET_PNL = [
  { market: 'Columbus, GA', spend: 640, clients: 3, setup: 4500, mrr: 747, cac: 213, payback: 'At setup' },
  { market: 'Atlanta, GA', spend: 1180, clients: 2, setup: 4000, mrr: 648, cac: 590, payback: 'At setup' },
  { market: 'Birmingham, AL', spend: 0, clients: 0, setup: 0, mrr: 0, cac: null as number | null, payback: '—' },
];

export const BRIEFING = {
  date: 'Thursday, October 8, 2026',
  happened: [
    'Radar found 46 new offices overnight in Birmingham and Montgomery; 31 score 85+.',
    '“Neighbors are searching” reached 3,100 people in Columbus; 2 office owners clicked through.',
    'Peachtree office booked a consult for Tuesday 10:00 from yesterday’s call block.',
  ],
  next: [
    'Columbus clears the paid gate (14.5 consults per 100 conversations vs 3 needed).',
    'The Local Office S1E2 storyboard is ready: 6 shots, 2 need regeneration.',
    'Atlanta warm-up week 2: 4 posts and 1 Reel scheduled.',
  ],
  approve: [
    { what: 'Publish 4 Atlanta posts + 1 Reel', lane: 3 },
    { what: 'Open paid in Columbus: $500 LinkedIn test, 14 days', lane: 3 },
    { what: 'Mission: Launch market Birmingham, AL', lane: 2 },
  ],
};
