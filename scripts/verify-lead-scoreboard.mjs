// Verify the lead scoreboard (lib/lead-scoreboard.ts, docs/LEAD_ENGINE_SPEC.md §4.8) on seeded rows: the numbers
// match the rows, and a source with too few leads says "not enough data yet" instead of 0. No database.
//   node scripts/verify-lead-scoreboard.mjs
import { scoreboard, MIN_LEADS } from '../lib/lead-scoreboard.ts';

let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) failed++; };
const at = (min) => new Date(Date.UTC(2026, 10, 2, 15, 0) + min * 60_000).toISOString();
const lead = (source, status, firstMin, extra = {}) => ({ source, status, created_at: at(0), first_contact_at: firstMin == null ? null : at(firstMin), ...extra });

// Facebook: 6 leads. Reached at 2, 4, 6, 8, 30 min; one never. 3 quoted (one of them bound later), 2 bound.
const leads = [
  lead('facebook', 'won', 2, { premium_cents: 120000, lines_bound: ['auto', 'home'], contact_id: 'h1', quoted_at: at(60) }),
  lead('facebook', 'won', 4, { premium_cents: 80000, lines_bound: ['auto'], contact_id: 'h2' }),
  lead('facebook', 'quoted', 6),
  lead('facebook', 'contacted', 8),
  lead('facebook', 'lost', 30),
  lead('facebook', 'new', null),
  // Partner: 2 leads only.
  lead('partner', 'won', 3, { premium_cents: 50000, lines_bound: ['auto'], contact_id: 'h3' }),
  lead('partner', 'new', null),
];
const costs = [{ source: 'facebook', cents: 30000 }, { source: 'facebook', cents: 10000 }];
const b = scoreboard(leads, costs);
const fb = b.rows.find((r) => r.source === 'facebook'), pa = b.rows.find((r) => r.source === 'partner');
check(fb.leads === 6 && fb.enough && fb.medianMin === 6, `median first touch is the middle reached lead (${fb.medianMin} min)`);
check(Math.abs(fb.contactRate - 5 / 6) < 1e-9 && Math.abs(fb.quoteRate - 3 / 6) < 1e-9 && Math.abs(fb.boundRate - 2 / 6) < 1e-9, 'reached 5/6, quoted 3/6 (bound counts as quoted), bound 2/6');
check(fb.premiumCents === 200000 && fb.costCents === 40000 && fb.costPerBoundCents === 20000, 'premium $2,000; cost $400 over two months; $200 per bound policy');
check(pa.leads === 2 && !pa.enough && pa.contactRate === null && pa.boundRate === null && pa.costCents === null, `a source with fewer than ${MIN_LEADS} leads shows no rates (not 0)`);
check(b.all.leads === 8 && b.all.bound === 3 && b.all.premiumCents === 250000, 'all sources together: 8 leads, 3 bound, $2,500');
check(b.linesPerHousehold === null && b.households === 3, 'lines per household waits for enough households (3 so far)');
const many = Array.from({ length: 5 }, (_, i) => lead('website', 'won', 5, { contact_id: `w${i}`, lines_bound: i < 2 ? ['auto', 'home'] : ['auto'] }));
check(scoreboard(many, []).linesPerHousehold === 7 / 5, 'with 5 households: 7 lines / 5 = 1.4');
check(scoreboard([], []).all.quoteRate === null, 'no leads: nothing, not 0');
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
