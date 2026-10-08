// Billing math shared by the console and the server actions: care rates, proration and upgrade quotes.
import { PLANS } from '@/data/offers';

/** Today as YYYY-MM-DD in the business time zone (Eastern), so evening saves are not dated tomorrow. */
export const businessToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

export const careName: Record<string, string> = { launch: 'Essential Care', vip: 'Essential Care', growth: 'Growth Care', premium: 'Optimization Care' };
export const careRate: Record<string, number> = { launch: 24_900, vip: 24_900, growth: 39_900, premium: 79_900 };
export const monthEnd = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
export const daysInMonth = (d: Date) => monthEnd(d).getUTCDate();

/** Quote an upgrade: new setup minus everything paid toward setup, plus prorated care for the rest of the month. */
export function quoteUpgrade(t: { plan: string | null; care_active: boolean; care_rate_cents: number | null }, setupPaid: number, to: string, on: Date, unpaidSetup = 0) {
  const target = PLANS.find((p) => p.id === to);
  if (!target?.setupCents) return null;
  const lines: { label: string; cents: number }[] = [
    { label: `${target.name} setup`, cents: target.setupCents },
    { label: 'Credit: paid toward setup to date', cents: -Math.min(setupPaid, target.setupCents) },
  ];
  if (unpaidSetup > 0) lines.push({ label: `Replaces the unpaid setup balance of $${(unpaidSetup / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} (retired when the upgrade is drafted)`, cents: 0 });
  if (t.care_active && t.care_rate_cents != null) {
    const diff = careRate[to] - t.care_rate_cents;
    if (diff > 0) {
      const dim = daysInMonth(on), left = dim - on.getUTCDate() + 1;
      lines.push({ label: `${careName[to]} difference, ${on.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} to ${monthEnd(on).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} (${left} of ${dim} days)`, cents: Math.round((diff * left) / dim) });
    }
  }
  return { lines, total: lines.reduce((s, l) => s + l.cents, 0), plan: target };
}

