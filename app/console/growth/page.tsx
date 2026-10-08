// Growth & financials: Genovus as its own client. Revenue from paid invoices and live care plans, spend from
// the expense ledger (+ the scanner's Google cost), and the KPIs that follow: CAC, payback, margin, MRR.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { RevenueChart } from '@/components/RevenueChart';
import { Panel, Tile, Chip, Empty, money } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { finance, monthsBack, ACQUISITION } from '@/lib/finance';
import { businessToday } from '@/lib/billing';
import { addExpense, deleteExpense } from '@/lib/actions';

export const metadata = { title: 'Growth & financials' };
export const dynamic = 'force-dynamic';

const CATS: [string, string][] = [['ads', 'Ads'], ['data', 'Data (e.g. Google Places)'], ['people', 'People (sales, contractors)'], ['infrastructure', 'Infrastructure (Vercel, Supabase…)'], ['tools', 'Tools & subscriptions'], ['other', 'Other']];

export default async function Growth({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const v = await requireStaff();
  const sp = await searchParams;
  const n = [3, 6, 12].includes(Number(sp.m)) ? Number(sp.m) : 6;
  const window = monthsBack(n);
  const since = window[0] + '-01';
  const supabase = await db();
  const canMoney = v.staff.role === 'admin' || v.staff.role === 'account_lead';
  const [{ data: invoices }, { data: tenants }, { data: expenses }, { data: scans }, { data: inquiries }, { data: campaigns }] = await Promise.all([
    supabase.from('invoices').select('tenant_id, kind, amount_cents, status, paid_at').eq('status', 'paid'),
    supabase.from('tenants').select('id, kind, is_sample, care_active, care_rate_cents'),
    supabase.from('expenses').select('id, spent_on, category, vendor, amount_cents, recurring, note, campaign_id').gte('spent_on', since).order('spent_on', { ascending: false }),
    supabase.from('scan_runs').select('started_at, est_cost_cents').gte('started_at', since),
    supabase.from('inquiries').select('created_at, status, campaign_id').gte('created_at', since),
    supabase.from('campaigns').select('id, name').order('created_at', { ascending: false }),
  ]);
  const f = finance({ invoices: invoices ?? [], tenants: tenants ?? [], expenses: expenses ?? [], scans: scans ?? [], inquiries: inquiries ?? [], window });
  const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const scanCost = (scans ?? []).reduce((a, s) => a + s.est_cost_cents, 0);
  const converted = (inquiries ?? []).filter((q) => q.status === 'converted').length;
  return (
    <ConsoleShell title="Growth & financials" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Growth & financials' }]}
      actions={<div className="row">{[3, 6, 12].map((m) => <Link key={m} className={'btn small' + (m === n ? ' primary' : '')} href={`/console/growth?m=${m}`}>{m} months</Link>)}</div>}>
      <p className="soft">Genovus as its own client: revenue from paid invoices and live care plans, spend from the ledger below. Sample and internal accounts never count.</p>
      <div className="grid g4">
        <Tile label="Revenue" value={money(f.revenue)} hint={`${money(f.setup)} setup · ${money(f.care)} care`} />
        <Tile label="MRR" value={money(f.mrr)} hint={`${f.liveClients} on care · ARR ${money(f.arr)}`} />
        <Tile label="Spend" value={money(f.acquisition + f.operating)} hint={`${money(f.acquisition)} acquisition · ${money(f.operating)} operating`} />
        <Tile label="Profit" value={money(f.profit)} hint={`Gross margin ${pct(f.grossMargin)}`} />
      </div>
      <div className="grid g4">
        <Tile label="New clients" value={<span className="num">{f.newClients}</span>} hint={`First payment in the last ${n} months`} />
        <Tile label="CAC" value={f.cac == null ? '—' : money(f.cac)} hint="Acquisition spend ÷ new clients" />
        <Tile label="Payback" value={f.payback == null ? '—' : f.payback === 0 ? 'At setup' : `${f.payback.toFixed(1)} mo`} hint={f.avgSetup != null ? `Avg setup ${money(f.avgSetup)}; then care` : 'Months of care to repay CAC'} />
        <Tile label="Cost per inquiry" value={f.costPerInquiry == null ? '—' : money(f.costPerInquiry)} hint={`${f.inquiries} inquiries · ${converted} converted`} />
      </div>
      <Panel title="Revenue vs spend" sub="Each month: revenue on the left (setup, then care), spend on the right (acquisition, then operating)">
        <RevenueChart series={f.series} />
        <div className="row muted" style={{ fontSize: 12, gap: 16 }}>
          <span><i className="sw rev-setup" /> Setup</span><span><i className="sw rev-care" /> Care</span><span><i className="sw sp-acq" /> Acquisition</span><span><i className="sw sp-op" /> Operating</span>
          {scanCost ? <span>Includes ~{money(scanCost)} estimated Google Places cost</span> : null}
        </div>
      </Panel>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="Expense ledger" sub={`Last ${n} months · acquisition = ${ACQUISITION.join(', ')}`}>
          {!canMoney ? <p className="muted">Only an admin or account lead can see expenses.</p> : expenses?.length ? (
            <ul className="list">
              {expenses.map((e) => (
                <li key={e.id} style={{ gap: 4 }}>
                  <div className="spread"><b>{e.vendor}</b><span className="num">{money(e.amount_cents)}</span></div>
                  <div className="spread">
                    <span className="muted" style={{ fontSize: 13 }}>{e.spent_on} · {e.category}{e.recurring ? ' · monthly' : ''}{e.note ? ` · ${e.note}` : ''}</span>
                    {v.staff.role === 'admin' ? (
                      <ActionForm action={deleteExpense} confirm={`Remove ${e.vendor} ${money(e.amount_cents)}?`}>
                        <input type="hidden" name="id" value={e.id} /><button className="btn small ghost" type="submit">Remove</button>
                      </ActionForm>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : <Empty title="No expenses yet">Record your monthly costs (Vercel, Supabase, Static IPs, Mercury, Resend, Google Places, ads) so CAC and margin are real.</Empty>}
        </Panel>
        {canMoney ? (
          <Panel title="Record an expense" sub="Tick monthly for recurring costs: they carry forward on the 1st">
            <ActionForm action={addExpense} className="form" resetOnOk>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <label className="field" style={{ flex: 2 }}><span>Vendor</span><input className="input" name="vendor" required maxLength={80} placeholder="Vercel" /></label>
                <label className="field" style={{ flex: 1 }}><span>Amount (USD)</span><input className="input" name="amount" required inputMode="decimal" placeholder="100.00" /></label>
              </div>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <label className="field" style={{ flex: 1 }}><span>Category</span><select className="select" name="category">{CATS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label className="field" style={{ flex: 1 }}><span>Date</span><input className="input" type="date" name="on" defaultValue={businessToday()} /></label>
              </div>
              <label className="field"><span>Campaign (optional)</span><select className="select" name="campaign" defaultValue=""><option value="">None</option>{(campaigns ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <label className="check"><input type="checkbox" name="recurring" /> Monthly cost</label>
              <label className="field"><span>Note</span><input className="input" name="note" maxLength={300} /></label>
              <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Record expense</button>
            </ActionForm>
          </Panel>
        ) : null}
      </div>
      <p className="muted" style={{ fontSize: 12 }}><Chip kind="info">Definitions</Chip> CAC uses acquisition spend only (ads, data, people). Payback is months of average care needed to cover CAC beyond what setup already paid. Margin subtracts operating costs (infrastructure, tools, other) from revenue.</p>
    </ConsoleShell>
  );
}
