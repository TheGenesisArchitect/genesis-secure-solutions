// The client's intake checklist, in one place: what the client still needs to give us for their site and dashboard.
// The welcome link shows it (and saves into the record), the pipeline and Helix name what's missing from it, and the
// draft site config's TODOs are the same fields. Values live on the client's current agent record.
// The dashboard's welcome page (app/app/[slug]/welcome) shows every item, grouped by section, before the kickoff;
// the kickoff closes whatever is still blank. Only the required items gate "done", so adding optional items never
// reopens a finished checklist.

export type ChecklistItem = {
  key: string;
  label: string;
  help: string;
  kind: 'text' | 'textarea' | 'url' | 'states' | 'choice' | 'photo' | 'lines';
  required: boolean;
  section: SectionKey;
  options?: [string, string][];
  max?: number;
};

export const SECTIONS = [
  ['office', 'Your office', 'What goes on your site and Google profile.'],
  ['carrier', 'Carrier and approval', 'So your site matches your carrier profile and goes to the right person for review.'],
  ['story', 'Your lines and your story', 'What you write and what makes your office different, in your words.'],
  ['photos', 'Photos and brand', 'Real photos of you and your office make the site yours.'],
  ['web', 'Web address, Google and socials', 'Where your site lives and where your profiles are.'],
  ['team', 'Your team and your questions', 'Who else works in the dashboard, and what you want covered on the kickoff.'],
] as const;
export type SectionKey = (typeof SECTIONS)[number][0];

/** The lines an office can give a page of its own (only what the office writes; the carrier's lines, never more). */
export const LINE_OPTIONS: [string, string][] = [['auto', 'Auto'], ['home', 'Home'], ['renters', 'Renters'], ['condo', 'Condo'], ['boat', 'Boat'], ['rv', 'RV'], ['motorcycle', 'Motorcycle'], ['umbrella', 'Umbrella'], ['life', 'Life'], ['business', 'Business']];
/** How many line pages each package builds (Launch is the home page only). */
export const LINE_PAGES: Record<string, number> = { launch: 0, growth: 4, premium: 7 };

export const CHECKLIST: ChecklistItem[] = [
  { key: 'legalName', section: 'office', label: 'Your business’s legal name', help: 'As it appears on your license, e.g. “Barrett Insurance Agency, LLC”.', kind: 'text', required: true, max: 160 },
  { key: 'hours', section: 'office', label: 'Office hours', help: 'e.g. Mon–Fri 9–6, Sat 10–2. We show these on your site and Google profile.', kind: 'textarea', required: true, max: 300 },
  { key: 'licensedStates', section: 'office', label: 'States you’re licensed in', help: 'Two-letter codes, e.g. GA, AL.', kind: 'states', required: true, max: 60 },
  { key: 'officialUrl', section: 'carrier', label: 'Your official carrier agent page', help: 'The page your carrier hosts for you. Your name, address and phone on your site must match it exactly.', kind: 'url', required: true, max: 300 },
  { key: 'googleListing', section: 'web', label: 'Your Google Business listing link', help: 'Open your listing on Google Maps and copy the link. Leave blank if you don’t have one yet; we’ll help.', kind: 'url', required: false, max: 400 },
  { key: 'domainChoice', section: 'web', label: 'Your web address', help: 'Do you already own a domain for your agency?', kind: 'choice', required: true, options: [['have', 'I have one (we’ll connect it)'], ['register', 'Please register one for me'], ['undecided', 'Not sure yet']] },
  { key: 'domain', section: 'web', label: 'The domain you own or want', help: 'e.g. barrettinsurance.com', kind: 'text', required: false, max: 120 },
  { key: 'headshot', section: 'photos', label: 'Your headshot', help: 'A clear, recent photo of you. JPG or PNG, up to 8 MB. You confirm you have the rights to use it.', kind: 'photo', required: true },
  { key: 'logo', section: 'photos', label: 'Your logo (if you have one)', help: 'PNG or JPG, up to 8 MB.', kind: 'photo', required: false },
  { key: 'serviceArea', section: 'office', label: 'Towns you serve most', help: 'e.g. Peachtree City, Fayetteville, Tyrone. We use them on your site and posts.', kind: 'text', required: false, max: 200 },
  { key: 'languages', section: 'office', label: 'Languages your office speaks', help: 'e.g. English, Spanish. Only list what you can serve customers in today.', kind: 'text', required: false, max: 120 },
  { key: 'carrierContact', section: 'carrier', label: 'Who approves your marketing at your carrier?', help: 'Name and email if you have them. We send your site to them for review before it goes live.', kind: 'text', required: false, max: 200 },
  { key: 'carrierRules', section: 'carrier', label: 'Anything your carrier has told you not to say or show?', help: 'Optional. We already follow the carrier’s published rules.', kind: 'textarea', required: false, max: 600 },
  { key: 'linePages', section: 'story', label: 'Which lines get their own page?', help: 'Pick the lines you write that you most want customers to find.', kind: 'lines', required: false, max: 120 },
  { key: 'story', section: 'story', label: 'What makes your office different?', help: 'A few sentences in your own words: how you help people, your community, your team. We turn it into site copy you approve.', kind: 'textarea', required: false, max: 1200 },
  { key: 'goal', section: 'story', label: 'Your #1 goal for the next 90 days', help: 'e.g. more home and auto bundles from local families.', kind: 'text', required: false, max: 200 },
  { key: 'officePhoto', section: 'photos', label: 'A photo of your office or team', help: 'Inside, outside or your team together. JPG or PNG, up to 8 MB.', kind: 'photo', required: false },
  { key: 'facebook', section: 'web', label: 'Your Facebook page', help: 'Paste the link. Leave blank if you don’t have one; we set it up with you.', kind: 'url', required: false, max: 300 },
  { key: 'instagram', section: 'web', label: 'Your Instagram', help: 'Paste the link to your profile, if you have one.', kind: 'url', required: false, max: 300 },
  { key: 'alertEmails', section: 'team', label: 'Who should get new-lead emails?', help: 'Emails, separated by commas. Phone alerts are turned on from each person’s dashboard.', kind: 'text', required: false, max: 300 },
  { key: 'team', section: 'team', label: 'Who else should have dashboard access?', help: 'One person per line: name, role and email. They get their own sign-in, no passwords.', kind: 'textarea', required: false, max: 800 },
  { key: 'questions', section: 'team', label: 'Questions for your kickoff call', help: 'Anything you want us to cover. Ask Helix first; whatever’s left, we answer on the call.', kind: 'textarea', required: false, max: 800 },
];

const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : v != null && v !== false);

/** The client's answers live under record.intake; photos are referenced by asset id under record.intake.<key>. */
export function checklistStatus(record: Record<string, unknown>) {
  const intake = (record.intake ?? {}) as Record<string, unknown>;
  const items = CHECKLIST.map((i) => ({ ...i, done: filled(intake[i.key]) }));
  const missing = items.filter((i) => i.required && !i.done);
  return { items, missing, done: missing.length === 0, intake };
}
