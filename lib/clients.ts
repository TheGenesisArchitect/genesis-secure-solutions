// Server-only client registry. Never import this from client code: it holds every token and price.
import { timingSafeEqual, createHash } from 'node:crypto';
import mendez from '@/data/clients/mendez-hollis.json';
import genovus from '@/data/clients/genovus.json';
import demoBrooks from '@/data/clients/demo-brooks.json';

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
  return `progress/${c.slug}-${createHash('sha256').update(c.token).digest('hex').slice(0, 16)}.json`;
}

/** Console lookup by slug. Only call after the operator has signed in. */
export function findClientBySlug(slug: string): Client | undefined {
  return CLIENTS.find((c) => c.slug === slug);
}
