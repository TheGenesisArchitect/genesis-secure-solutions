// Genovus's own campaigns (the house account). Each campaign has a code that goes into every outbound link,
// so inquiries are credited to the campaign, channel and landing page they came from.
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { Panel, Chip, Empty, Tile, money } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { saveCampaign } from '@/lib/actions';

export const metadata = { title: 'Campaigns' };
export const dynamic = 'force-dynamic';

const SEG_PATH: Record<string, string> = { 'captive-agents': '/for/captive-agents', 'independent-agencies': '/for/independent-agencies', carriers: '/for/carriers', mixed: '/' };
const CHANNELS = ['calls', 'email', 'social', 'ads', 'mail', 'referral', 'events', 'other'];

export default async function Campaigns() {
  await requireStaff();
  const supabase = await db();
  const [{ data: campaigns }, { data: inq }] = await Promise.all([
    supabase.from('campaigns').select('*').order('created_at', { ascending: false }),
    supabase.from('inquiries').select('campaign_id, status').not('campaign_id', 'is', null),
  ]);
  const origin = process.env.APP_ORIGIN || 'https://genovus.io';
  const byCampaign = new Map<string, { total: number; converted: number }>();
  for (const i of inq ?? []) {
    const e = byCampaign.get(i.campaign_id!) ?? { total: 0, converted: 0 };
    e.total++;
    if (i.status === 'converted') e.converted++;
    byCampaign.set(i.campaign_id!, e);
  }
  const all = campaigns ?? [];
  const budget = all.reduce((s, c) => s + (c.budget_cents ?? 0), 0);
  return (
    <ConsoleShell title="Campaigns" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Campaigns' }]}>
      <p className="soft">Genovus is its own first client. Every campaign link carries its code, so each inquiry is credited to the campaign, channel and page it came from.</p>
      <div className="grid g4">
        <Tile label="Campaigns live" value={<span className="num">{all.filter((c) => c.status === 'live').length}</span>} hint={`${all.length} in total`} />
        <Tile label="Inquiries credited" value={<span className="num">{inq?.length ?? 0}</span>} hint="From tracked links" />
        <Tile label="Converted" value={<span className="num">{(inq ?? []).filter((i) => i.status === 'converted').length}</span>} hint="Became clients in Consult" />
        <Tile label="Budget planned" value={money(budget)} hint="Across all campaigns" />
      </div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <Panel title="Your campaigns" sub="Copy the tracked link; add &p=<prospect code> to credit one office">
          {all.length ? (
            <ul className="list">
              {all.map((c) => {
                const stats = byCampaign.get(c.id) ?? { total: 0, converted: 0 };
                const link = `${origin}${SEG_PATH[c.segment] ?? '/'}?c=${c.slug}&src=${c.channel}${c.carrier_hint ? `&carrier=${c.carrier_hint}` : ''}`;
                return (
                  <li key={c.id} style={{ gap: 6 }}>
                    <div className="spread"><b>{c.name}</b><Chip kind={c.status === 'live' ? 'live' : c.status === 'draft' ? 'pending' : 'info'}>{c.status}</Chip></div>
                    <span className="muted" style={{ fontSize: 13 }}>{c.channel} · {c.segment}{c.budget_cents ? ` · budget ${money(c.budget_cents)}` : ''} · {stats.total} inquiries, {stats.converted} converted</span>
                    <code style={{ fontSize: 12, overflowWrap: 'anywhere', userSelect: 'all' }}>{link}</code>
                  </li>
                );
              })}
            </ul>
          ) : <Empty title="No campaigns yet">Create the first one, for example a GA and AL captive-agent call campaign.</Empty>}
        </Panel>
        <Panel title="New or update a campaign" sub="Saving an existing code updates it">
          <ActionForm action={saveCampaign} className="form" resetOnOk>
            <label className="field"><span>Code (used in links)</span><input className="input" name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,40}" placeholder="ga-al-captive-calls" /></label>
            <label className="field"><span>Name</span><input className="input" name="name" required maxLength={120} placeholder="GA and AL captive agents: calls" /></label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <label className="field" style={{ flex: 1 }}><span>Channel</span>
                <select className="select" name="channel">{CHANNELS.map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="field" style={{ flex: 1 }}><span>Audience</span>
                <select className="select" name="segment">
                  <option value="captive-agents">Captive / exclusive agents</option><option value="independent-agencies">Independent agencies</option>
                  <option value="carriers">Carriers and networks</option><option value="mixed">Mixed</option>
                </select></label>
            </div>
            <label className="field"><span>Carrier (optional, catalog code)</span><input className="input" name="carrier" maxLength={40} placeholder="state-farm" /></label>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <label className="field" style={{ flex: 1 }}><span>Starts</span><input className="input" type="date" name="starts" /></label>
              <label className="field" style={{ flex: 1 }}><span>Ends</span><input className="input" type="date" name="ends" /></label>
              <label className="field" style={{ flex: 1 }}><span>Budget (USD)</span><input className="input" name="budget" inputMode="decimal" placeholder="500" /></label>
            </div>
            <label className="field"><span>Status</span><select className="select" name="status"><option value="draft">Draft</option><option value="live">Live</option><option value="paused">Paused</option><option value="done">Done</option></select></label>
            <label className="field"><span>Notes</span><textarea className="textarea" name="notes" maxLength={1000} /></label>
            <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Save campaign</button>
          </ActionForm>
        </Panel>
      </div>
    </ConsoleShell>
  );
}
