import { ActionForm } from '@/components/ActionForm';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Flash } from '@/components/ConsoleShell';
import { Panel, Chip, Status, Empty, dateTime } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { createCareRequest, proposePosts } from '@/lib/actions';
import { businessToday } from '@/lib/billing';

export const metadata = { title: 'Monthly care' };

// Where a post stands once the owner approved it (Metricool's side), in words.
const SENT: Record<string, string> = { DRAFT: 'In Metricool as a draft for the team to check', SCHEDULED: 'Booked to go out', PENDING: 'Booked to go out', PUBLISHED: 'Posted', NEEDS_TIME: 'Approved after its time: needs a new time', SKIPPED: 'Not connected yet', ERROR: 'Didn’t go out' };

const RESPONSE: Record<string, string> = { vip: '2 business days', launch: '2 business days', growth: '1 business day', premium: '4 business hours' };

export default async function AgencyCare({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; err?: string; film?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await agencyContext(slug);
  const film = sp.film === '1' && ctx.tenant.isSample;
  const tid = ctx.tenant.tenantId;
  const supabase = await db();
  const [{ data: t }, { data: reqs }, { data: content }, { data: ads }] = await Promise.all([
    supabase.from('tenants').select('plan, care_plan, stage').eq('id', tid).single(),
    supabase.from('care_requests').select('*').eq('tenant_id', tid).order('created_at', { ascending: false }),
    supabase.from('content_items').select('*').eq('tenant_id', tid).order('scheduled_for'),
    ctx.asStaff ? supabase.from('assets').select('id, title').eq('tenant_id', tid).eq('kind', 'image').neq('audience', 'internal').order('title') : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);
  const here = `/app/${slug}/care`;
  return (
    <AgencyShell ctx={ctx} title="Monthly care" film={film}>
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid g2">
        <Panel title="Ask for a change" sub={`We reply within ${RESPONSE[t?.plan ?? 'launch']}. Site down or a lead form not delivering: within 2 business hours on every plan.`}>
          <ActionForm action={createCareRequest} helix="care request" helixTitle="Request a change" className="form" resetOnOk>
            <input type="hidden" name="tenant" value={tid} />
            <input type="hidden" name="back" value={here} />
            <label className="field"><span>What do you need?</span>
              <select className="select" name="kind" defaultValue="change">
                <option value="change">A change to my site or profiles</option>
                <option value="content">A post or promotion</option>
                <option value="report">A question about my results</option>
                <option value="support">Something else</option>
              </select>
            </label>
            <label className="field"><span>Short title</span><input className="input" name="title" required minLength={3} maxLength={140} placeholder="e.g. Update Saturday office hours" /></label>
            <label className="field"><span>Details (optional)</span><textarea className="textarea" name="detail" maxLength={4000} placeholder="Anything that helps us get it right the first time" /></label>
            <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Send request</button>
          </ActionForm>
        </Panel>
        <Panel title="Your requests">
          {reqs?.length ? (
            <ul className="list">
              {reqs.map((r) => (
                <li key={r.id}>
                  <div className="spread"><b>{r.title}</b><span className="row" style={{ gap: 6 }}>{r.is_sample ? <Chip kind="sample">Sample</Chip> : null}<Status value={r.status} /></span></div>
                  <span className="muted" style={{ fontSize: 13 }}>{r.kind} · {dateTime(r.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No requests yet" />}
        </Panel>
      </div>
      <Panel title="Content calendar" sub={t?.care_plan ? 'Posts we draft for you each month. You approve each one before it goes out.' : 'Your monthly posts start with your care plan at launch.'}>
        {content?.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>When</th><th>Channel</th><th>Ad</th><th>Post</th><th>Status</th></tr></thead>
              <tbody>
                {content.map((c) => (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateTime(c.scheduled_for)}</td>
                    <td>{c.channel}{c.format === 'story' ? ' story' : ''}</td>
                    <td>{c.asset_id ? <a href={`/api/assets/${c.asset_id}`} target="_blank" rel="noreferrer"><img className="post-thumb" src={`/api/assets/${c.asset_id}`} alt="The ad" loading="lazy" /></a> : <span className="muted">—</span>}</td>
                    <td className="soft">{c.format === 'story' ? <span className="muted">Story: the ad on its own</span> : c.copy}</td>
                    <td><span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>{c.is_sample ? <Chip kind="sample">Sample</Chip> : null}<Status value={c.status} /></span>{c.mc_status && SENT[c.mc_status] ? <span className="muted" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>{SENT[c.mc_status]}{c.post_url ? <> · <a href={c.post_url} target="_blank" rel="noreferrer">View</a></> : null}</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No posts scheduled yet" />}
      </Panel>
      {ctx.asStaff ? (
        <Panel title="Plan a post (team)" sub="Pick an approved ad from the Library. Each network gets its own approval; nothing goes out until the owner approves it on Approvals.">
          {ads?.length ? (
            <ActionForm action={proposePosts} helix="post plan" helixTitle="Plan a post" className="form" resetOnOk>
              <input type="hidden" name="tenant" value={tid} />
              <input type="hidden" name="back" value={here} />
              <label className="field"><span>Ad</span>
                <select className="select" name="asset" required defaultValue="">
                  <option value="" disabled>Pick an ad from the Library</option>
                  {ads.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
                </select>
              </label>
              <div className="row" style={{ gap: 14 }}>
                <label className="row" style={{ gap: 6 }}><input type="checkbox" name="channel" value="facebook" defaultChecked /> Facebook</label>
                <label className="row" style={{ gap: 6 }}><input type="checkbox" name="channel" value="instagram" defaultChecked /> Instagram</label>
              </div>
              <label className="field"><span>Format</span>
                <select className="select" name="format" defaultValue="post">
                  <option value="post">Feed post (square ad, with caption)</option>
                  <option value="story">Story (9:16 ad, no caption)</option>
                </select>
              </label>
              <label className="field"><span>Caption (feed posts)</span><textarea className="textarea" name="copy" maxLength={2200} placeholder="Say what the approved ad says, plus the office phone and link. No savings, prices or “best” claims." /></label>
              <div className="row" style={{ gap: 10 }}>
                <label className="field"><span>Day</span><input className="input" type="date" name="day" required min={businessToday()} /></label>
                <label className="field"><span>Time (office)</span><input className="input" type="time" name="time" required defaultValue="11:30" /></label>
              </div>
              <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Send to the owner for approval</button>
            </ActionForm>
          ) : <Empty title="No ads in the Library yet">Add the agency’s approved ads to Assets first.</Empty>}
        </Panel>
      ) : null}
    </AgencyShell>
  );
}
