// Works out the DNS changes our domains need, by comparing what Resend and Vercel require with what the
// IONOS zone holds today. Nothing is changed here; the console shows the plan and an admin applies it.
import 'server-only';
import { records, zoneFor, sameContent, type DnsRecord } from './ionos';
import { findDomain, type ResendDomain } from './resend-domains';

export const VERCEL_A = '76.76.21.21';
export const VERCEL_CNAME = 'cname.vercel-dns.com';
/** Our domains: genovus.io is home; the rest forward (redirects are set on the Vercel side). */
export const SITE_DOMAINS: { domain: string; subs: string[] }[] = [
  { domain: 'genovus.io', subs: ['www', 'app', 'partners'] },
  { domain: 'genovus.net', subs: ['www'] },
  { domain: 'genovus.org', subs: ['www'] },
  { domain: 'genovus.app', subs: ['www'] },
  { domain: 'genovus.store', subs: ['www'] },
];

export type Plan = { domain: string; zoneId: string | null; add: DnsRecord[]; remove: DnsRecord[]; ok: DnsRecord[]; note?: string };

const fqdn = (name: string, domain: string) => (name === '@' || name === '' || name === domain ? domain : name.endsWith(domain) ? name : `${name}.${domain}`);

export async function emailPlan(domain: string): Promise<{ plan: Plan; resend: ResendDomain | null }> {
  const resend = await findDomain(domain);
  const zone = await zoneFor(domain);
  const plan: Plan = { domain, zoneId: zone?.id ?? null, add: [], remove: [], ok: [] };
  if (!resend) return { plan: { ...plan, note: 'Not registered with Resend yet.' }, resend };
  if (!zone) return { plan: { ...plan, note: 'This domain is not a DNS zone in the IONOS account.' }, resend };
  const have = await records(zone.id);
  for (const r of resend.records ?? []) {
    const want: DnsRecord = { name: fqdn(r.name, domain), type: r.type, content: r.value, ...(r.priority != null ? { prio: r.priority } : {}) };
    const match = have.find((h) => h.name === want.name && h.type === want.type && sameContent(h.content, want.content));
    if (match) plan.ok.push(match);
    else plan.add.push(want);
  }
  return { plan, resend };
}

/** Points a domain (and its subdomains) at Vercel. Replaces apex A/AAAA and conflicting sub records only. */
export async function sitePlan(domain: string, subs: string[]): Promise<Plan> {
  const zone = await zoneFor(domain);
  const plan: Plan = { domain, zoneId: zone?.id ?? null, add: [], remove: [], ok: [] };
  if (!zone) return { ...plan, note: 'This domain is not a DNS zone in the IONOS account.' };
  const have = await records(zone.id);
  const apex = have.filter((h) => h.name === domain && (h.type === 'A' || h.type === 'AAAA'));
  const apexOk = apex.find((h) => h.type === 'A' && h.content === VERCEL_A);
  if (apexOk) plan.ok.push(apexOk);
  else plan.add.push({ name: domain, type: 'A', content: VERCEL_A });
  plan.remove.push(...apex.filter((h) => h !== apexOk));
  for (const sub of subs) {
    const name = `${sub}.${domain}`;
    const existing = have.filter((h) => h.name === name && ['A', 'AAAA', 'CNAME'].includes(h.type));
    const good = existing.find((h) => h.type === 'CNAME' && sameContent(h.content, VERCEL_CNAME));
    if (good) plan.ok.push(good);
    else plan.add.push({ name, type: 'CNAME', content: VERCEL_CNAME });
    plan.remove.push(...existing.filter((h) => h !== good));
  }
  return plan;
}
