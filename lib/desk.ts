// A desk is one tenant's Newsroom and UnEdit Studio: the Genovus house desk (the default, always there) or an agency's
// desk (any tenant with a Newsroom profile, e.g. JAVA Agency). Every Newsroom, UnEdit and Helix path resolves its desk
// here, so one agency's stories, recordings and calendar never show on another's, and nothing that worked before
// changes: no desk named means the house desk. Server only.
import 'server-only';
import { adminDb } from '@/lib/supabase/admin';

export const HOUSE = 'genovus';
/** An agency's Newsroom profile (newsroom_settings.profile); the house desk has none. */
export type DeskProfile = {
  kind: 'agency';
  agency: string;               // "JAVA Agency LLC"
  host: string;                 // who records: "Mendez"
  carrier_line: string;         // "A GEICO Exclusive Agency"
  office: string;               // "6053 Veterans Pkwy Ste 201, Columbus, GA"
  area: { label: string; places: string[] };
  lines: string[];              // the lines of business he writes
  audience: string;             // who the posts are for
  sign_off: string;             // how every script ends
  rules: string[];              // the copy rules, in plain words
  competitors: string[];        // names never said
  approver: 'owner';            // posts wait for the agency owner's approval
  networks?: string[];          // the networks connected on its Metricool brand (posts go only there)
};
export type Desk = { id: string; slug: string; name: string; house: boolean; profile: DeskProfile | null };

const cache = new Map<string, { at: number; desk: Desk }>();

/** The desk for a slug (or the house desk). Only tenants with a Newsroom profile count as agency desks. */
export async function deskFor(slug?: string | null): Promise<Desk> {
  const want = String(slug ?? '').trim().toLowerCase() || HOUSE;
  const hit = cache.get(want);
  if (hit && Date.now() - hit.at < 60_000) return hit.desk;
  const db = adminDb();
  const { data: t } = await db.from('tenants').select('id, slug, name').eq('slug', want).maybeSingle();
  if (!t) return want === HOUSE ? Promise.reject(new Error('The genovus tenant is missing.')) : deskFor(HOUSE);
  if (t.slug === HOUSE) { const d = { id: t.id, slug: t.slug, name: 'Genovus', house: true, profile: null }; cache.set(want, { at: Date.now(), desk: d }); return d; }
  const { data: s } = await db.from('newsroom_settings').select('profile').eq('tenant_id', t.id).maybeSingle();
  const profile = (s?.profile ?? null) as DeskProfile | null;
  if (!profile || profile.kind !== 'agency') return deskFor(HOUSE);
  const d = { id: t.id as string, slug: t.slug as string, name: profile.agency || (t.name as string), house: false, profile };
  cache.set(want, { at: Date.now(), desk: d });
  return d;
}

/** The desk a tenant id belongs to (house when it has no agency profile). */
export async function deskById(id: string): Promise<Desk> {
  const { data } = await adminDb().from('tenants').select('slug').eq('id', id).maybeSingle();
  return deskFor((data?.slug as string | undefined) ?? HOUSE);
}

/** Every desk: the house first, then each agency with a Newsroom profile. */
export async function allDesks(): Promise<Desk[]> {
  const db = adminDb();
  const { data } = await db.from('newsroom_settings').select('tenant_id, profile, tenants!inner(slug)');
  const agencies = ((data ?? []) as unknown as { profile: DeskProfile | null; tenants: { slug: string } }[]).filter((r) => r.profile?.kind === 'agency').map((r) => r.tenants.slug);
  return Promise.all([HOUSE, ...agencies].map((s) => deskFor(s)));
}

/** A desk named in conversation ("JAVA", "Mendez", "the Genovus desk") or by slug; the house desk when unsure. */
export async function deskNamed(words?: unknown): Promise<Desk> {
  const w = String(words ?? '').toLowerCase().trim();
  if (!w) return deskFor(HOUSE);
  const all = await allDesks();
  return all.find((d) => d.slug === w) ?? all.find((d) => !d.house && [d.name, d.slug, d.profile?.host ?? '', d.profile?.agency ?? ''].some((n) => n && n.toLowerCase().split(/[\s-]+/).some((x) => x.length > 2 && w.includes(x)))) ?? all[0];
}
