// Genovus's own sales funnel for /console/growth (Scale Up workbook, Lead Gen KPI tracker): inquiries → booked
// consultations → shown → new clients, with the rates and costs between them. Pure: the page passes in the rows.
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
