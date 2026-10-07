// Server-only client registry. Never import this from client code: it holds every token and price.
import { timingSafeEqual, createHash } from 'node:crypto';
import mendez from '@/data/clients/mendez-hollis.json';
import genovus from '@/data/clients/genovus.json';
import demoBrooks from '@/data/clients/demo-brooks.json';
import { adminDb } from './supabase/admin';
import { PLANS } from '@/data/offers';

/** A client record. The welcome-package fields are optional: internal records (Genovus itself) have none. */
export type Client = {
  slug: string;
  token: string;
  firstName: string;
  fullName: string;
  office: string;
  plan: string;
  contactName: string;
  /** Internal records run the social wizard for Genesis's own accounts; they never get a welcome package. */
  internal?: boolean;
  /** A fictional agency used for demos and pitch films. Never real client data. */
  demo?: boolean;
  film?: string;
  poster?: string;
  previewUrl?: string;
  pricing?: [string, string][];
  handled?: [string, string][];
  social?: { plan: string[] };
  /** First 16 hex of sha256(token): names the client's storage files. Database clients carry it because their token is never stored. */
  keyHash?: string;
  /** Profile copy kit for database clients (file clients use data/kits). */
  kit?: Record<string, unknown>;
};
type WelcomeClient = Client & Required<Pick<Client, 'film' | 'poster' | 'pricing' | 'handled'>>;

const CLIENTS: Client[] = [mendez as unknown as Client, genovus as unknown as Client, demoBrooks as unknown as Client];

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function findClientByToken(token: string): Client | undefined {
  if (!TOKEN_RE.test(token)) return undefined;
  const a = Buffer.from(token);
  return CLIENTS.find((c) => {
    const b = Buffer.from(c.token);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Only clients with a full welcome package have a welcome page and checklist. */
export function hasWelcome(c: Client | undefined): c is WelcomeClient {
  return !!c && !c.internal && !!c.film && !!c.poster && Array.isArray(c.pricing) && Array.isArray(c.handled);
}

/** Storage key for a client's progress: slug plus a hash of the token, never the token itself. */
export function progressKey(c: Client): string {
  return `progress/${c.slug}-${clientKey(c)}.json`;
}

export const tokenKey = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 16);
export const clientKey = (c: Client) => c.keyHash ?? tokenKey(c.token);

/** Console lookup by slug. Only call after the operator has signed in. */
export function findClientBySlug(slug: string): Client | undefined {
  return CLIENTS.find((c) => c.slug === slug);
}

// ---------- clients onboarded from the database (no deploy per client) ----------

const DEFAULT_HANDLED: [string, string][] = [
  ['Your site', 'Built from your agency profile, reviewed by you before it goes live.'],
  ['Your profiles', 'Facebook, Instagram and Google set up with you, live on a call.'],
  ['Approvals', 'Nothing goes out in your name until you approve it.'],
  ['Your numbers', 'Every lead tagged with where it came from, in one monthly report.'],
];

const usd = (cents: number) => '$' + (cents / 100).toLocaleString('en-US');
const hasServiceKey = () => Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Builds a Client from a tenant and its current record. Missing welcome fields get defaults from the plan. */
function fromRecord(slug: string, plan: string | null, data: Record<string, unknown>, token: string, keyHash: string): Client {
  const w = (data.welcome ?? {}) as Record<string, unknown>;
  const offer = PLANS.find((p) => p.id === (plan === 'vip' ? 'launch' : plan));
  const str = (v: unknown, d: string) => (typeof v === 'string' && v.trim() ? v : d);
  const contact = String(data.contactName ?? data.agentName ?? '');
  const defaultPricing: [string, string][] = offer?.setupCents
    ? [
        [`${offer.name} setup`, usd(offer.setupCents)],
        ['Deposit to start (70%)', usd(offer.setupCents * 0.7)],
        ['Balance at launch (30%)', usd(offer.setupCents * 0.3)],
        [`${offer.careName}, from launch`, `${usd(offer.careCents ?? 0)}/mo`],
      ]
    : [];
  const socialPlan = (w.social as { plan?: unknown } | undefined)?.plan;
  return {
    slug,
    token,
    keyHash,
    firstName: str(w.firstName, contact.split(' ')[0] || 'there'),
    fullName: str(w.fullName, contact),
    office: str(w.office, String(data.agencyName ?? slug)),
    plan: str(w.plan, offer?.name ?? 'Launch'),
    contactName: str(w.contactName, 'Your Genovus team'),
    film: str(w.film, '/site/genovus-agency.mp4'),
    poster: str(w.poster, '/site/poster-agency.jpg'),
    previewUrl: str(w.previewUrl, ''),
    pricing: Array.isArray(w.pricing) ? (w.pricing as [string, string][]) : defaultPricing,
    handled: Array.isArray(w.handled) ? (w.handled as [string, string][]) : DEFAULT_HANDLED,
    social: { plan: Array.isArray(socialPlan) ? (socialPlan as string[]) : ['facebook', 'instagram', 'meta-partner', 'google'] },
    kit: (data.kit as Record<string, unknown> | undefined) ?? undefined,
  };
}

/** Welcome-link lookup: file clients first (unchanged), then database clients by token hash. */
export async function findClientAnyByToken(token: string): Promise<Client | undefined> {
  const file = findClientByToken(token);
  if (file || !TOKEN_RE.test(token) || !hasServiceKey()) return file;
  const db = adminDb();
  const full = createHash('sha256').update(token).digest('hex');
  const { data: link } = await db.from('client_links').select('tenant_id, key16').eq('token_hash', full).is('revoked_at', null).maybeSingle();
  if (!link) return undefined;
  const [{ data: t }, { data: r }] = await Promise.all([
    db.from('tenants').select('slug, plan').eq('id', link.tenant_id).single(),
    db.from('agent_records').select('data').eq('tenant_id', link.tenant_id).eq('is_current', true).maybeSingle(),
  ]);
  return t ? fromRecord(t.slug, t.plan, (r?.data ?? {}) as Record<string, unknown>, token, link.key16) : undefined;
}

/** Slug lookup for signed-in team pages: file clients first, then a database client's newest live link. */
export async function findClientAnyBySlug(slug: string): Promise<Client | undefined> {
  const file = findClientBySlug(slug);
  if (file || !hasServiceKey()) return file;
  const db = adminDb();
  const { data: t } = await db.from('tenants').select('id, slug, plan').eq('slug', slug).maybeSingle();
  if (!t) return undefined;
  const [{ data: link }, { data: r }] = await Promise.all([
    db.from('client_links').select('key16').eq('tenant_id', t.id).is('revoked_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('agent_records').select('data').eq('tenant_id', t.id).eq('is_current', true).maybeSingle(),
  ]);
  return link ? fromRecord(t.slug, t.plan, (r?.data ?? {}) as Record<string, unknown>, '', link.key16) : undefined;
}
