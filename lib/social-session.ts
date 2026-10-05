// Shared state for the social setup wizard, edited live by the client and the Genesis operator.
// Two private Blob files per client, kept small because every read and write is a billed Blob operation:
//   session  - steps, answers, fields, links, requests, approval, lead, and where each person is (presence).
//              Version-checked writes. Edits bump rev; presence updates do not, so they never look like edits.
//   operator - notes and our-side ticks. Only the console API reads it, so the client can never receive it.
// A poll is one read of the session file.
import { createHash } from 'node:crypto';
import { get, put } from '@vercel/blob';
import type { Client } from './clients';
import { GOOGLE_OWNERS, applicableStepIds, countDone, tickableStepIds, type Channel, type GoogleOwner } from './channels';

export type Role = 'client' | 'operator';
export type Fields = { pageName: string; igUsername: string; hours: string };
export type Session = {
  v: 2;
  rev: number;
  done: string[];
  googleOwner: GoogleOwner | '';
  fields: Fields;
  links: Record<string, string>;
  wants: string[];
  other: string;
  approval: { by: string; at: string } | null;
  lead: { step: string; at: string } | null;
  presence: { client: Presence | null; operator: Presence | null };
  updatedAt?: string;
  updatedBy?: Role;
};
export type Presence = { step: string; at: string; following: boolean };
export type OperatorData = { notes: string; ours: string[]; updatedAt?: string };

export type Setup = { plan: Channel[]; optional: Channel[]; screens: string[] };

export const MAX_BODY = 2000;
const LIMITS = { pageName: 80, igUsername: 30, hours: 160, other: 300, link: 200, by: 80, notes: 4000 };
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

export const blankSession = (): Session => ({
  v: 2,
  rev: 0,
  done: [],
  googleOwner: '',
  fields: { pageName: '', igUsername: '', hours: '' },
  links: {},
  wants: [],
  other: '',
  approval: null,
  lead: null,
  presence: { client: null, operator: null },
});
const blankOperator = (): OperatorData => ({ notes: '', ours: [] });

function keys(c: Client) {
  const h = createHash('sha256').update(c.token).digest('hex').slice(0, 16);
  return {
    session: `progress/social-${c.slug}-${h}.json`,
    operator: `progress/social-operator-${c.slug}-${h}.json`,
  };
}
export const sessionKeys = keys;

/** A pasted profile link survives only if it is https on one of the channel's own hosts. */
export function cleanLink(raw: string, hosts: string[]): string | null {
  const s = raw.trim();
  if (!s) return '';
  if (s.length > LIMITS.link) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return hosts.includes(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length > max || CONTROL.test(s)) return null;
  return s;
}

function cleanField(field: keyof Fields, v: unknown): string | null {
  const s = cleanText(v, LIMITS[field]);
  if (s === null) return null;
  if (field === 'igUsername' && s && !/^[A-Za-z0-9._]{1,30}$/.test(s.replace(/^@/, ''))) return null;
  return field === 'igUsername' ? s.replace(/^@/, '') : s;
}

/** Stored data is read leniently: anything unknown is dropped item by item, older (v1) records included. */
export function normalizeSession(raw: unknown, setup: Setup): Session {
  const s = blankSession();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return s;
  const o = raw as Record<string, unknown>;
  const tick = new Set(tickableStepIds(setup.plan));
  const optional = new Set(setup.optional.map((c) => c.id as string));
  if (typeof o.rev === 'number' && Number.isInteger(o.rev) && o.rev >= 0) s.rev = o.rev;
  if (Array.isArray(o.done)) s.done = [...new Set(o.done.filter((id): id is string => typeof id === 'string' && tick.has(id)))];
  if (GOOGLE_OWNERS.includes(o.googleOwner as GoogleOwner)) s.googleOwner = o.googleOwner as GoogleOwner;
  const f = (o.fields && typeof o.fields === 'object' ? o.fields : {}) as Record<string, unknown>;
  for (const k of ['pageName', 'igUsername', 'hours'] as const) {
    const v = cleanField(k, f[k]);
    if (v) s.fields[k] = v;
  }
  if (o.links && typeof o.links === 'object' && !Array.isArray(o.links)) {
    for (const [id, v] of Object.entries(o.links as Record<string, unknown>)) {
      const ch = setup.plan.find((c) => c.id === id && c.profileLink);
      const clean = ch && typeof v === 'string' ? cleanLink(v, ch.profileLink!.hosts) : null;
      if (clean) s.links[id] = clean;
    }
  }
  if (Array.isArray(o.wants)) s.wants = [...new Set(o.wants.filter((id): id is string => typeof id === 'string' && optional.has(id)))];
  const other = cleanText(o.other, LIMITS.other);
  if (other) s.other = other;
  const ap = o.approval as Record<string, unknown> | null | undefined;
  if (ap && typeof ap === 'object' && typeof ap.at === 'string') {
    const by = cleanText(ap.by, LIMITS.by);
    if (by) s.approval = { by, at: ap.at };
  }
  const lead = o.lead as Record<string, unknown> | null | undefined;
  if (lead && typeof lead === 'object' && typeof lead.step === 'string' && setup.screens.includes(lead.step) && typeof lead.at === 'string') {
    s.lead = { step: lead.step, at: lead.at };
  }
  const pr = o.presence as Record<string, unknown> | undefined;
  if (pr && typeof pr === 'object') {
    s.presence.client = normalizePresence(pr.client, setup);
    s.presence.operator = normalizePresence(pr.operator, setup);
  }
  if (typeof o.updatedAt === 'string') s.updatedAt = o.updatedAt;
  if (o.updatedBy === 'client' || o.updatedBy === 'operator') s.updatedBy = o.updatedBy;
  return s;
}

export type Op =
  | { op: 'tick'; step: string; value: boolean }
  | { op: 'owner'; value: GoogleOwner | '' }
  | { op: 'field'; field: keyof Fields; value: string }
  | { op: 'link'; channel: string; value: string }
  | { op: 'want'; channel: string; value: boolean }
  | { op: 'other'; value: string }
  | { op: 'approve'; by: string; value: boolean }
  | { op: 'lead'; step: string }
  | { op: 'here'; step: string; following: boolean }
  | { op: 'ours'; step: string; value: boolean }
  | { op: 'notes'; value: string };

const OPERATOR_ONLY = new Set(['lead', 'ours', 'notes']);

/** Validates one operation for this client and role. Returns null when anything is off. */
export function parseOp(input: unknown, role: Role, setup: Setup): Op | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  if (typeof o.op !== 'string') return null;
  if (OPERATOR_ONLY.has(o.op) && role !== 'operator') return null;
  const tick = tickableStepIds(setup.plan);
  switch (o.op) {
    case 'tick':
      return typeof o.step === 'string' && tick.includes(o.step) && typeof o.value === 'boolean' ? { op: 'tick', step: o.step, value: o.value } : null;
    case 'owner':
      return o.value === '' || GOOGLE_OWNERS.includes(o.value as GoogleOwner) ? { op: 'owner', value: o.value as GoogleOwner | '' } : null;
    case 'field': {
      if (o.field !== 'pageName' && o.field !== 'igUsername' && o.field !== 'hours') return null;
      const v = cleanField(o.field, o.value);
      return v === null ? null : { op: 'field', field: o.field, value: v };
    }
    case 'link': {
      const ch = setup.plan.find((c) => c.id === o.channel && c.profileLink);
      if (!ch || typeof o.value !== 'string') return null;
      const v = cleanLink(o.value, ch.profileLink!.hosts);
      return v === null ? null : { op: 'link', channel: ch.id, value: v };
    }
    case 'want':
      return typeof o.channel === 'string' && setup.optional.some((c) => c.id === o.channel) && typeof o.value === 'boolean'
        ? { op: 'want', channel: o.channel, value: o.value }
        : null;
    case 'other': {
      const v = cleanText(o.value, LIMITS.other);
      return v === null ? null : { op: 'other', value: v };
    }
    case 'approve': {
      if (typeof o.value !== 'boolean') return null;
      const by = cleanText(o.by ?? '', LIMITS.by);
      if (by === null || (o.value && !by)) return null;
      return { op: 'approve', by, value: o.value };
    }
    case 'lead':
      return typeof o.step === 'string' && setup.screens.includes(o.step) ? { op: 'lead', step: o.step } : null;
    case 'here':
      return typeof o.step === 'string' && setup.screens.includes(o.step) ? { op: 'here', step: o.step, following: o.following !== false } : null;
    case 'ours':
      return typeof o.step === 'string' && setup.plan.some((c) => c.steps.some((s) => s.id === o.step && s.ours)) && typeof o.value === 'boolean'
        ? { op: 'ours', step: o.step, value: o.value }
        : null;
    case 'notes': {
      if (typeof o.value !== 'string' || o.value.length > LIMITS.notes) return null;
      return { op: 'notes', value: o.value };
    }
    default:
      return null;
  }
}

function applySessionOp(s: Session, op: Op, role: Role): Session {
  const next: Session = { ...s, fields: { ...s.fields }, links: { ...s.links }, done: [...s.done], wants: [...s.wants], presence: { ...s.presence } };
  if (op.op === 'here') {
    next.presence[role] = { step: op.step, at: new Date().toISOString(), following: op.following };
    return next;
  }
  const toggle = (list: string[], id: string, on: boolean) => (on ? (list.includes(id) ? list : [...list, id]) : list.filter((x) => x !== id));
  switch (op.op) {
    case 'tick':
      next.done = toggle(next.done, op.step, op.value);
      break;
    case 'owner':
      next.googleOwner = op.value;
      break;
    case 'field':
      next.fields[op.field] = op.value;
      break;
    case 'link':
      if (op.value) next.links[op.channel] = op.value;
      else delete next.links[op.channel];
      break;
    case 'want':
      next.wants = toggle(next.wants, op.channel, op.value);
      break;
    case 'other':
      next.other = op.value;
      break;
    case 'approve':
      next.approval = op.value ? { by: op.by, at: new Date().toISOString() } : null;
      break;
    case 'lead':
      next.lead = { step: op.step, at: new Date().toISOString() };
      break;
  }
  next.rev = s.rev + 1;
  next.updatedAt = new Date().toISOString();
  next.updatedBy = role;
  return next;
}

async function readJson(key: string): Promise<{ data: unknown; etag: string | null }> {
  const res = await get(key, { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return { data: null, etag: null };
  try {
    return { data: JSON.parse(await new Response(res.stream).text()), etag: res.blob.etag };
  } catch {
    return { data: null, etag: res.blob.etag };
  }
}

const writeOpts = { access: 'private' as const, contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60 };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read, apply one op, write back only if nobody wrote in between; retry with jitter if they did. */
async function updateJson<T>(key: string, load: (raw: unknown) => T, change: (cur: T) => T): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, etag } = await readJson(key);
    const next = change(load(data));
    try {
      if (etag) await put(key, JSON.stringify(next), { ...writeOpts, ifMatch: etag });
      else await put(key, JSON.stringify(next), { ...writeOpts, allowOverwrite: false });
      return next;
    } catch {
      await pause(40 + Math.random() * 120 * (attempt + 1));
    }
  }
  throw new Error('Too many concurrent edits; try again.');
}

export async function readSession(c: Client, setup: Setup): Promise<Session> {
  return normalizeSession((await readJson(keys(c).session)).data, setup);
}

function normalizePresence(raw: unknown, setup: Setup): Presence | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.step !== 'string' || !setup.screens.includes(o.step) || typeof o.at !== 'string') return null;
  return { step: o.step, at: o.at, following: o.following !== false };
}


function normalizeOperator(raw: unknown, setup: Setup): OperatorData {
  const d = blankOperator();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;
  if (typeof o.notes === 'string') d.notes = o.notes.slice(0, LIMITS.notes);
  const valid = new Set(setup.plan.flatMap((c) => c.steps.filter((s) => s.ours).map((s) => s.id)));
  if (Array.isArray(o.ours)) d.ours = [...new Set(o.ours.filter((id): id is string => typeof id === 'string' && valid.has(id)))];
  if (typeof o.updatedAt === 'string') d.updatedAt = o.updatedAt;
  return d;
}

export async function readOperator(c: Client, setup: Setup): Promise<OperatorData> {
  return normalizeOperator((await readJson(keys(c).operator)).data, setup);
}

/** Applies one validated op to the right file for this role and returns what was written (no extra read). */
export async function applyOp(c: Client, role: Role, op: Op, setup: Setup): Promise<{ session?: Session; operator?: OperatorData }> {
  const k = keys(c);
  if (op.op === 'ours' || op.op === 'notes') {
    const operator = await updateJson(k.operator, (raw) => normalizeOperator(raw, setup), (cur) => {
      const next = { ...cur, ours: [...cur.ours] };
      if (op.op === 'notes') next.notes = op.value;
      else next.ours = op.value ? [...new Set([...next.ours, op.step])] : next.ours.filter((x) => x !== op.step);
      next.updatedAt = new Date().toISOString();
      return next;
    });
    return { operator };
  }
  return { session: await updateJson(k.session, (raw) => normalizeSession(raw, setup), (cur) => applySessionOp(cur, op, role)) };
}

export function summary(s: Session, plan: Channel[]) {
  const ids = applicableStepIds(plan, s.googleOwner);
  return { done: countDone(ids, s.done, s.googleOwner), total: ids.length };
}
