// The client's intake checklist, in one place: what the client still needs to give us for their site and dashboard.
// The welcome link shows it (and saves into the record), the pipeline and Helix name what's missing from it, and the
// draft site config's TODOs are the same fields. Values live on the client's current agent record.

export type ChecklistItem = {
  key: string;
  label: string;
  help: string;
  kind: 'text' | 'textarea' | 'url' | 'states' | 'choice' | 'photo';
  required: boolean;
  options?: [string, string][];
  max?: number;
};

export const CHECKLIST: ChecklistItem[] = [
  { key: 'legalName', label: 'Your business’s legal name', help: 'As it appears on your license, e.g. “Barrett Insurance Agency, LLC”.', kind: 'text', required: true, max: 160 },
  { key: 'hours', label: 'Office hours', help: 'e.g. Mon–Fri 9–6, Sat 10–2. We show these on your site and Google profile.', kind: 'textarea', required: true, max: 300 },
  { key: 'licensedStates', label: 'States you’re licensed in', help: 'Two-letter codes, e.g. GA, AL.', kind: 'states', required: true, max: 60 },
  { key: 'officialUrl', label: 'Your official carrier agent page', help: 'The page your carrier hosts for you. Your name, address and phone on your site must match it exactly.', kind: 'url', required: true, max: 300 },
  { key: 'googleListing', label: 'Your Google Business listing link', help: 'Open your listing on Google Maps and copy the link. Leave blank if you don’t have one yet; we’ll help.', kind: 'url', required: false, max: 400 },
  { key: 'domainChoice', label: 'Your web address', help: 'Do you already own a domain for your agency?', kind: 'choice', required: true, options: [['have', 'I have one (we’ll connect it)'], ['register', 'Please register one for me'], ['undecided', 'Not sure yet']] },
  { key: 'domain', label: 'The domain you own or want', help: 'e.g. barrettinsurance.com', kind: 'text', required: false, max: 120 },
  { key: 'headshot', label: 'Your headshot', help: 'A clear, recent photo of you. JPG or PNG, up to 8 MB. You confirm you have the rights to use it.', kind: 'photo', required: true },
  { key: 'logo', label: 'Your logo (if you have one)', help: 'PNG or JPG, up to 8 MB.', kind: 'photo', required: false },
  { key: 'languages', label: 'Languages your office speaks', help: 'e.g. English, Spanish. Only list what you can serve customers in today.', kind: 'text', required: false, max: 120 },
];

const filled = (v: unknown) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : v != null && v !== false);

/** The client's answers live under record.intake; photos are referenced by asset id under record.intake.<key>. */
export function checklistStatus(record: Record<string, unknown>) {
  const intake = (record.intake ?? {}) as Record<string, unknown>;
  const items = CHECKLIST.map((i) => ({ ...i, done: filled(intake[i.key]) || (i.key === 'domain' && intake.domainChoice !== 'have') }));
  const missing = items.filter((i) => i.required && !i.done);
  return { items, missing, done: missing.length === 0, intake };
}
