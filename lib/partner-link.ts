// Partner referral links are signed, so only a link Genovus handed out gives a partner credit. The signature rides
// inside utm_campaign (<ref_code>.<sig>) because every capture path, the agency's own site included, already keeps
// that field. No secret, no signed links and no credit: a signature made with an empty key would be forgeable.
import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = () => process.env.PARTNER_LINK_SECRET || process.env.CRON_SECRET || '';
export const partnerLinksEnabled = () => Boolean(secret());
const sig = (tenantId: string, ref: string) => createHmac('sha256', secret()).update(`partner:${tenantId}:${ref}`).digest('hex').slice(0, 10);

/** The utm_campaign value for a partner's link, or null when links can't be signed. */
export function partnerCampaign(tenantId: string, ref: string): string | null {
  return partnerLinksEnabled() ? `${ref.toLowerCase()}.${sig(tenantId, ref.toLowerCase())}` : null;
}

/** The partner's ref code when the campaign carries a valid signature for this agency, else null. */
export function verifyPartner(tenantId: string, campaign: string): string | null {
  const m = /^([0-9a-f]{8})\.([0-9a-f]{10})$/.exec(campaign.trim().toLowerCase());
  if (!m || !partnerLinksEnabled()) return null;
  const want = Buffer.from(sig(tenantId, m[1])), got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1] : null;
}
