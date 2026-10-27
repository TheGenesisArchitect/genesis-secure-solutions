// The website starts with the record: a draft site.config.ts for the agency's site, written from its current Genovus
// record in the same shape as the agency site template (Projects/java-agency/site.config.ts: "copy this file,
// change the values, swap the images, deploy"). Anything the record doesn't know yet is a TODO, never a guess.
// Name, address and phone must match the carrier's official agent profile before launch; nothing is indexed until
// the client and carrier approve the live site.
import { MODULES, includes, type ProgramId } from './programs';

type Rec = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const q = (v: string | null, todo: string) => (v ? JSON.stringify(v) : `'' /* TODO: ${todo} */`);
const e164 = (phone: string | null) => { const d = (phone ?? '').replace(/\D/g, ''); return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : null; };

/** The features a package switches on beyond Launch (what the 30-day onboarding trial grants). */
export const packageModules = (pkg: ProgramId) => MODULES.filter((m) => includes(pkg, m) && !includes('launch', m)).map((m) => m.key);

export function siteConfigDraft(rec: Rec, slug: string): string {
  const name = str(rec.agencyName), contact = str(rec.contactName), phone = str(rec.phone), email = str(rec.email);
  const city = str(rec.city), state = str(rec.state), carrier = str(rec.carrier), website = str(rec.website), address = str(rec.address);
  const pkg = (['launch', 'growth', 'premium'].includes(String(rec.package)) ? rec.package : 'launch') as ProgramId;
  const street = address?.split(',')[0]?.trim() ?? null;
  const zip = address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? null;
  const first = contact?.split(/\s+/)[0] ?? null;
  const features = MODULES.filter((m) => includes(pkg, m) && m.live).map((m) => m.label);
  return `/**
 * DRAFT site.config.ts for ${name ?? slug}, written by Genovus from the client record on ${new Date().toISOString().slice(0, 10)}.
 * Copy it into a new site from the agency template, fill every TODO, swap the images in /public, deploy to a preview.
 * Before launch: name, address and phone must match the ${carrier ?? 'carrier'}'s official agent profile exactly, and the
 * carrier approves the copy. Nothing is indexed until the client and carrier approve the live site.
 *
 * Package: ${pkg[0].toUpperCase() + pkg.slice(1)} · features on the dashboard: ${features.join(', ')}
 */
export const site = {
  agency: {
    name: ${q(name, 'agency name')},
    legalName: ${q(name, 'legal name (LLC?)')},
    wordmark: ${q(name ? name.toUpperCase() : null, 'wordmark')},
    office: ${q(city ? `The ${city} Local Office` : null, 'office line')},
    /** How the carrier asks its offices to be described. */
    carrierLine: '' /* TODO: the ${carrier ?? 'carrier'}'s approved wording */,
  },
  agent: {
    name: ${q(contact, 'agent name')},
    firstName: ${q(first, 'first name')},
    title: '' /* TODO: title as the carrier allows it */,
    portrait: '' /* TODO: headshot in /public */,
    pronoun: '' /* TODO */,
    licensedStates: [${state ? JSON.stringify(state) : ''}] /* TODO: confirm every licensed state */,
    languages: ['English'],
    officialUrl: ${q(website, 'official carrier agent page')},
  },
  contact: {
    phoneDisplay: ${q(phone, 'office phone')},
    phoneE164: ${q(e164(phone), 'phone in +1 format')},
    email: ${q(email, 'office email')},
    /** Callback form delivery. Server-side only. */
    callbackInbox: ${q(email, 'callback inbox')},
  },
  address: {
    street: ${q(street, 'street, exactly as on the carrier profile')},
    city: ${q(city, 'city')},
    region: ${q(state, 'state')},
    postalCode: ${q(zip, 'ZIP')},
    country: 'US',
  },
  serviceArea: {
    short: ${q(city && state ? `${city}, ${state}` : null, 'service area')},
    long: ${q(city && state ? `${city}, ${state} and surrounding communities` : null, 'service area, long')},
    cities: [${city && state ? JSON.stringify(`${city}, ${state}`) : ''}],
  },
  hero: { image: '' /* TODO */, alt: '' /* TODO */, caption: '' /* TODO */ },
  seo: {
    title: ${q(name && contact ? `${name} | ${contact}${city ? ` · ${city}, ${state ?? ''}`.trim() : ''}` : null, 'page title')},
    description: '' /* TODO: written to the carrier's rules, only the lines this office sells */,
  },
  reviews: { googlePlaceId: '' /* TODO: the office's own Google listing */ },
  social: { facebook: '', instagram: '' },
} as const;
`;
}
