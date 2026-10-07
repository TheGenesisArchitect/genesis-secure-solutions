import { notFound } from 'next/navigation';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Tile, Status, PLAN_LABEL, money, date } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { PLANS } from '@/data/offers';

export const metadata = { title: 'Plan & billing' };

export default async function Billing({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  if (!ctx.isOwner) notFound();
  const supabase = await db();
  const [{ data: t }, { data: invoices }] = await Promise.all([
    supabase.from('tenants').select('plan, care_plan').eq('id', ctx.tenant.tenantId).single(),
    supabase.from('invoices').select('*').eq('tenant_id', ctx.tenant.tenantId).order('created_at'),
  ]);
  const paid = (invoices ?? []).filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount_cents, 0);
  const open = (invoices ?? []).filter((i) => i.status === 'open').reduce((s, i) => s + i.amount_cents, 0);
  const current = t?.plan ?? 'launch';
  const upgrades = PLANS.filter((p) => p.setupCents && PLANS.findIndex((x) => x.id === p.id) > PLANS.findIndex((x) => x.id === (current === 'vip' ? 'launch' : current)));
  return (
    <AgencyShell ctx={ctx} title="Plan & billing">
      {ctx.tenant.isSample ? <div className="notice sample">Sample agency: amounts are illustrative.</div> : null}
      <div className="grid g4">
        <Tile label="Your plan" value={PLAN_LABEL[current]} hint={t?.care_plan ? `Care: ${t.care_plan}` : 'Care starts at launch'} />
        <Tile label="Paid to date" value={<span className="num">{money(paid)}</span>} hint="Counts in full toward any upgrade" />
        <Tile label="Due" value={<span className="num">{money(open)}</span>} hint={open ? 'Due before your site goes live' : 'Nothing due'} />
      </div>
      <Panel title="Invoices" sub="Card payments arrive with online billing; until then your Genovus contact sends each invoice">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Invoice</th><th>Amount</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {(invoices ?? []).map((i) => (
                <tr key={i.id}><td>{i.kind}</td><td className="num">{money(i.amount_cents)}</td><td><Status value={i.status} /></td><td className="soft">{i.note ?? ''}{i.paid_at ? ` · paid ${date(i.paid_at)}` : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {upgrades.length ? (
        <Panel title="Grow your plan" sub="You pay only the difference: the new setup price minus everything you have paid so far">
          <div className="grid g3">
            {upgrades.map((p) => (
              <div key={p.id} className="tile">
                <div className="label"><span>{p.name}</span></div>
                <div className="value num">{money(Math.max(0, p.setupCents! - paid))}</div>
                <div className="hint">to upgrade today ({money(p.setupCents!)} setup − {money(paid)} paid) · care {money(p.careCents!)}/mo</div>
                <div className="soft" style={{ fontSize: 14 }}>{p.summary}</div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </AgencyShell>
  );
}
