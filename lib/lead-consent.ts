import 'server-only';
// The one gate the Lead Engine checks before it touches a lead (docs/LEAD_ENGINE_SPEC.md §4.1). The answer comes from
// the consent ledger (migration 0094, consent_allows): a consent naming the channel, and no revocation on any of the
// person's leads with this agency. SMS is always no until A2P 10DLC (CLAUDE.md); an AI call needs written consent
// that names autodial_ai, and each one still needs a person's tap.
import type { SupabaseClient } from '@supabase/supabase-js';

export type ConsentChannel = 'call' | 'autodial_ai' | 'email' | 'sms';

/** Service-role client only. Any error reads as "no". */
export async function consentAllows(db: SupabaseClient, leadId: string, channel: ConsentChannel): Promise<boolean> {
  if (channel === 'sms') return false;
  const { data, error } = await db.rpc('consent_allows', { p_lead: leadId, p_channel: channel });
  return !error && data === true;
}
