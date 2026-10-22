// Which kind of competitor an insurance office is, from its Google name and types (pure; unit-tested in
// scripts/verify-competitor-radar.mjs). Starts from the scanner's carrier classifier, then:
//  - drops businesses that aren't selling policies (adjusters, title, bail bonds, tax and tag offices),
//  - names captive and storefront brands the carrier catalog doesn't list (Nationwide, Direct Auto, Freeway, ...),
//  - moves life, health, Medicare and benefits agencies to "Life & health", unless the name also says they sell
//    personal or commercial property and casualty (auto, home, property, ...).
// What remains is "Independent": an agency that most likely sells auto and home from several carriers.
import { classify, type CarrierRule } from './classify';

export type CompetitorTag = { carrierId: string | null; carrier: string; segment: 'captive' | 'independent' } | null;

const NOT_AN_AGENCY = /\b(adjust(er|ers|ing|ment)|claims? (service|management|center)|title (insurance|company|agency|services)|bail|bonding|bonds?man|tax (service|prep|preparation)|h\s?&\s?r block|notary|tag (office|agency)|driv(er|ing) (school|training)|dmv|appraisal|inspection)\b/i;
// Brands whose offices sell one company's policies (captive) or that run storefront offices; [label, name pattern].
const BRANDS: [string, RegExp][] = [
  ['Nationwide', /\bnationwide\b/i],
  ['Liberty Mutual', /\bliberty mutual\b/i],
  ['American Family', /\bamerican family\b|\bamfam\b/i],
  ['Farm Bureau', /\bfarm bureau\b/i],
  ['Shelter', /\bshelter insurance\b/i],
  ['Progressive', /\bprogressive\b/i],
  ['Direct Auto', /\bdirect (auto|general)\b/i],
  ['Freeway Insurance', /\bfreeway insurance\b/i],
  ['Acceptance Insurance', /\bacceptance (auto )?insurance\b/i],
  ['Affirmative Insurance', /\baffirmative\b/i],
  ['Assurance America', /\bassurance ?america\b/i],
  ['The General', /\bthe general\b/i],
  ['Kemper', /\bkemper\b/i],
  ['Erie Insurance', /\berie insurance\b/i],
];
const LIFE_HEALTH = /\b(life insurance|life & health|health( insurance| plans?| benefits)?|medicare|medicaid|medigap|benefits?|dental|vision plan|final expense|burial|funeral|annuit(y|ies)|retirement|wealth|financial (advisor|planning|planner|group|services)|investments?|primerica|new york life|northwestern mutual|massmutual|mass mutual|mutual of omaha|aflac|colonial life|globe life|american income life|bankers life|humana|united ?healthcare|blue ?cross|cigna|aetna|ambetter|modern woodmen|woodmen|knights of columbus|edward jones|ameriprise|senior)\b/i;
const PC_WORDS = /\b(auto|car|vehicle|truck|motorcycle|boat|rv|home|homeowners?|renters?|property|casualty|commercial|business insurance|general insurance)\b/i;

export function competitorTag(name: string, types: string[] | undefined, carriers: (CarrierRule & { name?: string })[]): CompetitorTag {
  if (NOT_AN_AGENCY.test(name)) return null;
  const c = classify(name, types, carriers);
  if (!c) return null;
  if (c.segment === 'captive' && c.carrier) return { carrierId: c.carrier.id, carrier: (c.carrier as CarrierRule & { name?: string }).name ?? c.carrier.slug, segment: 'captive' };
  const brand = BRANDS.find(([, re]) => re.test(name));
  if (brand) return { carrierId: null, carrier: brand[0], segment: 'captive' };
  if (LIFE_HEALTH.test(name) && !PC_WORDS.test(name)) return { carrierId: c.carrier?.id ?? null, carrier: 'Life & health', segment: 'independent' };
  return { carrierId: c.carrier?.id ?? null, carrier: 'Independent', segment: 'independent' };
}
