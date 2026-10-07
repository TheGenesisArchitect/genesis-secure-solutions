// IONOS Hosting DNS API (Developer API key = public prefix + secret). Server only: the secret lives in
// Vercel as a sensitive variable and never leaves the running app. Used to set records for our own domains
// and, later, for agency domains during onboarding calls.
import 'server-only';

const BASE = 'https://api.hosting.ionos.com/dns/v1';
const key = () => {
  const p = process.env.IONOS_PUBLIC_API || process.env.IONOS_API_PREFIX || '';
  const s = process.env.IONOS_SECRET_API || process.env.IONOS_API_SECRET || '';
  return p && s ? `${p}.${s}` : '';
};
export const ionosConfigured = () => Boolean(key());

export type DnsRecord = { id?: string; name: string; type: string; content: string; ttl?: number; prio?: number; disabled?: boolean };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'X-API-Key': key(), 'Content-Type': 'application/json', Accept: 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`IONOS ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

export async function zoneFor(domain: string): Promise<{ id: string; name: string } | null> {
  const zones = await call<{ id: string; name: string }[]>('/zones');
  return zones.find((z) => z.name === domain) ?? null;
}

export async function records(zoneId: string): Promise<DnsRecord[]> {
  const z = await call<{ records: DnsRecord[] }>(`/zones/${zoneId}`);
  return z.records ?? [];
}

export async function createRecords(zoneId: string, list: DnsRecord[]): Promise<void> {
  await call(`/zones/${zoneId}/records`, { method: 'POST', body: JSON.stringify(list.map((r) => ({ ttl: 3600, prio: 0, disabled: false, ...r }))) });
}

export async function deleteRecord(zoneId: string, recordId: string): Promise<void> {
  await call(`/zones/${zoneId}/records/${recordId}`, { method: 'DELETE' });
}

/** Normalizes TXT content (IONOS may return it quoted) for comparisons. */
export const sameContent = (a: string, b: string) => a.replace(/^"|"$/g, '').trim().toLowerCase() === b.replace(/^"|"$/g, '').trim().toLowerCase();
