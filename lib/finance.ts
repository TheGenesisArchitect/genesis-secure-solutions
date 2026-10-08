// Genovus growth and financials, as pure functions over rows the page loads (so they are unit-tested).
// Revenue = paid invoices of real agency clients (never sample or internal). MRR = live care plans.
// Spend = recorded expenses + the scanner's estimated Google cost. Acquisition spend (for CAC) = ads, data
// and people; infrastructure and tools are operating costs and count against margin instead.

export type InvoiceRow = { tenant_id: string; kind: string; amount_cents: number; status: string; paid_at: string | null };
export type TenantRow = { id: string; kind: string; is_sample: boolean; care_active: boolean; care_rate_cents: number | null };
export type ExpenseRow = { spent_on: string; category: string; amount_cents: number };
export type ScanRow = { started_at: string; est_cost_cents: number };

export const ACQUISITION = ['ads', 'data', 'people'];
export const OPERATING = ['infrastructure', 'tools', 'other'];

const month = (iso: string) => iso.slice(0, 7);

export function monthsBack(n: number, now = new Date()) {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export function finance(input: { invoices: InvoiceRow[]; tenants: TenantRow[]; expenses: ExpenseRow[]; scans: ScanRow[]; inquiries: { created_at: string }[]; window: string[] }) {
  const real = new Set(input.tenants.filter((t) => t.kind === 'agency' && !t.is_sample).map((t) => t.id));
  const paid = input.invoices.filter((i) => i.status === 'paid' && i.paid_at && real.has(i.tenant_id));
  const inWin = (iso: string) => input.window.includes(month(iso));

  // Monthly series over the window.
  const series = input.window.map((m) => {
    const rev = paid.filter((i) => month(i.paid_at!) === m);
    const exp = input.expenses.filter((e) => month(e.spent_on) === m);
    const scan = input.scans.filter((s) => month(s.started_at) === m).reduce((a, s) => a + s.est_cost_cents, 0);
    return {
      month: m,
      setup: rev.filter((i) => i.kind !== 'care').reduce((a, i) => a + i.amount_cents, 0),
      care: rev.filter((i) => i.kind === 'care').reduce((a, i) => a + i.amount_cents, 0),
      acquisition: exp.filter((e) => ACQUISITION.includes(e.category)).reduce((a, e) => a + e.amount_cents, 0) + scan,
      operating: exp.filter((e) => OPERATING.includes(e.category)).reduce((a, e) => a + e.amount_cents, 0),
    };
  });
  const sum = (k: 'setup' | 'care' | 'acquisition' | 'operating') => series.reduce((a, s) => a + s[k], 0);
  const revenue = sum('setup') + sum('care');
  const acquisition = sum('acquisition');
  const operating = sum('operating');

  // A client is "new" in the month of its first paid invoice.
  const first = new Map<string, string>();
  for (const i of [...paid].sort((a, b) => a.paid_at!.localeCompare(b.paid_at!))) if (!first.has(i.tenant_id)) first.set(i.tenant_id, i.paid_at!);
  const newClients = [...first.values()].filter(inWin).length;

  const live = input.tenants.filter((t) => real.has(t.id) && t.care_active);
  const mrr = live.reduce((a, t) => a + (t.care_rate_cents ?? 0), 0);
  const avgCare = live.length ? mrr / live.length : null;
  const setupPaidByClient = new Map<string, number>();
  for (const i of paid.filter((x) => x.kind !== 'care')) setupPaidByClient.set(i.tenant_id, (setupPaidByClient.get(i.tenant_id) ?? 0) + i.amount_cents);
  const avgSetup = setupPaidByClient.size ? [...setupPaidByClient.values()].reduce((a, b) => a + b, 0) / setupPaidByClient.size : null;

  const cac = newClients ? acquisition / newClients : null;
  // Months of care needed to repay what setup did not already cover.
  const payback = cac == null ? null : avgSetup != null && avgSetup >= cac ? 0 : avgCare ? Math.max(0, cac - (avgSetup ?? 0)) / avgCare : null;
  const inquiries = input.inquiries.filter((q) => inWin(q.created_at)).length;

  return {
    series, revenue, setup: sum('setup'), care: sum('care'), acquisition, operating,
    profit: revenue - acquisition - operating,
    grossMargin: revenue ? (revenue - operating) / revenue : null,
    mrr, arr: mrr * 12, liveClients: live.length, newClients, cac, payback, avgSetup, avgCare,
    inquiries, costPerInquiry: inquiries ? acquisition / inquiries : null,
  };
}
