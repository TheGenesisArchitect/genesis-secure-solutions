// Resend sending domains (server only). Registers a domain, reads the DNS records Resend needs, and asks
// Resend to verify them once they are published.
import 'server-only';

const key = () => process.env.RESEND_API_KEY || process.env.RESEND_GENOVOUS_API_KEY || '';
export const resendConfigured = () => Boolean(key());

export type ResendRecord = { record: string; name: string; type: string; ttl?: string; status: string; value: string; priority?: number };
export type ResendDomain = { id: string; name: string; status: string; region?: string; records?: ResendRecord[] };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('https://api.resend.com' + path, {
    ...init,
    headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(body as { message?: string }).message ?? 'request failed'}`);
  return body as T;
}

export async function findDomain(name: string): Promise<ResendDomain | null> {
  const list = await call<{ data: ResendDomain[] }>('/domains');
  const d = list.data?.find((x) => x.name === name);
  return d ? call<ResendDomain>(`/domains/${d.id}`) : null;
}

export async function addDomain(name: string): Promise<ResendDomain> {
  const d = await call<ResendDomain>('/domains', { method: 'POST', body: JSON.stringify({ name, region: 'us-east-1' }) });
  return call<ResendDomain>(`/domains/${d.id}`);
}

export async function verifyDomain(id: string): Promise<void> {
  await call(`/domains/${id}/verify`, { method: 'POST' });
}
