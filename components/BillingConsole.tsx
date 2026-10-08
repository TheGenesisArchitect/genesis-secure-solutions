// The console's Billing tab for one client: invoices (send with a Mercury link, mark paid, remove drafts,
// void sent ones), monthly care (start with a prorated first month, stop), upgrades quoted with credit for
// what was paid and prorated care, and new invoices including custom ("Other") ones with line items.
import { ActionForm } from './ActionForm';
import { Panel, Chip, Status, Empty, money, date, PLAN_LABEL } from './ui';
import { PLANS } from '@/data/offers';
import {
  createInvoice, createUpgradeInvoice, deleteInvoice, markInvoicePaid, publishInvoice, sendViaMercury, setCareAutosend, startCare, stopCare, voidInvoice,
} from '@/lib/actions';
import { mercuryConfigured, payUrlTemplate } from '@/lib/mercury';
import { quoteUpgrade, businessToday } from '@/lib/billing';

type Invoice = {
  id: string; kind: string; amount_cents: number; status: string; note: string | null; number: string | null; due_date: string | null;
  pay_url: string | null; paid_at: string | null; paid_via: string | null; lines: { label: string; cents: number }[] | null; upgrade_to: string | null;
  mercury_invoice_id?: string | null; mercury_status?: string | null; mercury_synced_at?: string | null;
};
type Tenant = { id: string; plan: string | null; is_sample: boolean; care_active: boolean; care_plan: string | null; care_rate_cents: number | null; care_started_on: string | null; care_autosend?: boolean };

const KIND: Record<string, string> = { deposit: 'Deposit', balance: 'Balance', care: 'Monthly care', upgrade: 'Upgrade', custom: 'Custom' };
const today = businessToday;
const signed = (c: number) => (c < 0 ? `−${money(-c)}` : money(c));

const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };

export async function BillingConsole({ t, invoices }: { t: Tenant; invoices: Invoice[]; here?: string }) {
  const mercury = mercuryConfigured() && !t.is_sample ? Boolean(await payUrlTemplate()) : false;
  const setupPaid = invoices.filter((i) => i.status === 'paid' && ['deposit', 'balance', 'upgrade'].includes(i.kind)).reduce((s, i) => s + i.amount_cents, 0);
  const order = ['launch', 'growth', 'premium'];
  const current = t.plan === 'vip' ? 'launch' : t.plan ?? 'launch';
  const higher = PLANS.filter((p) => p.setupCents && order.indexOf(p.id) > order.indexOf(current));
  const unpaidSetup = invoices.filter((i) => (i.kind === 'deposit' || i.kind === 'balance') && (i.status === 'draft' || i.status === 'open')).reduce((s, i) => s + i.amount_cents, 0);
  const now = new Date(today() + 'T00:00:00Z');
  const quotes = higher.map((p) => ({ p, q: quoteUpgrade(t, setupPaid, p.id, now, unpaidSetup) }));
  const defaultCare = current === 'premium' ? 'premium' : current === 'growth' ? 'growth' : 'launch';

  return (
    <div className="grid g2" style={{ alignItems: 'start' }}>
      <Panel title="Invoices" sub={mercury ? 'Created and sent through Mercury; marked paid automatically when Mercury reports the payment.' : 'Paid through Mercury: paste each Mercury invoice’s payment link to send it; the client pays from their Billing page.'}>
        {t.is_sample ? <div className="notice sample">Sample client: amounts are illustrative.</div> : null}
        {invoices.length ? (
          <ul className="list">
            {invoices.map((i) => (
              <li key={i.id} style={{ gap: 8 }}>
                <div className="spread">
                  <span><b>{i.number ? `${i.number} · ` : ''}{KIND[i.kind] ?? i.kind}</b> <span className="num">{money(i.amount_cents)}</span>{i.upgrade_to ? <> <Chip kind="info">to {PLAN_LABEL[i.upgrade_to]}</Chip></> : null}</span>
                  <Status value={i.status} />
                </div>
                <span className="muted" style={{ fontSize: 13 }}>
                  {i.note ?? ''}{i.due_date ? ` · due ${date(i.due_date + 'T12:00:00')}` : ''}{i.paid_at ? ` · paid ${date(i.paid_at)}${i.paid_via ? ` via ${i.paid_via}` : ''}` : ''}
                </span>
                {i.lines?.length ? (
                  <dl className="kv lines" style={{ fontSize: 13 }}>
                    {i.lines.flatMap((l, k) => [<dt key={k + 'l'}>{l.label}</dt>, <dd key={k + 'v'} className="num" style={{ textAlign: 'right' }}>{signed(l.cents)}</dd>])}
                  </dl>
                ) : null}
                {i.mercury_invoice_id ? (
                  <span className="muted" style={{ fontSize: 12 }}>In Mercury: <b>{i.mercury_status ?? 'Unpaid'}</b>{i.mercury_synced_at ? ` · checked ${ago(i.mercury_synced_at)}` : ''}{i.pay_url ? <> · <a href={i.pay_url} target="_blank" rel="noreferrer">pay page</a></> : null}</span>
                ) : null}
                {i.status === 'draft' && mercury ? (
                  <ActionForm action={sendViaMercury} className="row">
                    <input type="hidden" name="id" value={i.id} />
                    <input className="input" name="due" type="date" defaultValue={i.due_date ?? ''} style={{ width: 160 }} aria-label="Due date" />
                    <button className="btn small primary" type="submit">{i.kind === 'upgrade' ? 'Send upgrade through Mercury' : 'Create in Mercury & send'}</button>
                  </ActionForm>
                ) : null}
                {i.status === 'draft' || i.status === 'open' ? (
                  <>
                    {i.mercury_invoice_id ? null : (
                    <details open={!mercury || i.status === 'open'}>
                    {mercury ? <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>Or paste a Mercury link yourself</summary> : null}
                    <ActionForm action={publishInvoice} className="row">
                      <input type="hidden" name="id" value={i.id} />
                      <input className="input" name="pay_url" type="url" required defaultValue={i.pay_url ?? ''} placeholder="https://… Mercury invoice payment link" style={{ flex: 2, minWidth: 220 }} aria-label="Mercury payment link" />
                      <input className="input" name="number" defaultValue={i.number ?? ''} placeholder="Invoice #" style={{ width: 110 }} aria-label="Invoice number" />
                      <input className="input" name="due" type="date" defaultValue={i.due_date ?? ''} style={{ width: 160 }} aria-label="Due date" />
                      <button className={'btn small ' + (mercury ? 'ghost' : 'primary')} type="submit">{i.status === 'open' ? 'Update link' : i.kind === 'upgrade' ? 'Send upgrade' : 'Send to client'}</button>
                    </ActionForm>
                    </details>
                    )}
                    <div className="row">
                      <ActionForm action={markInvoicePaid} className="row">
                        <input type="hidden" name="id" value={i.id} />
                        <input className="input" name="via" defaultValue="Mercury" style={{ width: 130 }} aria-label="Paid via" />
                        <input className="input" name="paid_on" type="date" defaultValue={today()} style={{ width: 160 }} aria-label="Paid on" />
                        <button className="btn small good" type="submit">Mark paid</button>
                      </ActionForm>
                      {i.status === 'draft' ? (
                        <ActionForm action={deleteInvoice} confirm="Remove this draft invoice? This is recorded in the audit log.">
                          <input type="hidden" name="id" value={i.id} />
                          <button className="btn small ghost" type="submit">Remove draft</button>
                        </ActionForm>
                      ) : (
                        <ActionForm action={voidInvoice} confirm="Void this sent invoice? The client will no longer see it as due.">
                          <input type="hidden" name="id" value={i.id} />
                          <button className="btn small ghost" type="submit">Void</button>
                        </ActionForm>
                      )}
                    </div>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <Empty title="No invoices yet" />}
      </Panel>

      <div className="grid" style={{ alignContent: 'start' }}>
        <Panel title="Monthly care" sub="The ongoing relationship: billed on the 1st of each month; the first month is prorated">
          {t.care_active ? (
            <>
              <div className="spread"><b>{t.care_plan}</b><span className="num"><b>{money(t.care_rate_cents ?? 0)}</b> <span className="muted">/ month</span></span></div>
              <p className="soft" style={{ fontSize: 14 }}>Running since {date((t.care_started_on ?? today()) + 'T12:00:00')}. {t.care_autosend && mercury ? 'Each month’s invoice is created and sent through Mercury automatically on the 1st.' : 'Each month’s invoice is drafted on the 1st for you to send.'}</p>
              {mercury ? (
                <ActionForm action={setCareAutosend} className="row">
                  <input type="hidden" name="tenant" value={t.id} />
                  <input type="hidden" name="on" value={t.care_autosend ? 'false' : 'true'} />
                  <button className="btn small" type="submit">{t.care_autosend ? 'Turn off automatic billing' : 'Bill automatically through Mercury'}</button>
                </ActionForm>
              ) : null}
              <ActionForm action={stopCare} className="row" confirm="Stop monthly care for this client? Past invoices stay on record.">
                <input type="hidden" name="tenant" value={t.id} />
                <input className="input" name="end" type="date" defaultValue={today()} style={{ width: 160 }} aria-label="Last day of care" />
                <button className="btn small ghost" type="submit">Stop care</button>
              </ActionForm>
            </>
          ) : (
            <ActionForm action={startCare} className="form">
              <input type="hidden" name="tenant" value={t.id} />
              <label className="field"><span>Care plan</span>
                <select className="select" name="plan" defaultValue={defaultCare}>
                  <option value="launch">Essential Care · $249/month</option>
                  <option value="growth">Growth Care · $399/month</option>
                  <option value="premium">Optimization Care · $799/month</option>
                </select>
              </label>
              <label className="field"><span>Start date</span><input className="input" name="start" type="date" defaultValue={today()} /></label>
              {mercury ? <label className="check"><input type="checkbox" name="autosend" /> Bill monthly through Mercury automatically. Ticking this is a standing approval, recorded in the audit log</label> : null}
              <span className="muted" style={{ fontSize: 13 }}>Marks the client launched (the launch checklist must be cleared), moves them to Care and drafts the first month, prorated from the start date to the end of the month.</span>
              <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Start care</button>
            </ActionForm>
          )}
        </Panel>

        {quotes.length ? (
          <Panel title="Upgrade" sub="New setup minus everything paid toward setup; care difference prorated from the upgrade date to month end">
            {quotes.map(({ p, q }) => q ? (
              <div key={p.id} className="tile" style={{ gap: 8 }}>
                <div className="spread"><b>{PLAN_LABEL[current]} → {p.name}</b><b className="num">{signed(q.total)}</b></div>
                <dl className="kv lines" style={{ fontSize: 13 }}>
                  {q.lines.flatMap((l, k) => [<dt key={k + 'l'}>{l.label}</dt>, <dd key={k + 'v'} className="num" style={{ textAlign: 'right' }}>{signed(l.cents)}</dd>])}
                </dl>
                <ActionForm action={createUpgradeInvoice} className="row">
                  <input type="hidden" name="tenant" value={t.id} />
                  <input type="hidden" name="to" value={p.id} />
                  <input className="input" name="on" type="date" defaultValue={today()} style={{ width: 160 }} aria-label="Upgrade effective date" />
                  <button className="btn small primary" type="submit" disabled={q.total <= 0}>Draft upgrade invoice</button>
                </ActionForm>
                <span className="muted" style={{ fontSize: 12 }}>Quoted for today; another date is recalculated when drafted. When it is paid, the plan switches{t.care_active ? ' and care moves to the new rate' : ''}.</span>
              </div>
            ) : null)}
          </Panel>
        ) : null}

        <Panel title="New invoice" sub="Deposit, balance, care, or Other for anything custom">
          <ActionForm action={createInvoice} className="form" resetOnOk>
            <input type="hidden" name="tenant" value={t.id} />
            <label className="field"><span>Type</span>
              <select className="select" name="kind" defaultValue="custom">
                <option value="deposit">Deposit (70%)</option><option value="balance">Balance at launch (30%)</option><option value="care">Monthly care</option><option value="custom">Other (custom)</option>
              </select>
            </label>
            <label className="field"><span>Description the client sees</span><input className="input" name="note" maxLength={300} placeholder="e.g. Spanish landing page and translation" /></label>
            <div className="field"><span>Line items (optional; they add up to the total)</span>
              {[1, 2, 3].map((n) => (
                <div key={n} className="row" style={{ flexWrap: 'nowrap' }}>
                  <input className="input" name={`line${n}`} maxLength={120} placeholder={`Item ${n}`} />
                  <input className="input" name={`amount${n}`} inputMode="decimal" placeholder="$0.00" style={{ width: 120 }} aria-label={`Item ${n} amount`} />
                </div>
              ))}
            </div>
            <label className="field"><span>Or a single amount (USD)</span><input className="input" name="amount" inputMode="decimal" placeholder="625.00" /></label>
            <label className="field"><span>Due date</span><input className="input" name="due" type="date" /></label>
            <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Draft invoice</button>
          </ActionForm>
        </Panel>
      </div>
    </div>
  );
}
