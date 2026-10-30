// The consult guide for whoever runs a Genovus consultation (Scale Up workbook pp. 57–63, rewritten for insurance
// agencies). One source: the consult page renders it, Helix's brief carries it so Helix can coach live, and the
// objection keys are what the team records after each call (migration 0089), so the top objections can be counted.
// Genovus sells Intelliware: the website, profiles and lead tools. Never prices, coverage or carrier promises.
import { PLANS } from './offers';

const usd = (c: number) => `$${(c / 100).toLocaleString('en-US')}`;
const launch = PLANS.find((p) => p.id === 'launch')!;
export const INVESTMENT_LINE = `Packages start at ${usd(launch.setupCents!)} to set up, with care from ${usd(launch.careCents!)} a month after launch.`;

/** The discovery call, in order. Talk less than a fifth of the time; most of it is their answers. */
export const DISCOVERY: { step: string; how: string }[] = [
  { step: 'Know them before you dial', how: 'Read their inquiry or prospect page: carrier, state, website, Google profile, and their #1 goal if they gave one.' },
  { step: 'Say what the call is for', how: '“This is a look at where your office is today and where you want it to be. If Genovus fits, I’ll show you what we’d set up. If it doesn’t, I’ll tell you.”' },
  { step: 'Get them talking about the office', how: '“How long have you had the agency? Who’s on the team, and who answers the phone when a new customer calls?”' },
  { step: 'Find the gap', how: '“Where do new customers come from today? What have you tried online, and what happened?”' },
  { step: 'Picture the result', how: '“If this were working 90 days from now, what would be different in your week?”' },
  { step: 'Check urgency and the decision', how: 'Ask the 1–10 question and who else decides (below). Under 7, dig into why before showing anything.' },
  { step: 'Show only what solves what they said', how: 'Open the matching screens (site, profiles, leads, Helix). Skip the rest. Name the package that fits and why.' },
  { step: 'Agree the next step on the call', how: 'Proposal and deposit, a second call with the other decision-maker, or a polite “not a fit.” Put the date on the calendar before you hang up.' },
];

/** Qualifying questions, asked in plain words. Each answer goes in the call note. */
export const PREQUAL: { ask: string; why: string }[] = [
  { ask: 'Which carrier are you with, or are you independent?', why: 'Captive agents need the carrier’s approval for their site; we plan around it.' },
  { ask: 'Which lines do you write most?', why: 'The site and posts stay inside the lines they actually sell.' },
  { ask: 'What do you have online today: a site, a Google profile, Facebook, Instagram?', why: 'Sets the starting point and the package.' },
  { ask: 'On a scale of 1 to 10, how important is fixing this right now?', why: 'Below 7: ask what would have to change for it to matter. Don’t push.' },
  { ask: 'Is it just you deciding, or is there someone we should include?', why: 'If someone else decides, book the next call with both of you.' },
  { ask: `I like to be upfront: ${INVESTMENT_LINE} Does that range work if it solves what you described?`, why: 'Ask after they’ve described the gap, never before.' },
];

export type ObjectionKey = 'think' | 'partner' | 'cheaper' | 'looking' | 'finances' | 'email' | 'callback' | 'carrier' | 'none' | 'other';

/** What they say, the question that finds the real reason, and what to listen for. */
export const OBJECTIONS: { key: Exclude<ObjectionKey, 'none' | 'other'>; say: string; ask: string; listen: string }[] = [
  { key: 'think', say: '“I need to think about it.”', ask: '“Of course. So I know what to help with: is it the investment, the timing, or something about what we’d set up?”', listen: 'Whatever they pick is the real objection. Answer that one.' },
  { key: 'partner', say: '“I need to talk to my spouse / partner / office manager.”', ask: '“Makes sense. If they didn’t want to go ahead, what would their reason be?” Then offer a short call with both of you.', listen: 'Their answer is usually their own concern.' },
  { key: 'cheaper', say: '“I know someone who does websites cheaper.”', ask: '“Fair. If the price were the same, which would you pick, and why?”', listen: 'Their reasons are what Genovus does differently: carrier-aware, leads tracked, care after launch.' },
  { key: 'looking', say: '“I’m just looking around.”', ask: '“Good. What would have to be true for you to move from looking to starting?”', listen: 'That condition is the real objection.' },
  { key: 'finances', say: '“I need to look at my finances first.”', ask: '“Sure. What number would you need to see to feel good about it?”', listen: 'Get a specific number; then compare it with Launch and care.' },
  { key: 'email', say: '“Can you send me an email with all of this?”', ask: '“Happy to. Which part do you want to look at again: the price, what’s included, or what it does for you?”', listen: 'Usually a soft no. Find the part they’re unsure about.' },
  { key: 'callback', say: '“Call me back next week.”', ask: '“I will. So I bring the right thing: is there something you want sorted out by then, or is today just not a good day?”', listen: '“Next week” often means not convinced yet. Pin down what.' },
  { key: 'carrier', say: '“My carrier has to approve anything I put online.”', ask: '“Right, and we plan for that. Nothing goes live until you and your carrier approve it. Who handles approvals at your carrier?”', listen: 'Captive agents: this is a process question, not a no.' },
];

export const OBJECTION_LABEL: Record<ObjectionKey, string> = {
  think: 'Needs to think about it', partner: 'Has to ask someone else', cheaper: 'Knows someone cheaper', looking: 'Just looking around',
  finances: 'Has to check finances', email: 'Asked for an email instead', callback: 'Asked us to call back later', carrier: 'Carrier approval worries',
  none: 'No objection', other: 'Something else',
};
export const OBJECTION_KEYS = Object.keys(OBJECTION_LABEL) as ObjectionKey[];

/** The guide as text, for Helix's brief (coaching on the call, prep before it). */
export function guideText(): string {
  return [
    'CONSULT GUIDE (how Genovus runs a consultation; coach from this)',
    `- Discovery, in order: ${DISCOVERY.map((d, i) => `${i + 1}. ${d.step}`).join('; ')}.`,
    `- Qualifying questions: ${PREQUAL.map((q) => q.ask).join(' | ')}`,
    ...OBJECTIONS.map((o) => `- Objection ${o.say} Ask: ${o.ask} (${o.listen})`),
  ].join('\n');
}
