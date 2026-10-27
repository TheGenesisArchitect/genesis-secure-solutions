// One website app for every agency (app/s/[slug]): everything a site shows comes from the agency's Genovus record
// and profile, so a change to the record is a change to the site, and a fix to the app is a fix to every site.
//  - Pages by package: Launch the home page; Growth up to 5 pages; Premium up to 8. Only the lines the agency sells.
//  - Before launch a site is a private preview (a signed link); it is never indexed until it's live.
// Server only. Copy never quotes prices, promises savings or speaks for the carrier.
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { adminDb } from './supabase/admin';
import { LINES, type LineId } from './lines';

const SECRET = () => process.env.SITE_PREVIEW_SECRET || process.env.PROPOSAL_LINK_SECRET || process.env.MEDIA_LINK_SECRET || process.env.CRON_SECRET || '';
const sig = (slug: string) => createHmac('sha256', SECRET()).update(`site:${slug}`).digest('base64url').slice(0, 24);
export const previewKey = (slug: string) => (SECRET() ? sig(slug) : null);
export function validPreview(slug: string, k: string | undefined | null): boolean {
  if (!SECRET() || !k) return false;
  const want = Buffer.from(sig(slug)), got = Buffer.from(k);
  return want.length === got.length && timingSafeEqual(want, got);
}

export type Pkg = 'launch' | 'growth' | 'premium';
export const PAGES: Record<Pkg, number> = { launch: 1, growth: 5, premium: 8 };

export type SiteLine = { id: LineId; label: string; path: string; title: string; blurb: string; points: string[] };
export type SiteData = {
  tenantId: string; slug: string; live: boolean; pkg: Pkg;
  agency: string; legalName: string | null; agent: string | null; firstName: string | null;
  carrier: string | null; carrierLine: string | null; officialUrl: string | null;
  phone: string | null; phoneE164: string | null; email: string | null;
  street: string | null; city: string | null; state: string | null; zip: string | null;
  hours: string | null; licensed: string[]; languages: string | null;
  headshotId: string | null; logoId: string | null; placeId: string | null;
  lines: SiteLine[]; pages: SiteLine[]; booking: boolean;
};

const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const e164 = (p: string | null) => { const d = (p ?? '').replace(/\D/g, ''); return d.length === 10 ? `+1${d}` : d.length === 11 && d[0] === '1' ? `+${d}` : null; };
const pretty = (e: string | null) => (e && /^\+1\d{10}$/.test(e) ? `(${e.slice(2, 5)}) ${e.slice(5, 8)}-${e.slice(8)}` : null);

// What each line page says: plain, local, no prices or promises. The agency's city fills in.
const COPY: Partial<Record<LineId, { blurb: string; points: string[] }>> = {
  auto: { blurb: 'Coverage for the cars, trucks and drivers in your household, from a local office you can call or walk into.', points: ['Adding a teen or new driver', 'A new or used car purchase', 'Reviewing coverage after a move or life change'] },
  home: { blurb: 'Protection for the home you own, with a local person to call when something happens.', points: ['Buying or closing on a home', 'Bundling home and auto', 'Storm season check-ups'] },
  renters: { blurb: 'Coverage for your belongings and liability when you rent, set up quickly.', points: ['A new lease or move', 'Landlord-required proof of insurance', 'Roommates and shared homes'] },
  condo: { blurb: 'Coverage built for condo owners, alongside your association’s policy.', points: ['Closing on a condo', 'Understanding your association’s policy', 'Improvements you’ve made inside'] },
  boat: { blurb: 'Coverage for your boat on the water and on the trailer, from people who know the lakes around here.', points: ['A new or used boat', 'Season start check-ups', 'Trailers and equipment'] },
  rv: { blurb: 'Coverage for your RV, camper or travel trailer, on the road and at the campground.', points: ['A new RV or trailer', 'Full-time and part-time RVers', 'Season start check-ups'] },
  motorcycle: { blurb: 'Coverage for your bike and your gear, for riding season and the rest of the year.', points: ['A new bike', 'Riding season start', 'Custom parts and equipment'] },
  umbrella: { blurb: 'Extra liability protection above your home and auto policies.', points: ['Protecting what you’ve built', 'Teen drivers in the household', 'Pools, trampolines and rentals'] },
  life: { blurb: 'Life insurance conversations with a local person, at your pace.', points: ['A new baby or marriage', 'A new home', 'Reviewing an older policy'] },
  commercial: { blurb: 'Coverage conversations for local businesses, from a nearby office.', points: ['A new business', 'Vehicles used for work', 'Growing a team'] },
};

export async function siteData(slug: string): Promise<SiteData | null> {
  const db = adminDb();
  const { data: t } = await db.from('tenants').select('id, slug, name, plan, site_live, kind').eq('slug', slug).maybeSingle();
  if (!t || t.kind !== 'agency') return null;
  const [{ data: rec }, { data: prof }] = await Promise.all([
    db.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).maybeSingle(),
    db.from('agency_profiles').select('address, city, state, zip, lines, carrier, main_phone_e164, google_place_id').eq('tenant_id', t.id).maybeSingle(),
  ]);
  const r = (rec?.data ?? {}) as Record<string, unknown>;
  const intake = (r.intake ?? {}) as Record<string, unknown>;
  const rank = ['launch', 'growth', 'premium'];
  // The package: the paid plan once the deposit is in, else the package they chose (a preview shows what they bought).
  const pkg = (rank.includes(String(t.plan)) ? t.plan : rank.includes(String(r.package)) ? r.package : 'launch') as Pkg;
  const agency = s(r.agencyName) ?? (t.name as string);
  const city = s(prof?.city) ?? s(r.city), state = s(prof?.state) ?? s(r.state);
  const place = city ? ` in ${city}${state ? `, ${state}` : ''}` : '';
  const lineIds = ((prof?.lines as string[] | null) ?? (r.lines as string[] | undefined) ?? []).filter((l): l is LineId => l in LINES);
  const lines: SiteLine[] = lineIds.map((id) => ({ id, label: LINES[id].label, path: `${LINES[id].label.toLowerCase().replace(/[^a-z]+/g, '-')}-insurance`, title: `${LINES[id].label} insurance${place}`, blurb: COPY[id]?.blurb ?? `${LINES[id].label} insurance from a local office.`, points: COPY[id]?.points ?? [] }));
  const phoneE164 = s(prof?.main_phone_e164) ?? e164(s(r.phone));
  const agent = s(r.contactName);
  return {
    tenantId: t.id as string, slug: t.slug as string, live: Boolean(t.site_live), pkg,
    agency, legalName: s(intake.legalName), agent, firstName: agent?.split(/\s+/)[0] ?? null,
    carrier: s(prof?.carrier) ?? s(r.carrier), carrierLine: s(r.carrierLine), officialUrl: s(intake.officialUrl) ?? s(r.website),
    phone: pretty(phoneE164) ?? s(r.phone), phoneE164, email: s(r.email),
    street: s(prof?.address), city, state, zip: s(prof?.zip) ?? s(r.zip),
    hours: s(intake.hours), licensed: (s(intake.licensedStates) ?? state ?? '').split(/[\s,]+/).filter(Boolean), languages: s(intake.languages),
    headshotId: s(intake.headshot), logoId: s(intake.logo), placeId: s(prof?.google_place_id),
    lines, pages: lines.slice(0, PAGES[pkg] - 1), booking: pkg !== 'launch',
  };
}
