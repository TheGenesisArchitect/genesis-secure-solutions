import { get, put } from '@vercel/blob';
import { progressKey, type Client } from './clients';

export const STEP_KEYS = ['portrait', 'approval', 'social', 'domain', 'kickoff'] as const;
export type Progress = {
  steps: Record<(typeof STEP_KEYS)[number], boolean>;
  domainChoice: '' | 'own' | 'help';
  kickoffTimes: string;
  updatedAt?: string;
};

export function blankProgress(): Progress {
  return { steps: { portrait: false, approval: false, social: false, domain: false, kickoff: false }, domainChoice: '', kickoffTimes: '' };
}

/** Strict parse: only the known shape survives, strings are capped. Returns null for anything else. */
export function parseProgress(input: unknown): Progress | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const steps = o.steps as Record<string, unknown> | undefined;
  if (!steps || typeof steps !== 'object') return null;
  const out = blankProgress();
  for (const k of STEP_KEYS) {
    if (typeof steps[k] !== 'boolean') return null;
    out.steps[k] = steps[k] as boolean;
  }
  if (o.domainChoice !== '' && o.domainChoice !== 'own' && o.domainChoice !== 'help') return null;
  out.domainChoice = o.domainChoice as Progress['domainChoice'];
  if (typeof o.kickoffTimes !== 'string' || o.kickoffTimes.length > 200) return null;
  out.kickoffTimes = o.kickoffTimes.trim();
  return out;
}

export const storageConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export async function readProgress(c: Client): Promise<Progress> {
  const res = await get(progressKey(c), { access: 'private', useCache: false });
  if (!res || res.statusCode !== 200) return blankProgress();
  const text = await new Response(res.stream).text();
  try {
    const parsed = parseProgress(JSON.parse(text));
    return parsed ? { ...parsed, updatedAt: JSON.parse(text).updatedAt } : blankProgress();
  } catch {
    return blankProgress();
  }
}

export async function writeProgress(c: Client, p: Progress): Promise<Progress> {
  const body: Progress = { ...p, updatedAt: new Date().toISOString() };
  await put(progressKey(c), JSON.stringify(body), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
  return body;
}
