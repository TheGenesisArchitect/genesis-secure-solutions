// The Genovus account's own demo data for the Enterprise screens (PREVIEW only; the caller checks), so the console
// shows a working business: new website inquiries from fictional agencies, care plans billed on the sample agencies
// that are in care (marked Sample on screen, never counted as real revenue), what Helix has been taught, and a
// prospect call list of fictional offices (place IDs prefixed "demo:", shown by name, never Google's).
// Everything staged is replaced on each run. Fictional only: example.com addresses, 555-01xx numbers.

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const HOUR = 3_600_000;
const CONSENT = 'I agree to be contacted by Genovus about my request. Consent is not a condition of purchase.';

const INQUIRIES = [
  { kind: 'agency', org: 'Whitfield Insurance Group', name: 'Dana Whitfield', hoursAgo: 2, details: { plan: 'growth', city: 'Macon, GA', note: 'Four producers; website leads go cold after 5 p.m.' } },
  { kind: 'agency', org: 'Castillo Family Insurance', name: 'Ray Castillo', hoursAgo: 9, details: { plan: 'launch', city: 'Dothan, AL', note: 'Opening a second office in the spring.' } },
  { kind: 'carrier', org: 'Southern Mutual Network', name: 'Lauren Pike', hoursAgo: 26, details: { agencies: '40-60', note: 'Wants a 90-day pilot for its Georgia agencies.' } },
  { kind: 'agency', org: 'Monroe Insurance Partners', name: 'Keisha Monroe', hoursAgo: 50, details: { plan: 'growth', city: 'Tallahassee, FL', note: 'Missed lunch-hour calls are costing renewals.' } },
];
const MEMORY = [
  ['sales', 'goal', 'This quarter’s goal: 5 new Growth clients, with Georgia and Alabama agencies first.'],
  ['sales', 'outcome', 'Agencies that see their own Today screen on the first call book a consult about twice as often.'],
  ['clients', 'preference', 'Owners prefer a text the night before a setup call, not an email.'],
  ['pipeline', 'fact', 'Deposits clear fastest when the proposal is sent the same day as the consult.'],
  ['studio', 'preference', 'Episodes lead with real screens; the cast frames them. Julian closes with “Genovus Just Knows.”'],
  ['operations', 'fact', 'Monthly reports go out the first business day; an operator reviews each one before it sends.'],
];
const PROSPECTS = [
  ['Peachtree Family Insurance', 'GA', 'captive', 'state-farm', 91, 'new', 'Marcy Ellis'],
  ['Coastal Plain Insurance', 'GA', 'independent', 'independent', 88, 'verified', 'Will Hargrove'],
  ['Bluff City Agency', 'AL', 'captive', 'allstate', 86, 'contacting', 'Tonya Reed'],
  ['Gulf Breeze Coverage', 'FL', 'independent', 'independent', 84, 'new', null],
  ['Lone Oak Insurance', 'TX', 'captive', 'farmers', 82, 'verified', 'Hank Duvall'],
  ['Magnolia State Agency', 'AL', 'captive', 'state-farm', 80, 'new', null],
  ['Riverbend Insurance Group', 'GA', 'independent', 'independent', 78, 'contacting', 'Priya Shah'],
  ['Sunbelt Family Agency', 'FL', 'captive', 'allstate', 76, 'new', null],
  ['Hill Country Coverage', 'TX', 'independent', 'independent', 74, 'new', 'Luis Ortega'],
  ['Cedar Shoals Insurance', 'GA', 'captive', 'farmers', 71, 'verified', null],
];
const CARE_CENTS = { launch: 24_900, growth: 39_900, premium: 79_900 };

export async function stageEnterprise(db) {
  const house = must(await db.from('tenants').select('id').eq('slug', 'genovus').single(), 'house');
  const now = Date.now();

  // New inquiries from the website (fictional agencies and one carrier network).
  must(await db.from('inquiries').delete().like('email', '%@genovus-demo.example'), 'clear demo inquiries');
  must(await db.from('inquiries').insert(INQUIRIES.map((q) => ({
    kind: q.kind, org: q.org, name: q.name, email: `${q.name.toLowerCase().replace(/[^a-z]+/g, '.')}@genovus-demo.example`, phone: '(706) 555-0150',
    details: { ...q.details, demo: true }, consent_text: CONSENT, status: 'new', created_at: new Date(now - q.hoursAgo * HOUR).toISOString(),
  }))), 'demo inquiries');

  // Care plans billed on the sample agencies in care (the console marks them Sample; finance counts real only).
  const { data: inCare } = await db.from('tenants').select('id, plan').eq('is_sample', true).eq('stage', 'care');
  for (const t of inCare ?? []) must(await db.from('tenants').update({ care_active: true, care_rate_cents: CARE_CENTS[t.plan] ?? CARE_CENTS.growth }).eq('id', t.id), 'sample care');

  // Sample care requests arrive fresh (this week), so the desk shows replies due, not a backlog.
  const { data: reqs } = await db.from('care_requests').select('id').eq('is_sample', true).neq('status', 'done').order('created_at');
  for (const [i, r] of (reqs ?? []).entries()) must(await db.from('care_requests').update({ created_at: new Date(now - (2 + (i % 6) * 5) * HOUR).toISOString() }).eq('id', r.id), 'fresh care request');

  // What Helix has been taught about the business (kept by a person).
  must(await db.from('helix_memory').delete().eq('tenant_id', house.id).in('text', MEMORY.map((m) => m[2])), 'clear demo memory');
  must(await db.from('helix_memory').insert(MEMORY.map(([department, kind, text], i) => ({
    tenant_id: house.id, department, kind, text, source: i % 2 ? 'conversation' : 'person', status: 'kept',
    created_at: new Date(now - (i + 1) * 30 * HOUR).toISOString(), decided_at: new Date(now - (i + 1) * 30 * HOUR).toISOString(), last_used_at: new Date(now - (i + 1) * 4 * HOUR).toISOString(),
  }))), 'demo memory');

  // The prospect call list: fictional offices in the focus states, due now.
  const carriers = must(await db.from('carriers').select('id, slug'), 'carriers');
  const carrierOf = Object.fromEntries(carriers.map((c) => [c.slug, c.id]));
  must(await db.from('prospects').delete().like('place_id', 'demo:%'), 'clear demo prospects');
  must(await db.from('prospects').insert(PROSPECTS.map(([name, state, segment, carrier, fit, status, contact]) => ({
    place_id: `demo:${name}`, state, segment, carrier_id: carrierOf[carrier] ?? null, fit_score: fit, status, contact_name: contact, next_action_at: null,
    notes: status === 'contacting' ? 'Left a voicemail; asked for the owner.' : null,
  }))), 'demo prospects');

  return { inquiries: INQUIRIES.length, care: (inCare ?? []).length, memory: MEMORY.length, prospects: PROSPECTS.length };
}
