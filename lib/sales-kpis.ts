// Genovus's own sales funnel for /console/growth (Scale Up workbook, Lead Gen KPI tracker): inquiries → booked
// consultations → shown → new clients, with the rates and costs between them. Pure: the page passes in the rows.
import type { SupabaseClient } from '@supabase/supabase-js';
import { OBJECTION_LABEL, type ObjectionKey } from '../data/consult-guide';

export type ConsultRow = { booked_at: string | null; outcome: string | null; inquiry_id?: string | null; ends_at?: string | null };

export function salesFunnel(o: { consults: ConsultRow[]; inquiries: number; newClients: number; acquisitionCents: number; cashCents: number; now?: number }) {
  const now = o.now ?? Date.now();
  const booked = o.consults.filter((c) => c.booked_at).length;
  const shown = o.consults.filter((c) => c.outcome === 'showed').length;
  const noShow = o.consults.filter((c) => c.outcome === 'no_show').length;
  const marked = shown + noShow;
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    booked, shown, noShow,
    unmarked: o.consults.filter((c) => c.booked_at && !c.outcome && c.ends_at && Date.parse(c.ends_at) < now).length, // happened, not marked yet
    bookRate: ratio(o.consults.filter((c) => c.booked_at && c.inquiry_id).length, o.inquiries), // website inquiries that booked a call
    showRate: ratio(shown, marked),                  // of the calls that happened (or should have)
    closeRate: ratio(o.newClients, shown),           // new clients per shown call
    costPerBooked: booked ? Math.round(o.acquisitionCents / booked) : null,
    cashPerLead: o.inquiries ? Math.round(o.cashCents / o.inquiries) : null,
  };
}

/** The objections the team recorded (consultations and prospect calls), most common first (workbook p. 61: the top
 *  three become ads, emails and posts). "No objection" isn't counted. */
export function tallyObjections(keys: (string | null)[]): { key: ObjectionKey; label: string; count: number }[] {
  const n = new Map<string, number>();
  for (const k of keys) if (k && k !== 'none' && k in OBJECTION_LABEL) n.set(k, (n.get(k) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key: key as ObjectionKey, label: OBJECTION_LABEL[key as ObjectionKey], count }));
}

export async function topObjections(db: SupabaseClient, days = 90) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const [c, p] = await Promise.all([
    db.from('consult_invites').select('objection').not('objection', 'is', null).gte('created_at', since),
    db.from('prospect_events').select('objection').not('objection', 'is', null).gte('at', since),
  ]);
  return tallyObjections([...(c.data ?? []), ...(p.data ?? [])].map((r) => r.objection as string));
}
