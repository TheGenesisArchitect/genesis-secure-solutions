// Seed the national scenario: a fictional carrier network of 349 agencies across the US, 75 live on
// Genovus and the rest moving through onboarding. Every row is is_sample = true and labeled a scenario in
// the product. Offices are spread by state population; nothing here is any carrier's real data.
// Safe to rerun: tenants are upserted by slug and their sample rows rebuilt.
//   node --env-file=.env.local scripts/seed-national.mjs [--total 349 --live 75]
import postgres from 'postgres';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const TOTAL = arg('--total', 349), LIVE = arg('--live', 75);
const sql = postgres(process.env.POSTGRES_URL_NON_POOLING, { ssl: 'require', max: 1, onnotice: () => {}, transform: { undefined: null } });
const ins = (list) => { const keys = [...new Set(list.flatMap(Object.keys))]; return sql(list.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])))); };

// 2025 population, millions (rounded), with one familiar city per state for realistic names.
const STATES = {
  AL: [5.2, 'Huntsville'], AK: [0.7, 'Anchorage'], AZ: [7.6, 'Phoenix'], AR: [3.1, 'Little Rock'], CA: [39.4, 'Sacramento'], CO: [6.0, 'Denver'],
  CT: [3.7, 'Hartford'], DE: [1.0, 'Dover'], DC: [0.7, 'Washington'], FL: [23.4, 'Orlando'], GA: [11.2, 'Atlanta'], HI: [1.4, 'Honolulu'],
  ID: [2.0, 'Boise'], IL: [12.5, 'Chicago'], IN: [6.9, 'Indianapolis'], IA: [3.2, 'Des Moines'], KS: [3.0, 'Wichita'], KY: [4.6, 'Louisville'],
  LA: [4.6, 'Baton Rouge'], ME: [1.4, 'Portland'], MD: [6.3, 'Baltimore'], MA: [7.1, 'Worcester'], MI: [10.1, 'Grand Rapids'], MN: [5.8, 'Minneapolis'],
  MS: [2.9, 'Jackson'], MO: [6.2, 'Kansas City'], MT: [1.1, 'Billings'], NE: [2.0, 'Omaha'], NV: [3.3, 'Las Vegas'], NH: [1.4, 'Manchester'],
  NJ: [9.5, 'Newark'], NM: [2.1, 'Albuquerque'], NY: [19.9, 'Buffalo'], NC: [11.0, 'Charlotte'], ND: [0.8, 'Fargo'], OH: [11.9, 'Columbus'],
  OK: [4.1, 'Tulsa'], OR: [4.3, 'Portland'], PA: [13.1, 'Pittsburgh'], RI: [1.1, 'Providence'], SC: [5.5, 'Columbia'], SD: [0.9, 'Sioux Falls'],
  TN: [7.2, 'Nashville'], TX: [31.3, 'San Antonio'], UT: [3.5, 'Salt Lake City'], VT: [0.6, 'Burlington'], VA: [8.8, 'Richmond'], WA: [7.9, 'Spokane'],
  WV: [1.8, 'Charleston'], WI: [5.9, 'Madison'], WY: [0.6, 'Cheyenne'],
};
// Extra cities so larger states read like real networks.
const CITIES = { CA: ['Sacramento', 'Fresno', 'San Diego', 'Riverside', 'Bakersfield', 'San Jose'], TX: ['San Antonio', 'Houston', 'Dallas', 'Austin', 'El Paso', 'Fort Worth'], FL: ['Orlando', 'Tampa', 'Jacksonville', 'Miami', 'Pensacola'], NY: ['Buffalo', 'Rochester', 'Albany', 'Syracuse', 'Queens'], PA: ['Pittsburgh', 'Philadelphia', 'Allentown', 'Harrisburg'], IL: ['Chicago', 'Springfield', 'Peoria', 'Naperville'], OH: ['Columbus', 'Cleveland', 'Cincinnati', 'Dayton'], GA: ['Atlanta', 'Columbus', 'Savannah', 'Augusta', 'Macon'], NC: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham'], MI: ['Grand Rapids', 'Detroit', 'Lansing', 'Ann Arbor'], NJ: ['Newark', 'Jersey City', 'Trenton', 'Edison'], VA: ['Richmond', 'Norfolk', 'Virginia Beach', 'Roanoke'], WA: ['Spokane', 'Tacoma', 'Seattle'], AZ: ['Phoenix', 'Tucson', 'Mesa'], TN: ['Nashville', 'Memphis', 'Knoxville'], MA: ['Worcester', 'Boston', 'Springfield'], IN: ['Indianapolis', 'Fort Wayne', 'Evansville'], MO: ['Kansas City', 'St. Louis', 'Springfield'], MD: ['Baltimore', 'Silver Spring', 'Frederick'], WI: ['Madison', 'Milwaukee', 'Green Bay'], CO: ['Denver', 'Colorado Springs', 'Fort Collins'], MN: ['Minneapolis', 'St. Paul', 'Rochester'], SC: ['Columbia', 'Charleston', 'Greenville'], AL: ['Huntsville', 'Birmingham', 'Montgomery', 'Mobile'] };
const SURNAMES = ['Reyes', 'Patel', 'Johnson', 'Nguyen', 'Okafor', 'Morales', 'Kim', 'Thompson', 'Alvarez', 'Washington', 'Chen', 'Brooks', 'Delgado', 'Hart', 'Singh', 'Coleman', 'Rivera', 'Foster', 'Bennett', 'Ortiz', 'Hayes', 'Price', 'Jenkins', 'Sullivan', 'Ramirez', 'Greene', 'Lopez', 'Carter', 'Ward', 'Flores', 'Mitchell', 'Torres', 'Parker', 'Diaz', 'Howard', 'Simmons', 'Ellis', 'Grant', 'Banks', 'Nash'];
const STYLES = ['Insurance', 'Family Insurance', 'Insurance Group', 'Agency', 'Coverage Co.', 'Insurance Partners'];

let seed = 20261008;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// Offices per state by largest remainder on population.
const totalPop = Object.values(STATES).reduce((s, [p]) => s + p, 0);
const quota = Object.entries(STATES).map(([st, [p]]) => ({ st, exact: (p / totalPop) * TOTAL }));
quota.forEach((q) => (q.n = Math.max(q.exact >= 0.5 ? 1 : 0, Math.floor(q.exact))));
let left = TOTAL - quota.reduce((s, q) => s + q.n, 0);
quota.sort((a, b) => (b.exact - b.n) - (a.exact - a.n));
for (let i = 0; left > 0; i = (i + 1) % quota.length, left--) quota[i].n++;
const offices = quota.flatMap((q) => Array.from({ length: q.n }, () => q.st));

// Stage mix: 75 live, the rest spread across onboarding (proportions of the remainder).
const REST = [['review', 0.11], ['build', 0.14], ['intake', 0.22], ['deposit', 0.12], ['propose', 0.14], ['consult', 0.15], ['attract', 0.12]];
const stages = Array(LIVE).fill('care');
const rest = TOTAL - LIVE;
REST.forEach(([s, f], i) => stages.push(...Array(i === REST.length - 1 ? rest - (stages.length - LIVE) : Math.round(rest * f)).fill(s)));
for (let i = stages.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [stages[i], stages[j]] = [stages[j], stages[i]]; }

const GATES = ['photo_rights', 'carrier_approval', 'carrier_rules', 'meta_access', 'domain', 'privacy_notice', 'kickoff'];
const CLEARED = { care: 7, review: 6, build: 5, intake: 2, deposit: 1, propose: 0, consult: 0, attract: 0 };
const months = ['2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01'];
const now = Date.now(), day = 86_400_000;

try {
  const [net] = await sql`insert into networks (slug, name, kind, is_sample) values ('national-scenario', 'National Carrier Network (scenario)', 'carrier', true)
    on conflict (slug) do update set name = excluded.name returning id`;
  const rows = offices.map((st, i) => {
    const sur = SURNAMES[(i * 7 + Math.floor(rnd() * 5)) % SURNAMES.length];
    const stage = stages[i];
    const plan = stage === 'attract' || stage === 'consult' ? null : (rnd() < 0.45 ? 'launch' : rnd() < 0.7 ? 'growth' : 'premium');
    const cities = CITIES[st] ?? [STATES[st][1]];
    return { slug: `nat-${String(i + 1).padStart(3, '0')}`, name: `${sur} ${pick(STYLES)} · ${cities[i % cities.length]}`, state: st, stage, plan,
      care_plan: stage === 'care' ? { launch: 'Essential Care', growth: 'Growth Care', premium: 'Optimization Care' }[plan] : null,
      is_sample: true, stage_since: new Date(now - (3 + Math.floor(rnd() * 60)) * day) };
  });
  const tenants = await sql`insert into tenants ${ins(rows)}
    on conflict (slug) do update set name = excluded.name, state = excluded.state, stage = excluded.stage, plan = excluded.plan,
      care_plan = excluded.care_plan, is_sample = true, stage_since = excluded.stage_since
    returning id, slug, stage, plan`;
  const ids = tenants.map((t) => t.id);
  for (const t of ['gates', 'approvals', 'content_items', 'kpi_snapshots', 'invoices', 'agent_records', 'lifecycle_events']) await sql`delete from ${sql(t)} where tenant_id = any(${ids})`;
  await sql`delete from network_tenants where network_id = ${net.id}`;
  await sql`insert into network_tenants ${ins(ids.map((id) => ({ network_id: net.id, tenant_id: id })))}`;

  const gates = [], approvals = [], content = [], kpis = [], invoices = [], records = [];
  for (const t of tenants) {
    const n = CLEARED[t.stage];
    GATES.forEach((k, i) => gates.push({ tenant_id: t.id, kind: k, status: i < n ? 'cleared' : 'open', cleared_at: i < n ? new Date(now - (10 + i) * day) : null }));
    records.push({ tenant_id: t.id, version: 1, data: sql.json({ agencyName: t.slug, sample: true, note: 'Fictional national-scenario agency' }), is_current: true, note: 'Sample' });
    if (t.stage === 'care') {
      const scale = 0.6 + rnd() * 1.2;
      months.forEach((p, i) => {
        const g = scale * (0.7 + i * 0.1) * (0.92 + rnd() * 0.16);
        const leads = Math.round(13 * g);
        kpis.push({ tenant_id: t.id, period: p, is_sample: true, metrics: sql.json({ visits: Math.round(560 * g), reach: Math.round(3800 * g), engagement: Math.round(340 * g),
          calls: Math.round(20 * g), callbacks: Math.round(10 * g), bookings: t.plan === 'launch' ? 0 : Math.round(5 * g), responseMinutes: Math.max(5, Math.round(40 - i * 4 + rnd() * 8)),
          quotes: Math.round(leads * 0.6), policies: Math.round(leads * 0.26), leads, spendCents: t.plan === 'premium' ? 60_000 : t.plan === 'growth' ? 25_000 : 0 }) });
      });
      const posts = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < posts; k++) content.push({ tenant_id: t.id, channel: k % 2 ? 'instagram' : 'facebook', copy: 'Sample post', status: 'published', scheduled_for: new Date(Date.UTC(2026, 9, 1 + k * 2, 14)), is_sample: true });
      for (let k = 0; k < 3; k++) {
        const req = now - (5 + k * 7) * day;
        approvals.push({ tenant_id: t.id, subject_kind: 'post', title: 'Monthly post', lane: 'required', approver: 'client', status: 'approved', requested_at: new Date(req), decided_at: new Date(req + (4 + rnd() * 40) * 3_600_000), is_sample: true });
      }
      if (rnd() < 0.35) approvals.push({ tenant_id: t.id, subject_kind: 'post', title: 'October post', lane: 'required', approver: 'client', status: 'pending', requested_at: new Date(now - rnd() * 3 * day), is_sample: true });
      const setup = { launch: 150_000, growth: 250_000, premium: 500_000 }[t.plan];
      invoices.push({ tenant_id: t.id, kind: 'deposit', amount_cents: setup * 0.7, status: 'paid', paid_at: new Date(now - 70 * day) }, { tenant_id: t.id, kind: 'balance', amount_cents: setup * 0.3, status: 'paid', paid_at: new Date(now - 40 * day) });
    } else if (['review', 'build', 'intake', 'deposit'].includes(t.stage) && t.plan) {
      const setup = { launch: 150_000, growth: 250_000, premium: 500_000 }[t.plan];
      invoices.push({ tenant_id: t.id, kind: 'deposit', amount_cents: setup * 0.7, status: t.stage === 'deposit' ? 'open' : 'paid', paid_at: t.stage === 'deposit' ? null : new Date(now - 20 * day) });
      if (t.stage === 'review') approvals.push({ tenant_id: t.id, subject_kind: 'site_change', title: 'Draft site, first review', lane: 'required', approver: 'client', status: 'pending', requested_at: new Date(now - rnd() * 4 * day), is_sample: true });
    }
  }
  const chunk = async (table, list) => { for (let i = 0; i < list.length; i += 500) await sql`insert into ${sql(table)} ${ins(list.slice(i, i + 500))}`; };
  await chunk('gates', gates); await chunk('agent_records', records); await chunk('kpi_snapshots', kpis);
  await chunk('content_items', content); await chunk('approvals', approvals); await chunk('invoices', invoices);
  const byStage = tenants.reduce((m, t) => ((m[t.stage] = (m[t.stage] ?? 0) + 1), m), {});
  console.log(`national scenario: ${tenants.length} agencies in ${new Set(offices).size} states`, byStage);
} finally {
  await sql.end();
}
