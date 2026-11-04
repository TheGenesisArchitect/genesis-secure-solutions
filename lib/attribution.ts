// Where a lead came from, shared by every capture path (an agency's own site through the lead API, and the sites
// Genovus hosts): the visit's tracking tags are kept as sent, and the source is the word an agent recognizes. A partner
// tag counts only with a signed link (lib/partner-link.ts); an unsigned one is kept but credits no one.
import { verifyPartner } from './partner-link';

export const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'msclkid', 'referrer', 'landing'] as const;

/** Only the known tags, as trimmed strings, each at most 300 characters. */
export function cleanAttribution(raw: unknown): Record<string, string> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of ATTR_KEYS) { const v = typeof r[k] === 'string' ? (r[k] as string).trim().slice(0, 300) : ''; if (v) out[k] = v; }
  return out;
}

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** The campaign's source, else the click ID, else the referring site. */
export function sourceOf(a: Record<string, string>): string {
  if (a.utm_source) return a.utm_source.toLowerCase();
  if (a.fbclid) return 'facebook';
  if (a.gclid) return 'google';
  if (a.msclkid) return 'bing';
  const ref = host(a.referrer ?? '');
  if (/facebook\.com|fb\.com|instagram\.com/.test(ref)) return ref.includes('instagram') ? 'instagram' : 'facebook';
  if (/google\./.test(ref)) return 'google';
  return ref || 'direct';
}

/** Source and campaign for the lead. A partner source with a bad or missing signature becomes "partner-unverified". */
export function tagLead(tenantId: string, a: Record<string, string>, fallback?: string): { source: string; campaign: string } {
  const tagged = Boolean(a.utm_source || a.fbclid || a.gclid || a.msclkid);
  let source = fallback && !tagged ? fallback : sourceOf(a);
  let campaign = a.utm_campaign ?? '';
  if (source === 'partner') {
    const ref = verifyPartner(tenantId, campaign);
    if (ref) campaign = ref; else source = 'partner-unverified';
  }
  return { source, campaign };
}
