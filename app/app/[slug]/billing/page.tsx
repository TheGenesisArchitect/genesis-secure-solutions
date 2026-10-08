import { notFound } from 'next/navigation';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Tile, Status, Empty, PLAN_LABEL, money, date } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { PLANS, RESPONSE_TIMES } from '@/data/offers';

export const metadata = { title: 'Billing & maintenance' };

const KIND: Record<string, string> = { deposit: 'Deposit', balance: 'Balance at launch', care: 'Monthly care', upgrade: 'Upgrade', custom: 'Invoice' };
const signed = (c: number) => (c < 0 ? `−${money(-c)}` : money(c));
const due = (d: string | null) => (d ? date(d + 'T12:00:00') : null);

export default async function Billing({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  if (!ctx.isOwner) notFound();
  const supabase = await db();
  const [{ data: t }, { data: invoices }] = await Promise.all([
    supabase.from('tenants').select('plan, care_plan, stage, care_active, care_rate_cents, care_started_on').eq('id', ctx.tenant.tenantId).single(),
    supabase.from('invoices').select('*').eq('tenant_id', ctx.tenant.tenantId).neq('status', 'void').order('created_at'),
  ]);
  const rows = invoices ?? [];
  const open = rows.filter((i) => i.status === 'open');
  const paid = rows.filter((i) => i.status === 'paid');
  const paidTotal = paid.reduce((s, i) => s + i.amount_cents, 0);
  const dueTotal = open.reduce((s, i) => s + i.amount_cents, 0);
  const current = t?.plan ?? 'launch';
  const offer = PLANS.find((p) => p.id === (current === 'vip' ? 'launch' : current));
  const upgrades = PLANS.filter((p) => p.setupCents && PLANS.indexOf(p) > PLANS.findIndex((x) => x.id === (current === 'vip' ? 'launch' : current)));
  const live = !!t?.care_active;
  return (
    <AgencyShell ctx={ctx} title="Billing & maintenance">
      {ctx.tenant.isSample ? <div className="notice sample">Sample agency: amounts are illustrative.</div> : null}
      <div className="grid g4">
        <Tile label="Your plan" value={PLAN_LABEL[current]} hint={t?.care_plan ? `Maintenance: ${t.care_plan}` : 'Maintenance starts at launch'} />
        <Tile label="Due now" value={<span className="num">{money(dueTotal)}</span>} hint={open.length ? `${open.length} invoice${open.length > 1 ? 's' : ''} ready to pay` : 'Nothing due'} />
        <Tile label="Paid to date" value={<span className="num">{money(paidTotal)}</span>} hint="Counts in full toward any upgrade" />
      </div>

      <Panel title="Ready to pay" sub="Payments go securely through Mercury, our bank. You can pay by bank transfer or card on Mercury’s page.">
        {open.length ? (
          <ul className="list">
            {open.map((i) => (
              <li key={i.id} style={{ gap: 10 }}>
                <div className="spread">
                  <span><b>{KIND[i.kind] ?? i.kind}</b>{i.number ? <span className="muted"> · Invoice {i.number}</span> : null}</span>
                  <b className="num" style={{ font: '800 22px var(--display)' }}>{money(i.amount_cents)}</b>
                </div>
                <span className="soft" style={{ fontSize: 14 }}>{i.note ?? ''}{due(i.due_date) ? ` · Due ${due(i.due_date)}` : ''}</span>
                {Array.isArray(i.lines) && i.lines.length ? (
                  <dl className="kv lines" style={{ fontSize: 13 }}>
                    {(i.lines as { label: string; cents: number }[]).flatMap((l, k) => [<dt key={k + 'l'}>{l.label}</dt>, <dd key={k + 'v'} className="num" style={{ textAlign: 'right' }}>{signed(l.cents)}</dd>])}
                  </dl>
                ) : null}
                {i.pay_url ? (
                  <a className="btn primary" href={i.pay_url} target="_blank" rel="noopener noreferrer" style={{ justifySelf: 'start', minHeight: 44 }}>Pay {money(i.amount_cents)} with Mercury ↗</a>
                ) : <span className="muted" style={{ fontSize: 13 }}>Your payment link is on its way.</span>}
                <span className="muted" style={{ fontSize: 12 }}>Opens Mercury’s secure payment page. We mark it paid here as soon as it clears.</span>
              </li>
            ))}
          </ul>
        ) : <Empty title="You’re all paid up">New invoices appear here, and we email you when one is ready.</Empty>}
      </Panel>

      <div className="grid g2">
        <Panel title="Maintenance plan" sub="What your monthly care covers once you are live">
          {offer ? (
            <>
              <div className="spread"><b>{offer.careName}</b><span className="num"><b>{money(offer.careCents ?? 0)}</b> <span className="muted">/ month</span></span></div>
              <p className="soft" style={{ fontSize: 14 }}>
                {live ? `Active since ${date((t?.care_started_on ?? '') + 'T12:00:00')} at ${money(t?.care_rate_cents ?? 0)}/month, billed on the 1st. Request changes any time from Monthly care.` : 'Starts at launch, month to month with 30 days’ notice. Unused work does not roll over.'}
              </p>
              <ul className="soft" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 14 }}>
                <li>Change requests to your site and profiles</li>
                <li>Posts drafted for your approval each month</li>
                <li>A monthly report with one recommended improvement</li>
                <li>Twelve months for the price of ten when paid yearly</li>
              </ul>
              <dl className="kv" style={{ marginTop: 6 }}>
                {RESPONSE_TIMES.flatMap((r) => [<dt key={r.plan}>{r.plan}</dt>, <dd key={r.plan + 'v'}>{r.reply}</dd>])}
              </dl>
            </>
          ) : null}
        </Panel>
        <Panel title="Payment history">
          {paid.length ? (
            <ul className="list">
              {paid.map((i) => (
                <li key={i.id}>
                  <div className="spread"><span>{KIND[i.kind] ?? i.kind}{i.number ? ` · ${i.number}` : ''}</span><span className="num">{money(i.amount_cents)}</span></div>
                  <span className="muted" style={{ fontSize: 13 }}>Paid {date(i.paid_at)}{i.paid_via ? ` via ${i.paid_via}` : ''} <Status value="paid" /></span>
                </li>
              ))}
            </ul>
          ) : <p className="soft">No payments yet.</p>}
        </Panel>
      </div>

      {upgrades.length ? (
        <Panel title="Grow your plan" sub="You pay only the difference: the new setup price minus everything you have paid so far">
          <div className="grid g3">
            {upgrades.map((p) => (
              <div key={p.id} className="tile">
                <div className="label"><span>{p.name}</span></div>
                <div className="value num">{money(Math.max(0, p.setupCents! - paidTotal))}</div>
                <div className="hint">to upgrade today ({money(p.setupCents!)} − {money(paidTotal)} paid) · care {money(p.careCents!)}/mo</div>
                <div className="soft" style={{ fontSize: 14 }}>{p.summary}</div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </AgencyShell>
  );
}
