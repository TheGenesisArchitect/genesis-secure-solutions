// Progress for the social walkthrough. Stored apart from the welcome checklist so a change here
// can never reset the five welcome steps a client has already ticked.
import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import type { Client } from './clients';
import { GOOGLE_OWNERS, type Channel, type GoogleOwner } from './channels';

export type SocialProgress = {
  done: string[];
  googleOwner: GoogleOwner | '';
  links: Record<string, string>;
  wants: string[];
  other: string;
  updatedAt?: string;
};

export const MAX_BODY = 4000;
const MAX_OTHER = 300;
const MAX_LINK = 200;

export const blankSocial = (): SocialProgress => ({ done: [], googleOwner: '', links: {}, wants: [], other: '' });

export function socialKey(c: Client): string {
  return `progress/social-${c.slug}-${createHash('sha256').update(c.token).digest('hex').slice(0, 16)}.json`;
}

/** A pasted profile link survives only if it is https on one of the channel's own hosts. */
export function cleanLink(raw: string, hosts: string[]): string | null {
  const s = raw.trim();
  if (!s) return '';
  if (s.length > MAX_LINK) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return hosts.includes(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Strict parse against this client's channels: unknown ids, hosts or oversized text are rejected. */
export function parseSocial(input: unknown, plan: Channel[], optional: Channel[]): SocialProgress | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const stepIds = new Set(plan.flatMap((c) => c.steps.map((s) => s.id)));
  const optionalIds = new Set(optional.map((c) => c.id as string));
  const out = blankSocial();

  if (!Array.isArray(o.done) || o.done.length > stepIds.size) return null;
  for (const id of o.done) {
    if (typeof id !== 'string' || !stepIds.has(id)) return null;
    if (!out.done.includes(id)) out.done.push(id);
  }

  if (o.googleOwner !== '' && !GOOGLE_OWNERS.includes(o.googleOwner as GoogleOwner)) return null;
  out.googleOwner = o.googleOwner as SocialProgress['googleOwner'];

  if (!o.links || typeof o.links !== 'object' || Array.isArray(o.links)) return null;
  for (const [id, v] of Object.entries(o.links as Record<string, unknown>)) {
    const ch = plan.find((c) => c.id === id && c.profileLink);
    if (!ch || typeof v !== 'string') return null;
    const clean = cleanLink(v, ch.profileLink!.hosts);
    if (clean === null) return null;
    if (clean) out.links[id] = clean;
  }

  if (!Array.isArray(o.wants) || o.wants.length > optionalIds.size) return null;
  for (const id of o.wants) {
    if (typeof id !== 'string' || !optionalIds.has(id)) return null;
    if (!out.wants.includes(id)) out.wants.push(id);
  }

  if (typeof o.other !== 'string' || o.other.length > MAX_OTHER) return null;
  out.other = o.other.trim();
  return out;
}

/** Stored data is trusted more loosely than a request: entries for steps or channels that no longer
 * exist are dropped one by one, so renaming a step never wipes the rest of a client's progress. */
export function keepKnown(raw: unknown, plan: Channel[], optional: Channel[]): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const stepIds = new Set(plan.flatMap((c) => c.steps.map((s) => s.id)));
  const optionalIds = new Set(optional.map((c) => c.id as string));
  if (Array.isArray(o.done)) o.done = o.done.filter((id) => typeof id === 'string' && stepIds.has(id));
  if (Array.isArray(o.wants)) o.wants = o.wants.filter((id) => typeof id === 'string' && optionalIds.has(id));
  if (o.links && typeof o.links === 'object' && !Array.isArray(o.links)) {
    o.links = Object.fromEntries(
      Object.entries(o.links as Record<string, unknown>).filter(([id, v]) => {
        const ch = plan.find((c) => c.id === id && c.profileLink);
        return ch && typeof v === 'string' && cleanLink(v, ch.profileLink!.hosts) !== null;
      }),
    );
  }
  if (typeof o.other === 'string') o.other = o.other.slice(0, MAX_OTHER);
  return o;
}

export async function readSocial(c: Client, plan: Channel[], optional: Channel[]): Promise<SocialProgress> {
  const res = await get(socialKey(c), { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return blankSocial();
  try {
    const raw = JSON.parse(await new Response(res.stream).text());
    const parsed = parseSocial(keepKnown(raw, plan, optional), plan, optional);
    return parsed ? { ...parsed, updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined } : blankSocial();
  } catch {
    return blankSocial();
  }
}

export async function writeSocial(c: Client, p: SocialProgress): Promise<SocialProgress> {
  const body: SocialProgress = { ...p, updatedAt: new Date().toISOString() };
  await put(socialKey(c), JSON.stringify(body), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
  return body;
}
