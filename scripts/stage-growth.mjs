// The demo agency's growth data (Brooks Family Insurance, fictional; sample tenant only), so every screen in the
// Screen Library shows a working office instead of zeros: its market profile and lines, a tracking number, about two
// months of leads (sources, statuses, first contacts, booked consults, wins), the calls behind them, referral
// partners at every stage, this month's source costs, follow-ups done this week and due today, and six months of
// results ending this month. Every date is relative to today, and everything is replaced on each run.
// Fictional only: 555-01xx numbers, example.com addresses, partner place IDs prefixed "demo:" (never Google's).

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const FIRST = ['Maria', 'James', 'Keisha', 'Tom', 'Ana', 'Derek', 'Priya', 'Luis', 'Grace', 'Marcus', 'Tanya', 'Owen', 'Rosa', 'Caleb', 'Imani', 'Victor', 'Hannah', 'Andre', 'Nina', 'Wes', 'Carmen', 'Eli', 'Joy', 'Ray', 'Lena', 'Omar', 'Paige', 'Sam', 'Tia', 'Hector', 'Dana', 'Brett', 'Mei', 'Curtis', 'Alma', 'Reggie', 'Sofia', 'Dwayne', 'Lucy', 'Felix', 'Nora', 'Isaac', 'Bianca', 'Glen'];
const LAST = ['Delgado', 'Whitaker', 'Monroe', 'Albrecht', 'Okafor', 'Hughes', 'Raman', 'Castillo', 'Pruitt', 'Bell', 'Greer', 'Sutton', 'Ibarra', 'Lowe', 'Mensah', 'Navarro', 'Fisk', 'Holloway', 'Park', 'Tate', 'Reyes', 'Brandt', 'Coleman', 'Duarte', 'Engel', 'Farah', 'Gaines', 'Hart', 'Irwin', 'Juarez', 'Kemp', 'Lyle', 'Moss', 'Nash', 'Ortega', 'Pike', 'Quinn', 'Rowe', 'Sharpe', 'Tran', 'Vance', 'Wolfe', 'Young', 'Ziegler'];
const TOPICS = [
  ['Auto quote review', 'auto'], ['Bundle home and auto', 'home'], ['New teen driver', 'auto'], ['Boat coverage before spring', 'boat'],
  ['RV policy for a new camper', 'rv'], ['Renters: move-in ready', 'renters'], ['New homeowners', 'home'], ['Year-end car purchase', 'auto'],
];
const MESSAGES = {
  auto: 'Shopping our auto rates before renewal. Two cars, one teen driver next year.',
  home: 'Closing on a house next month and the lender needs proof of insurance.',
  boat: 'Bought a pontoon this fall, need coverage for the slip at the marina.',
  rv: 'Picked up a travel trailer, want it insured before our first trip.',
  renters: 'Moving into a new apartment, the lease requires renters insurance.',
};
// Referral partners (fictional businesses): every stage of the partner board.
const PARTNERS = [
  { name: 'Lake Oliver Marina', line: 'boat', category: 'marina', mi: 3.2, fit: 92, status: 'referring', contact: 'Gil Navarro', notes: 'Sends slip renters our way; card at the front desk.' },
  { name: 'Riverside Auto Plaza', line: 'auto', category: 'car-dealer', mi: 2.1, fit: 90, status: 'referring', contact: 'Tasha Greer', notes: 'Finance office hands buyers our referral link.' },
  { name: 'Southern Pines RV Center', line: 'rv', category: 'rv-dealer', mi: 6.8, fit: 86, status: 'partner', contact: 'Mike Lowe', notes: 'Agreed to share our link with spring buyers.' },
  { name: 'Hearth & Key Realty', line: 'home', category: 'realtor', mi: 1.4, fit: 84, status: 'meeting', contact: 'Ana Ibarra', notes: 'Lunch-and-learn for her agents.', visitIn: 2 },
  { name: 'Chattahoochee Boat Sales', line: 'boat', category: 'boat-dealer', mi: 5.5, fit: 81, status: 'called', notes: 'Left a message with the sales manager.' },
  { name: 'Magnolia Flats Apartments', line: 'renters', category: 'apartments', mi: 1.9, fit: 74, status: 'called', notes: 'Leasing office asked for a one-page flyer.' },
  { name: 'Riverside Title Co.', line: 'home', category: 'title', mi: 2.6, fit: 70, status: 'new' },
  { name: 'Pine Hollow RV Park', line: 'rv', category: 'rv-park', mi: 9.4, fit: 66, status: 'new' },
];

/** Stage the demo agency's growth data. `tenantId` must be a sample tenant (the caller checks). */
export async function stageGrowth(db, tenantId) {
  const t = must(await db.from('tenants').select('is_sample').eq('id', tenantId).single(), 'tenant');
  if (!t.is_sample) throw new Error('refusing: growth data is staged on sample tenants only');
  const now = Date.now();
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  // The office's market: where it is, how far it serves, the lines it sells (Brooks: auto, home, renters, boat, RV).
  must(await db.from('agency_profiles').upsert({ tenant_id: tenantId, city: 'Riverside', state: 'GA', zip: '31901', service_radius_mi: 20, lines: ['auto', 'home', 'renters', 'boat', 'rv'], licensed_states: ['GA', 'AL'], main_phone_e164: '+17065550170', website: 'https://brooks-family.example', timezone: 'America/New_York' }, { onConflict: 'tenant_id' }), 'profile');

  // A tracking number on the website, so calls arrive tagged with their source.
  let num = (await db.from('tracking_numbers').select('id').eq('tenant_id', tenantId).eq('e164', '+17065550171').maybeSingle()).data;
  if (!num) num = must(await db.from('tracking_numbers').insert({ tenant_id: tenantId, e164: '+17065550171', twilio_sid: 'PNdemobrooks00000000000000000000', label: 'Website', source: 'website', forward_to: '+17065550170', record: true }).select('id').single(), 'number');

  // Partners first (leads reference them). Fictional place IDs ("demo:<name>") resolve to their names on screen.
  must(await db.from('leads').delete().eq('tenant_id', tenantId).like('ext_id', 'demo-%'), 'clear demo leads');
  must(await db.from('partner_targets').delete().eq('tenant_id', tenantId).like('place_id', 'demo:%'), 'clear demo partners');
  const partners = must(await db.from('partner_targets').insert(PARTNERS.map((p, i) => ({
    tenant_id: tenantId, place_id: `demo:${p.name}`, line: p.line, category: p.category, distance_mi: p.mi, fit: p.fit, status: p.status,
    ref_code: `demo${String(i).padStart(4, '0')}`, contact_name: p.contact ?? null, notes: p.notes ?? null,
    next_action_at: p.visitIn ? new Date(now + p.visitIn * DAY - (now % DAY) + 16.5 * HOUR).toISOString() : p.status === 'called' ? new Date(now + 3 * DAY).toISOString() : null,
    first_seen: new Date(now - (40 - i * 3) * DAY).toISOString(),
  }))).select('id, status'), 'partners');
  const referring = partners.filter((p) => p.status === 'referring' || p.status === 'partner');

  // About 22 leads a month for two months; the newest are still new, most are reached within the hour.
  const rows = [];
  const N = 44;
  for (let i = 0; i < N; i++) {
    const ageDays = i < 3 ? 0.1 + i * 0.6 : Math.min(59, 1.2 + (i - 3) * (58 / (N - 3)) + rnd() * 0.8);
    const created = now - ageDays * DAY;
    const [topic, line] = pick(TOPICS);
    const roll = rnd();
    const source = roll < 0.34 ? 'website' : roll < 0.58 ? 'google' : roll < 0.72 ? 'facebook' : roll < 0.84 ? 'referral' : 'partner';
    const channel = source === 'partner' ? 'partner' : (source === 'website' || source === 'google') && rnd() < 0.4 ? 'call' : 'form';
    let status;
    if (i < 3) status = 'new';
    else if (ageDays < 6) status = rnd() < 0.5 ? 'contacted' : 'booked';
    else { const s = rnd(); status = s < 0.34 ? 'won' : s < 0.5 ? 'lost' : s < 0.72 ? 'contacted' : s < 0.86 ? (ageDays < 14 ? 'booked' : 'won') : 'won'; }
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    const reply = status === 'new' ? null : created + (4 + Math.floor(rnd() * 34)) * MIN;
    // Booked consults: the recent ones land this week on the calendar; older ones were held already.
    const booked = status === 'booked' ? new Date(ageDays < 8 ? now + (1 + Math.floor(rnd() * 3)) * DAY + (13 + Math.floor(rnd() * 7)) * HOUR - (now % DAY) : created + 3 * DAY - (created % DAY) + (14 + Math.floor(rnd() * 6)) * HOUR).toISOString() : null;
    rows.push({
      tenant_id: tenantId, ext_id: `demo-${String(i).padStart(3, '0')}`, name, topic,
      email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`, phone: `(706) 555-01${String(10 + (i % 90)).padStart(2, '0')}`,
      message: channel === 'call' ? null : MESSAGES[line] ?? null, source, medium: source === 'google' ? 'organic' : source === 'facebook' ? 'social' : null,
      campaign: source === 'facebook' && line === 'boat' ? 'boating-season' : null, channel,
      partner_id: channel === 'partner' && referring.length ? referring[i % referring.length].id : null,
      attribution: { demo: true }, consent_text: 'I agree to be contacted about my request by phone, text or email. Consent is not a condition of purchase.',
      consent_at: new Date(created).toISOString(), status, first_contact_at: reply ? new Date(reply).toISOString() : null, booked_for: booked,
      note: status === 'won' ? 'Bound with the carrier; welcome call done.' : status === 'lost' ? 'Went with a lower quote elsewhere.' : status === 'booked' ? 'Consult booked: bring declarations pages.' : null,
      created_at: new Date(created).toISOString(), updated_at: new Date(reply ?? created).toISOString(),
    });
  }
  const leads = must(await db.from('leads').insert(rows).select('id, channel, created_at, status, name, topic'), 'leads');

  // The calls behind phone leads (Helix's note after each), plus two missed calls this week.
  must(await db.from('calls').delete().eq('tenant_id', tenantId).like('call_sid', 'CAbrooks%'), 'clear demo calls');
  const calls = leads.filter((l) => l.channel === 'call').map((l, i) => ({
    tenant_id: tenantId, number_id: num.id, call_sid: `CAbrooks${String(i).padStart(26, '0')}`, from_e164: `+170655501${String(20 + i).padStart(2, '0')}`,
    started_at: l.created_at, duration_s: 90 + ((i * 37) % 240), status: 'answered', lead_id: l.id,
    summary: `${l.name} called about ${String(l.topic).toLowerCase()}. ${l.status === 'new' ? 'Wants a call back today.' : 'Answered on the first ring; details taken.'}`,
  }));
  calls.push(
    { tenant_id: tenantId, number_id: num.id, call_sid: `CAbrooks${'9'.repeat(25)}1`, from_e164: '+17065550198', started_at: new Date(now - 26 * HOUR).toISOString(), duration_s: 0, status: 'missed', lead_id: null, summary: null },
    { tenant_id: tenantId, number_id: num.id, call_sid: `CAbrooks${'9'.repeat(25)}2`, from_e164: '+17065550199', started_at: new Date(now - 3 * DAY).toISOString(), duration_s: 0, status: 'missed', lead_id: null, summary: null },
  );
  must(await db.from('calls').insert(calls), 'calls');

  // What the office recorded spending this month and last (Google ads, Facebook boosts).
  const monthStart = (back) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 10); };
  for (const back of [0, 1]) for (const [source, cents, note] of [['google', 18000, 'Local search ads'], ['facebook', 12000, 'Boosted boating-season posts']]) {
    must(await db.from('source_costs').upsert({ tenant_id: tenantId, month: monthStart(back), source, cents: back ? cents + 2500 : cents, note }, { onConflict: 'tenant_id,month,source' }), 'source cost');
  }

  // Six months of results ending this month (the same numbers, re-dated), so "this month" is never last season.
  const { data: snaps } = await db.from('kpi_snapshots').select('period, metrics, is_sample').eq('tenant_id', tenantId).order('period');
  if (snaps?.length) {
    const last = snaps.slice(-6);
    must(await db.from('kpi_snapshots').delete().eq('tenant_id', tenantId), 'clear snapshots');
    must(await db.from('kpi_snapshots').insert(last.map((s, i) => ({ tenant_id: tenantId, period: monthStart(last.length - 1 - i), metrics: s.metrics, is_sample: true }))), 'snapshots');
  }

  // Follow-ups: a few done this week and two due today, beside the filming plan's open ones.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const dayOff = (n) => { const x = new Date(`${today}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  must(await db.from('follow_ups').insert([
    { tenant_id: tenantId, who: 'Maria Delgado', reason: 'Added her teen driver; send the updated ID cards', due_on: dayOff(0), due_at: '10:00', status: 'open' },
    { tenant_id: tenantId, who: 'Hearth & Key Realty', reason: 'Confirm the lunch-and-learn headcount', due_on: dayOff(0), due_at: '14:30', status: 'open' },
    { tenant_id: tenantId, who: 'James Whitaker', reason: 'Bundle quote sent: home and two cars', due_on: dayOff(-1), status: 'done', done_at: new Date(now - 20 * HOUR).toISOString() },
    { tenant_id: tenantId, who: 'Lake Oliver Marina', reason: 'Dropped off referral cards for the front desk', due_on: dayOff(-2), status: 'done', done_at: new Date(now - 44 * HOUR).toISOString() },
    { tenant_id: tenantId, who: 'Keisha Monroe', reason: 'Renewal review: kept her rate, added roadside', due_on: dayOff(-2), status: 'done', done_at: new Date(now - 50 * HOUR).toISOString() },
    { tenant_id: tenantId, who: 'Tom Albrecht', reason: 'Boat policy bound before the slip contract', due_on: dayOff(-3), status: 'done', done_at: new Date(now - 70 * HOUR).toISOString() },
  ]), 'follow-ups');

  return { leads: leads.length, calls: calls.length, partners: partners.length };
}
