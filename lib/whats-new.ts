// What's new in Genovus, as data: each upgrade a person can use right away, with a Quick Helix Tour (two or three
// spotlights on the real controls) and a "Try it" that opens the feature. One shows at a time, once per session,
// newest first; each is seen once per device. Add an entry when an upgrade ships. Client-safe (no secrets).
export type TourStep = {
  /** Agency page to open first (relative to /app/<slug>), e.g. 'today'; '' is Home. Agency entries only. */
  page?: string;
  /** Open Ask Helix for this step. */
  helix?: boolean;
  /** What to point at (CSS selector, first match); without it the caption shows in the middle. */
  at?: string;
  caption: string;
};
export type WhatsNew = {
  id: string;
  date: string;
  surfaces: ('agency' | 'enterprise')[];
  title: string;
  line: string;
  tour: TourStep[];
  /** "Try it": open a page and/or Ask Helix, and point at where to start. */
  tryIt: TourStep;
};

export const WHATS_NEW: WhatsNew[] = [
  {
    id: 'lead-alerts-2026-10-15', date: '2026-10-15', surfaces: ['agency'],
    title: 'New-lead alerts on your phone',
    line: 'Know the moment a lead comes in. Tap the alert and Today opens with that lead, ready to call.',
    tour: [
      { page: 'today', at: '[data-tour="lead-alerts"]', caption: 'Turn alerts on for this device here. One tap; your browser asks once.' },
      { page: 'today', at: '.today-now', caption: 'Tapping an alert brings you here, with the lead marked and its Call button ready.' },
    ],
    tryIt: { page: 'today', at: '[data-tour="lead-alerts"]', caption: 'Tap “Alert me on this device”.' },
  },
  {
    id: 'helix-confirm-2026-10-15', date: '2026-10-15', surfaces: ['agency'],
    title: 'Helix updates leads, with your yes',
    line: 'Type or say “mark Dana called” or “book Dana Thursday at 2”. One tap to confirm, ten seconds to undo.',
    tour: [
      { helix: true, at: '.helix-drawer input[aria-label="Ask Helix"]', caption: 'Ask Helix to mark a lead called, book a consult or add a follow-up, by name.' },
      { helix: true, at: '.helix-drawer', caption: 'Helix shows a card first. Nothing changes until you tap Yes (or say yes), and Undo stays for ten seconds.' },
    ],
    tryIt: { helix: true, at: '.helix-drawer input[aria-label="Ask Helix"]', caption: 'Try: “mark <a lead’s name> called”.' },
  },
  {
    id: 'helix-ptt-2026-10-15', date: '2026-10-15', surfaces: ['agency', 'enterprise'],
    title: 'Push-to-talk and hands-free',
    line: 'Busy office? Hold Space to talk. Long stretch of work? Hands-free keeps Helix going.',
    tour: [
      { helix: true, at: '.hx-bar-modes', caption: 'Push-to-talk: hold Space (or the button) to speak, let go to send. Hands-free: Helix keeps going past the 10-minute session while you’re talking.' },
    ],
    tryIt: { helix: true, at: '.hx-bar-modes', caption: 'Turn on Push-to-talk, then hold Space and speak.' },
  },
  {
    id: 'helix-moves-2026-10-15', date: '2026-10-15', surfaces: ['agency', 'enterprise'],
    title: 'Helix takes you there',
    line: 'Say “go to Pipeline” or “open Dana”. Helix opens the page and points at it, and keeps listening as you move.',
    tour: [
      { helix: true, at: '.hx-bar', caption: 'Tap Talk, then say where to go: “go to Pipeline”, “open Dana”, “show me the calendar”.' },
      { at: '.jump-open', caption: 'Prefer typing? Ctrl+K jumps anywhere, and anything you type can go straight to Ask Helix.' },
    ],
    tryIt: { helix: true, at: '.hx-bar', caption: 'Tap Talk and say “go to Pipeline”.' },
  },
  {
    id: 'helix-travels-2026-10-15', date: '2026-10-15', surfaces: ['agency', 'enterprise'],
    title: 'Helix remembers the conversation',
    line: 'Ask on one page, keep going on the next. It’s saved to your account, so it’s there after a reload and on your phone.',
    tour: [
      { helix: true, at: '.helix-drawer', caption: 'Your conversation stays as you move between pages, typed or spoken.' },
      { helix: true, at: '.helix-drawer button[aria-label^="Minimize"]', caption: 'Minimize to keep working. Helix stays in the corner with its last answer.' },
    ],
    tryIt: { helix: true, at: '.helix-drawer input[aria-label="Ask Helix"]', caption: 'Ask something here, then open another page.' },
  },
];
