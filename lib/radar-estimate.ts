// What a competitor sweep out to `miles` should cost, shown before anyone runs it (shared by the console and the
// agency's radar): about one full three-page search per 5-mile square, with room for busy areas that split.
// Text Search Pro list price (lib/places.ts COST_CENTS.text_search); free allowances ignored, so it errs high.
const PAGE_CENTS = 3.2;
export function sweepEstimate(miles: number) {
  const searches = Math.max(3, Math.ceil(((2 * miles) / 5) ** 2 * 0.8) * 3);
  return { searches, cents: Math.ceil(searches * PAGE_CENTS) };
}
