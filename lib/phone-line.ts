// The phone service is proven on Genovus's own line first (the house account, tenant "genovus"), then offered to
// agencies as a Growth option. "Proven" means the whole chain has worked end to end on the Genovus line: a call
// answered and recorded, Helix's note written from it, and a missed call that turned into a call-back follow-up.
// Until then no agency number can be bought.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

export const HOUSE_SLUG = 'genovus';
/** The agency module that turns on call tracking (a Growth option, granted per agency). */
export const CALLS_OPTION = 'calls';

export type PhoneProof = {
  houseId: string | null;
  numbers: number;
  answered: boolean;
  recorded: boolean;
  noted: boolean;
  missed: boolean;
  proven: boolean;
};

export async function phoneProof(db: SupabaseClient): Promise<PhoneProof> {
  const { data: house } = await db.from('tenants').select('id').eq('slug', HOUSE_SLUG).maybeSingle();
  if (!house) return { houseId: null, numbers: 0, answered: false, recorded: false, noted: false, missed: false, proven: false };
  const head = { count: 'exact' as const, head: true };
  const [nums, answered, recorded, noted, missed] = await Promise.all([
    db.from('tracking_numbers').select('id', head).eq('tenant_id', house.id).is('released_at', null),
    db.from('calls').select('id', head).eq('tenant_id', house.id).eq('status', 'answered'),
    db.from('calls').select('id', head).eq('tenant_id', house.id).eq('status', 'answered').not('recording_sid', 'is', null),
    db.from('calls').select('id', head).eq('tenant_id', house.id).not('summary', 'is', null),
    db.from('calls').select('id', head).eq('tenant_id', house.id).eq('status', 'missed'),
  ]);
  const p = { answered: (answered.count ?? 0) > 0, recorded: (recorded.count ?? 0) > 0, noted: (noted.count ?? 0) > 0, missed: (missed.count ?? 0) > 0 };
  return { houseId: house.id, numbers: nums.count ?? 0, ...p, proven: p.answered && p.recorded && p.noted && p.missed };
}
