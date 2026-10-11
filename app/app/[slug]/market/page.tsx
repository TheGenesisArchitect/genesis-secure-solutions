// Market (Growth): the agency's strategy center, a finger on the pulse of its market. Three questions on one page:
// what does my market need right now (seasonal moments for the lines it sells), who's out there (the partner map),
// and which sources are working (leads, contact and win rates, cost per lead against the ~$50 vendors charge).
// Helix explains it and proposes the next campaign; every number links back to the work (Leads, Partners).
import Link from 'next/link';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { HelixAskButton } from '@/components/HelixDrawer';
import { SourceCostForm } from '@/components/SourceCostForm';
import { Panel, Chip, Tile } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';
import { businessToday } from '@/lib/billing';
import { LINES, lineLabels, momentsNow, type LineId } from '@/lib/lines';

export const metadata = { title: 'Market' };
export const dynamic = 'force-dynamic';

const VENDOR_CENTS = 5000; // what agents pay lead vendors for a shared lead, about $50
const NUMBER_CENTS = 115; // a tracking number, per month
const NAME: Record<string, string> = { website: 'Website', direct: 'Website (direct)', facebook: 'Facebook', instagram: 'Instagram', google: 'Google', 'google-profile': 'Google profile', partner: 'Partner referrals', mailer: 'Mailer', event: 'Event' };
const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: c < 1000 ? 2 : 0 })}`;
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

export default async function Market({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  if (!access.has('market')) return <AgencyShell ctx={ctx} title="Market"><ModuleGate ctx={ctx} moduleKey="market" /></AgencyShell>;
  const tid = ctx.tenant.tenantId;
  const supabase = await db();
  const month = businessToday().slice(0, 8) + '01';
  const [{ data: prof }, { data: leads }, { data: costs }, { data: numbers }, { data: partners }] = await Promise.all([
    supabase.from('agency_profiles').select('lines, city, state, service_radius_mi').eq('tenant_id', tid).maybeSingle(),
    supabase.from('leads').select('source, channel, status, first_contact_at').eq('tenant_id', tid).gte('created_at', `${month}T04:00:00Z`).limit(5000),
    supabase.from('source_costs').select('source, cents').eq('tenant_id', tid).eq('month', month),
    supabase.from('tracking_numbers').select('source, label').eq('tenant_id', tid).is('released_at', null),
    supabase.from('partner_targets').select('line, status').eq('tenant_id', tid).limit(5000),
  ]);
  const L = leads ?? [];
  const moments = momentsNow(prof?.lines);
  // Cost by source this month: what the agency recorded, plus Genovus-run costs (numbers on that source).
  const cost: Record<string, number> = {};
  for (const c of costs ?? []) cost[c.source] = (cost[c.source] ?? 0) + c.cents;
  for (const n of numbers ?? []) cost[n.source] = (cost[n.source] ?? 0) + NUMBER_CENTS;
  const sources = [...new Set([...L.map((l) => l.source), ...Object.keys(cost)])];
  const rows = sources.map((s) => {
    const mine = L.filter((l) => l.source === s);
    return { s, n: mine.length, calls: mine.filter((l) => l.channel === 'call').length, reached: mine.filter((l) => l.first_contact_at).length, won: mine.filter((l) => l.status === 'won').length, cost: cost[s] ?? null };
  }).sort((a, b) => b.n - a.n);
  const totalLeads = L.length;
  const totalCost = Object.values(cost).reduce((a, b) => a + b, 0);
  const vendorCost = totalLeads * VENDOR_CENTS;
  const P = partners ?? [];
  const lines = (prof?.lines ?? []) as LineId[];
  const monthName = new Date(`${month}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  return (
    <AgencyShell ctx={ctx} title="Market" actions={<HelixAskButton label="Propose a campaign" question="Based on my market this month, propose one campaign: the offer, who it's for, the partners to call, and a short post I could approve." context="the Market page" />}>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>{prof?.city ? `${prof.city}, ${prof.state} · within ${prof.service_radius_mi} miles` : 'Your market'} · {lineLabels(lines).join(', ') || 'lines not set yet'}</p>
      <div className="grid g4">
        <Tile label={`Leads in ${monthName}`} value={totalLeads} hint={`${L.filter((l) => l.channel === 'call').length} new from calls · ${L.filter((l) => l.channel === 'partner').length} from partners`} />
        <Tile label="Your cost per lead" value={totalLeads && totalCost ? money(totalCost / totalLeads) : totalLeads ? '$0' : '—'} hint="Everything you recorded, divided by leads" />
        <Tile label="Vendors would charge" value={money(vendorCost)} hint={`${totalLeads} shared leads at about $50 each`} />
        <Tile label="Saved vs vendors" value={vendorCost ? money(Math.max(0, vendorCost - totalCost)) : '—'} hint="And every one of these leads is yours alone" />
      </div>

      <Panel title="What your market needs now" sub="Seasonal moments for the lines you sell, this month and next.">
        {moments.length ? (
          <div className="moments">
            {moments.map((m, i) => (
              <article key={i} className="moment">
                <span className="row" style={{ gap: 6 }}><Chip kind={m.starting ? 'pending' : 'done'}>{m.starting ? 'Starting next month' : 'Now'}</Chip><b>{LINES[m.line].label}: {m.label}</b></span>
                <span className="muted" style={{ fontSize: 13 }}>{m.why}</span>
                <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <Link className="btn small ghost" href={`/app/${slug}/partners`}>{P.filter((p) => p.line === m.line).length} {LINES[m.line].label.toLowerCase()} partners nearby</Link>
                  <HelixAskButton label="Plan it" question={`Plan a ${LINES[m.line].label} "${m.label}" push for this month: which partners to call first, one post to approve, and who in my leads to follow up with.`} context={`Market moment: ${LINES[m.line].label} ${m.label}`} />
                </span>
              </article>
            ))}
          </div>
        ) : <p className="muted" style={{ margin: 0 }}>No seasonal moments for your lines this month: a good time for partner visits and reviews.</p>}
      </Panel>

      <Panel title="Which sources are working" sub={`${monthName} so far. Cost per lead includes your tracking numbers and anything you record below.`}>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Source</th><th className="num">Leads</th><th className="num">Calls</th><th className="num">Reached</th><th className="num">Won</th><th className="num">Cost</th><th className="num">Per lead</th><th>vs $50</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const per = r.cost != null && r.n ? r.cost / r.n : null;
                return (
                  <tr key={r.s}>
                    <td>{NAME[r.s] ?? r.s}</td><td className="num">{r.n}</td><td className="num">{r.calls}</td><td className="num">{pct(r.reached, r.n)}</td><td className="num">{r.won}</td>
                    <td className="num">{r.cost != null ? money(r.cost) : '—'}</td><td className="num">{per != null ? money(per) : r.n ? 'Free' : '—'}</td>
                    <td>{per == null ? (r.n ? <Chip kind="done">Free</Chip> : null) : per <= VENDOR_CENTS ? <Chip kind="done">{Math.round((1 - per / VENDOR_CENTS) * 100)}% less</Chip> : <Chip kind="bad">More</Chip>}</td>
                  </tr>
                );
              })}
              {!rows.length ? <tr><td colSpan={8} className="muted">No leads yet this month. Calls, website callbacks and partner referrals show up here as they arrive.</td></tr> : null}
            </tbody>
          </table>
        </div>
        <SourceCostForm tenantId={tid} sources={sources} />
      </Panel>

      <Panel title="Who’s out there" sub="Referral partners mapped near your office, by the line their customers buy.">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {lines.map((l) => {
            const mine = P.filter((p) => p.line === l);
            return <Chip key={l} kind="info">{LINES[l]?.label ?? l}: {mine.length} mapped · {mine.filter((p) => p.status === 'partner' || p.status === 'referring').length} partners</Chip>;
          })}
          <Link className="btn small" href={`/app/${slug}/partners`}>Open the Call Desk →</Link>
        </div>
      </Panel>
    </AgencyShell>
  );
}
