// Proof on the website (Scale Up workbook pp. 35–40): real, approved words from real clients only. Nothing here is
// written for a client or edited beyond trimming; each item names who approved it and when (keep the written approval
// with the client's record). An empty list hides the section everywhere. No review markup (JSON-LD) for these:
// reviews about ourselves on our own site don't qualify for it.
export type ProofItem = {
  quote: string;            // their exact words (trimmed only)
  name: string;             // as they asked to be named
  role: string;             // e.g. "Owner"
  agency: string;           // e.g. "JAVA Agency"
  place?: string;           // e.g. "Columbus, GA"
  approvedOn: string;       // YYYY-MM-DD: the day they approved this wording for genovus.io
  approvedBy: string;       // who on the client side approved it
};

export const PROOF: ProofItem[] = [];

/** The Genovus Google Business Profile review link (set once the profile exists). Empty hides the review button. */
export const GOOGLE_REVIEW_URL = '';

/** Only items with an approval date and approver, and a quote that isn't empty. */
export function liveProof(items: ProofItem[] = PROOF): ProofItem[] {
  return items.filter((p) => p.quote.trim() && p.name.trim() && p.agency.trim() && p.approvedBy.trim() && /^\d{4}-\d{2}-\d{2}$/.test(p.approvedOn) && Date.parse(p.approvedOn) <= Date.now());
}
