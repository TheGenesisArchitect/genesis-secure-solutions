// The insurance copy check for agency desks (lib/desk.ts), enforced in code on every script line, caption and post,
// not only asked of the writer: no prices, quotes or savings; never what a policy covers; only the agency's lines;
// never another insurer by name; never speaking for the carrier's corporate office; no loss or crime as a hook;
// English only. Pure and deterministic (no network), so the Newsroom, UnEdit and tests share it.
import type { DeskProfile } from '@/lib/desk';

export type Issue = { rule: 'price' | 'coverage' | 'line' | 'competitor' | 'corporate' | 'tragedy' | 'language' | 'brand'; text: string; match: string; why: string };

const PRICE = /\$\s?\d|\b\d{1,3}\s?(%|percent)\b|\bsav(e|es|ed|ing|ings)\b|\bcheap(er|est)?\b|\bdiscounts?\b|\bquotes?\b|\bpremiums?\b|\b(low|lower|lowest|best|great) rates?\b|\bfree quote|\bper month\b|\ba month\b/i;
const COVERAGE = /\b(is|are|you're|you are|it's|it is|they're|will be|get|gets|be|stay|stays)\s+(fully\s+|always\s+)?covered\b|\b(policy|insurance|coverage|plan|geico)\s+(covers|will cover|pays|will pay|protects you from)\b|\bcovers? (hail|flood|theft|damage|it|that|you)\b|\bguarantee[sd]?\b|\bfully protected\b|\bwon'?t (cost|pay) (you )?a (dime|thing)\b/i;
const OTHER_LINES = /\b(life insurance|health insurance|medicare|medicaid|annuit(y|ies)|commercial (auto|insurance|policy)|business insurance|workers'? comp|pet insurance|dental|disability insurance|umbrella policy)\b/i;
const CORPORATE = /\bgeico (offers|guarantees|will|promises|always|never|is the)\b|\bon behalf of geico\b|\bgeico corporate\b/i;
const TRAGEDY = /\b(killed|died|dead|deadly|fatal|tragic|tragedy|victims?|lost everything)\b/i;
const SPANISH = /\b(seguro de|llámenos|llamenos|hola|gracias|póliza|poliza|aseguranza|usted)\b/i;

/** Every issue in one piece of copy. */
export function checkCopy(text: string, p: DeskProfile): Issue[] {
  const t = String(text ?? '');
  if (!t.trim()) return [];
  const out: Issue[] = [];
  const hit = (rule: Issue['rule'], re: RegExp, why: string) => { const m = t.match(re); if (m) out.push({ rule, text: t.slice(0, 240), match: m[0], why }); };
  hit('price', PRICE, 'No prices, quotes, premiums or savings claims.');
  hit('coverage', COVERAGE, 'Never say what a policy covers; say “call us and we’ll review it with you”.');
  hit('line', OTHER_LINES, `Only ${p.lines.join(', ')}.`);
  hit('corporate', CORPORATE, `Speak as the local office (${p.carrier_line}), never for the carrier’s corporate office.`);
  hit('tragedy', TRAGEDY, 'No loss or tragedy as a hook; never name anyone involved.');
  hit('language', SPANISH, 'English only.');
  hit('brand', /\bgenovus\b/i,`This posts as ${p.agency}: never mention Genovus.`);
  const rival = p.competitors.find((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
  if (rival) out.push({ rule: 'competitor', text: t.slice(0, 240), match: rival, why: 'Never name or compare other insurers or agencies.' });
  return out;
}

/** Every issue across many pieces (script lines, teleprompter, captions, posts), each labelled with where it is. */
export function checkAll(pieces: { where: string; text: string }[], p: DeskProfile): (Issue & { where: string })[] {
  return pieces.flatMap((x) => checkCopy(x.text, p).map((i) => ({ ...i, where: x.where })));
}

/** The rules as a prompt block for the writer (the check above still decides). */
export function copyRules(p: DeskProfile): string {
  return [
    `You write for ${p.agency} (${p.carrier_line}, ${p.office}). The host is ${p.host}, speaking as his local office to ${p.audience}.`,
    `Hard rules, all of them, every line: ${p.rules.join('; ')}.`,
    'Specifically: no dollar amounts, percentages, "save", "cheap", "discount", "quote", "premium" or "rates". Never say anything is or is not "covered", or what a policy "covers" or "pays"; instead invite people to call or stop by so he can review their policy with them.',
    `Never name another insurer (${p.competitors.slice(0, 8).join(', ')} and others). Never speak for the carrier's corporate office. No loss, death or crime as a hook. English only.`,
    `The call to action is always to call or visit ${p.host}'s office. End the script with exactly: "${p.sign_off}"`,
  ].join('\n');
}
