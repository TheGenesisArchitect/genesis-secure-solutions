// Server-only client registry. Never import this from client code: it holds every token and price.
import { timingSafeEqual, createHash } from 'node:crypto';
import mendez from '@/data/clients/mendez-hollis.json';

export type Client = typeof mendez;
const CLIENTS: Client[] = [mendez];

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function findClientByToken(token: string): Client | undefined {
  if (!TOKEN_RE.test(token)) return undefined;
  const a = Buffer.from(token);
  return CLIENTS.find((c) => {
    const b = Buffer.from(c.token);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

/** Storage key for a client's progress: slug plus a hash of the token, never the token itself. */
export function progressKey(c: Client): string {
  return `progress/${c.slug}-${createHash('sha256').update(c.token).digest('hex').slice(0, 16)}.json`;
}

/** Console lookup by slug. Only call after the operator has signed in. */
export function findClientBySlug(slug: string): Client | undefined {
  return CLIENTS.find((c) => c.slug === slug);
}
