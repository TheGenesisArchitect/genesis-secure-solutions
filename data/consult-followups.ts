// Follow-up drafts after a first consultation (Scale Up workbook pp. 19–20, rewritten as short emails for agency
// owners). They are starting points: a person reads and edits each one before it goes (lib/consult-followups.ts,
// migration 0090). Plain words, one ask each, no prices, no promises about results, never "guarantee".
export type FollowupStep = 's1' | 's3' | 's7' | 's14' | 'n0' | 'n2' | 'n7';
export type FollowupInput = { first: string; org: string; goal?: string | null; origin: string; rebook?: string | null };
export type FollowupDraft = { subject: string; body: string; button?: { label: string; url: string } };

/** In order, with the day after the call each becomes due (the database checks the same days). */
export const SHOWED: { step: FollowupStep; day: number; label: string }[] = [
  { step: 's1', day: 1, label: 'Day 1 · thanks and recap' },
  { step: 's3', day: 3, label: 'Day 3 · one question' },
  { step: 's7', day: 7, label: 'Day 7 · what the first month looks like' },
  { step: 's14', day: 14, label: 'Day 14 · closing the loop' },
];
export const NO_SHOW: { step: FollowupStep; day: number; label: string }[] = [
  { step: 'n0', day: 0, label: 'Same day · pick a new time' },
  { step: 'n2', day: 2, label: 'Day 2 · the link still works' },
  { step: 'n7', day: 7, label: 'Day 7 · last note' },
];
export const stepsFor = (outcome: string | null) => (outcome === 'showed' ? SHOWED : outcome === 'no_show' ? NO_SHOW : []);

export function followupDraft(step: FollowupStep, i: FollowupInput): FollowupDraft {
  const goal = i.goal?.trim().replace(/\s+/g, ' ').slice(0, 200);
  const rebook = i.rebook ? { label: 'Pick a new time', url: i.rebook } : undefined;
  switch (step) {
    case 's1':
      return {
        subject: `Thanks for the call, ${i.first}`,
        body: [
          `Thanks for your time on our call, ${i.first}.`,
          goal ? `You said the #1 thing you want is “${goal}”. That’s what we’d build ${i.org}’s setup around.` : `We’d build ${i.org}’s setup around what you told us matters most.`,
          `If it helps to see it again, the 78-second film shows real Genovus screens with a sample agency: ${i.origin}/film`,
          'When you’re ready, reply to this email and we’ll send the proposal. Questions are welcome too.',
        ].join('\n\n'),
      };
    case 's3':
      return {
        subject: 'One question',
        body: [
          `Hi ${i.first},`,
          'What’s the one thing you’d need to see to feel good about moving forward? Reply with a line and we’ll answer it directly.',
        ].join('\n\n'),
      };
    case 's7':
      return {
        subject: `What the first month looks like for ${i.org}`,
        body: [
          `Hi ${i.first},`,
          'A question agency owners often ask after our call is what the first month looks like. We build your site from your agent record, set up your Facebook and Instagram with you on a call, and draft your launch posts. Nothing goes live until you approve it, and your carrier too if they need to.',
          'Want to pick up where we left off? Reply and we’ll find a time.',
        ].join('\n\n'),
      };
    case 's14':
      return {
        subject: 'Should we close your file?',
        body: [
          `Hi ${i.first},`,
          'We haven’t heard back, so we’ll assume now isn’t the right time and stop following up.',
          `If that changes, reply anytime, or book a time at ${i.origin}/book.`,
        ].join('\n\n'),
      };
    case 'n0':
      return {
        subject: 'We missed you today',
        body: [
          `Hi ${i.first},`,
          'It looks like today’s time didn’t work out. No problem at all.',
          `If you’d still like to talk about ${i.org}’s website and how leads reach you, pick a new time below.`,
        ].join('\n\n'),
        button: rebook,
      };
    case 'n2':
      return {
        subject: 'Still want to talk?',
        body: [
          `Hi ${i.first},`,
          'Your link to pick a time still works. It’s a 30-minute video call about your office: where it is today, where you want it, and what we’d set up.',
        ].join('\n\n'),
        button: rebook,
      };
    case 'n7':
      return {
        subject: 'Last note from us',
        body: [
          `Hi ${i.first},`,
          'This is our last note about the consultation. If the timing is better later, you can book anytime.',
        ].join('\n\n'),
        button: rebook ?? { label: 'Book a time', url: `${i.origin}/book` },
      };
  }
}
