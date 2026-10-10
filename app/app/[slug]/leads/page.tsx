// Leads: every callback from the agency's own website, tagged with where the visitor came from (Facebook, Google,
// a post, direct), with the consent they gave. Call or email in one tap, mark it contacted, booked, won or lost,
// and put a follow-up on the calendar. New leads stay on top until someone reaches out.
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Chip, Empty, Tile } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { businessToday } from '@/lib/billing';
import { addFollowUp, updateLead } from '@/lib/actions';

export const metadata = { title: 'Leads' };
export const dynamic = 'force-dynamic';

type Lead = { id: string; name: string; email: string | null; phone: string | null; topic: string | null; message: string | null; source: string; medium: string | null; campaign: string | null; consent_text: string; status: string; first_contact_at: string | null; note: string | null; created_at: string };

const STATUS = [['new', 'New'], ['contacted', 'Contacted'], ['booked', 'Booked'], ['won', 'Won'], ['lost', 'Lost']] as const;
const STATUS_KIND: Record<string, string> = { new: 'pending', contacted: 'info', booked: 'info', won: 'done', lost: '' };
const SOURCE: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google', direct: 'Direct', email: 'Email', tiktok: 'TikTok', youtube: 'YouTube' };
const sourceLabel = (s: string) => SOURCE[s] ?? s;
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
};
const tomorrowOf = (d: string) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };

export default async function Leads({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const filter = (await searchParams).status;
  const supabase = await db();
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [{ data: rows }, { data: month }] = await Promise.all([
    (() => { let q = supabase.from('leads').select('id, name, email, phone, topic, message, source, medium, campaign, consent_text, status, first_contact_at, note, created_at').eq('tenant_id', ctx.tenant.tenantId); if (filter && STATUS.some(([k]) => k === filter)) q = q.eq('status', filter); return q.order('created_at', { ascending: false }).limit(200); })(),
    supabase.from('leads').select('source, status, created_at, first_contact_at').eq('tenant_id', ctx.tenant.tenantId).gte('created_at', since).limit(2000),
  ]);
  const leads = (rows ?? []) as Lead[];
  const m = (month ?? []) as Pick<Lead, 'source' | 'status' | 'created_at' | 'first_contact_at'>[];
  const fresh = m.filter((l) => l.status === 'new').length;
  const bySource = Object.entries(m.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.source]: (acc[l.source] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const replies = m.filter((l) => l.first_contact_at).map((l) => (new Date(l.first_contact_at!).getTime() - new Date(l.created_at).getTime()) / 60_000).sort((a, b) => a - b);
  const median = replies.length ? replies[Math.floor(replies.length / 2)] : null;
  const won = m.filter((l) => l.status === 'won').length;
  const today = businessToday();
  const base = `/app/${slug}/leads`;
  return (
    <AgencyShell ctx={ctx} title="Leads">
      <div className="grid g4">
        <Tile label="Waiting for a first call" value={<span className="num">{fresh}</span>} hint={fresh ? 'Reach out while it’s fresh' : 'Everyone has been contacted'} />
        <Tile label="Leads, last 30 days" value={<span className="num">{m.length}</span>} hint={bySource[0] ? `Most from ${sourceLabel(bySource[0][0])}` : 'From your website'} />
        <Tile label="Time to first call" value={median == null ? '—' : median < 60 ? `${Math.round(median)} min` : `${(median / 60).toFixed(1)} h`} hint="Median, last 30 days" />
        <Tile label="Won, last 30 days" value={<span className="num">{won}</span>} hint="Marked won by your office" />
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Link className={'chip lead-filter' + (!filter ? ' info' : '')} href={base}>All</Link>
        {STATUS.map(([k, label]) => <Link key={k} className={'chip lead-filter' + (filter === k ? ' info' : '')} href={`${base}?status=${k}`}>{label}</Link>)}
      </div>
      <Panel title={filter ? `${STATUS.find(([k]) => k === filter)?.[1] ?? 'All'} leads` : 'All leads'} sub="Newest first. Call or email in one tap, then mark what happened. Nothing is sent to a lead from here.">
        {leads.length ? (
          <ul className="lead-list">
            {leads.map((l) => (
              <li key={l.id} className="lead" data-status={l.status}>
                <div className="spread" style={{ flexWrap: 'wrap', gap: 6 }}>
                  <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 16 }}>{l.name}</b>
                    <Chip kind={STATUS_KIND[l.status]}>{STATUS.find(([k]) => k === l.status)?.[1] ?? l.status}</Chip>
                    <Chip kind="info">{sourceLabel(l.source)}{l.campaign ? ` · ${l.campaign}` : ''}</Chip>
                  </span>
                  <span className="muted" style={{ fontSize: 13 }}>{ago(l.created_at)}</span>
                </div>
                {l.topic ? <span style={{ fontWeight: 600 }}>{l.topic}</span> : null}
                {l.message ? <p className="soft" style={{ margin: 0, fontSize: 14 }}>{l.message}</p> : null}
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {l.phone ? <a className="btn small primary" href={`tel:${l.phone.replace(/[^\d+]/g, '')}`}>Call {l.phone}</a> : null}
                  {l.email ? <a className="btn small" href={`mailto:${l.email}`}>{l.email}</a> : null}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {STATUS.filter(([k]) => k !== l.status && k !== 'new').map(([k, label]) => (
                    <ActionForm key={k} action={updateLead}><input type="hidden" name="id" value={l.id} /><input type="hidden" name="status" value={k} /><button className="btn small ghost" type="submit">{label}</button></ActionForm>
                  ))}
                  <ActionForm action={addFollowUp}>
                    <input type="hidden" name="tenant" value={ctx.tenant.tenantId} /><input type="hidden" name="who" value={l.name} /><input type="hidden" name="reason" value={l.topic ? `Lead: ${l.topic}` : 'Lead from the website'} /><input type="hidden" name="due" value={tomorrowOf(today)} /><input type="hidden" name="at" value="09:30" />
                    <button className="btn small ghost" type="submit">Follow up tomorrow</button>
                  </ActionForm>
                </div>
                {l.note ? <span className="muted" style={{ fontSize: 13 }}>Note: {l.note}</span> : null}
                <span className="muted" style={{ fontSize: 11.5 }}>Consent: “{l.consent_text}”</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title={filter ? 'No leads with this status' : 'No leads yet'}>When someone asks for a callback on your website, it lands here within seconds, tagged with where they found you. You’ll still get the email too.</Empty>
        )}
      </Panel>
      {bySource.length ? (
        <Panel title="Where your leads come from" sub="Last 30 days, by the source of the visit">
          <div className="grid g4">{bySource.map(([s, n]) => <Tile key={s} label={sourceLabel(s)} value={<span className="num">{n}</span>} hint={`${Math.round((n / m.length) * 100)}% of leads`} />)}</div>
        </Panel>
      ) : null}
    </AgencyShell>
  );
}
