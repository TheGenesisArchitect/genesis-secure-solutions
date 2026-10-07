// The Genovus story in eleven scenes, shared by the pitch storyboard (/pitch/<token>) and the public site.
// live = the feature works today; otherwise it is shown as "In development".
export type Scene = { title: string; text: string; live: boolean; still: string };
export const SCENES: Scene[] = [
  { title: 'Every local agent is a brand', text: 'The carrier, its agencies, their agents and their customers, with Genovus at the center.', live: true, still: 's01' },
  { title: 'The gap today', text: 'Duplicate Pages, profiles nobody can log into, unapproved wording, office firewalls, and no view for the carrier.', live: true, still: 's02' },
  { title: 'One agent record', text: 'Who they are, where they serve, what they offer and what their carrier allows, building the site, copy, cover art and welcome package.', live: true, still: 's03' },
  { title: 'The welcome package', text: 'A personal welcome film and a setup guide that already knows the agent’s plan.', live: true, still: 's04' },
  { title: 'Guided setup, live', text: 'A specialist leads; the agent’s screen follows. Their Facebook Page, Instagram and Google listing fill in as each step is done. No passwords shared.', live: true, still: 's05' },
  { title: 'Compliance built in', text: 'Platform limits enforced, risky phrases flagged, fresh versions on request, and the approver signs off. Any change goes back for approval.', live: true, still: 's06' },
  { title: 'Carrier governance', text: 'Your wording rules, approved templates and approval routing applied to every agency at once, with an audit trail.', live: false, still: 's07' },
  { title: 'Grow, every month', text: 'Posts drafted from approved templates, and every lead tracked to its source with consent on record.', live: false, still: 's08' },
  { title: 'Measure what matters', text: 'Agents see what is working; carriers see which offices are live, what is approved and where growth comes from.', live: false, still: 's09' },
  { title: 'The right package', text: 'Launch, Growth and Premium for agencies; group programs for networks; a 90-day pilot for carriers.', live: true, still: 's10' },
  { title: 'Automation, with a human touch', text: 'The platform does the repeatable work. People own the relationship and every public word.', live: true, still: 's11' },
];
