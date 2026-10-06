// Rules for profile copy the client can edit or regenerate. Shared by the server (which enforces the hard
// rules) and the wizard page (which shows the same counts and warnings while someone types).
// Hard rules block a save. Warnings never block; they ask the approver to look again (carrier and state rules
// on insurance advertising vary, so the approver decides, not the software).

export const COPY_KEYS = ['fbBio', 'igName', 'igBio', 'gDescription'] as const;
export type CopyKey = (typeof COPY_KEYS)[number];

export const COPY_RULES: Record<CopyKey, { label: string; limit: number; multiline: boolean; noLinks: boolean; platform: string }> = {
  fbBio: { label: 'Facebook bio', limit: 100, multiline: false, noLinks: false, platform: 'Facebook Page bio' },
  igName: { label: 'Instagram name', limit: 64, multiline: false, noLinks: true, platform: 'Instagram profile name' },
  igBio: { label: 'Instagram bio', limit: 150, multiline: true, noLinks: false, platform: 'Instagram bio' },
  gDescription: { label: 'Google description', limit: 750, multiline: true, noLinks: true, platform: 'Google Business Profile description' },
};

/** Phrases an insurance approver should look at twice. Patterns are plain strings so the page can reuse them. */
export const COPY_WARNINGS: { pattern: string; message: string }[] = [
  { pattern: '\\bguarantee', message: 'Avoid guarantees.' },
  { pattern: '\\b(cheapest|lowest (rate|rates|price|prices|premium|premiums))\\b', message: 'Avoid promising the lowest price or rate.' },
  { pattern: '\\bbest (rate|rates|price|prices|deal|deals)\\b', message: 'Avoid claiming the best rates or prices.' },
  { pattern: '\\bsave (up to|\\$|\\d)', message: 'Avoid promising specific savings.' },
  { pattern: '\\$\\s?\\d', message: 'Prices usually need carrier approval. Google does not allow them in the description.' },
  { pattern: '\\d+\\s?%', message: 'Percentages usually read as a savings claim.' },
  { pattern: '\\b(#1|number one|top[- ]rated|award[- ]winning)\\b', message: 'Rankings and awards need proof. Remove unless verified.' },
];

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|app|us|info)\b)/i;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export const isCopyKey = (k: unknown): k is CopyKey => typeof k === 'string' && (COPY_KEYS as readonly string[]).includes(k);

/** Hard-rule check. Returns the cleaned text, or an error message. */
export function cleanCopy(key: CopyKey, raw: unknown): { text: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'Text is required.' };
  const rule = COPY_RULES[key];
  let s = raw.replace(/\r\n?/g, '\n').trim();
  if (!rule.multiline) s = s.replace(/\s*\n\s*/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  if (CONTROL.test(s.replace(/\n/g, ''))) return { error: 'Remove special characters.' };
  if ([...s].length > rule.limit) return { error: `${rule.label} is ${[...s].length} characters; the limit is ${rule.limit}.` };
  if (rule.noLinks && LINK.test(s)) return { error: `${rule.platform} cannot include links or web addresses.` };
  return { text: s };
}

export function copyWarnings(text: string): string[] {
  return COPY_WARNINGS.filter((w) => new RegExp(w.pattern, 'i').test(text)).map((w) => w.message);
}
