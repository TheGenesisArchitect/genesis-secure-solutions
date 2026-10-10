import Link from 'next/link';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Tile, Chip, Bar, Empty, STAGES, STAGE_LABEL, PLAN_LABEL, dateTime, type Stage } from '@/components/ui';
import { MetricChain, type Metrics } from '@/components/MetricChain';
import { db } from '@/lib/supabase/server';
import { liveSetup } from '@/lib/live-setup';

export const metadata = { title: 'Home' };

const STAGE_HELP: Record<Stage, string> = {
  attract: 'You found us.', consult: 'A short call about your office and goals.', propose: 'Your plan and price, in writing.', deposit: '70% to start; your welcome package follows right away.',
  intake: 'Your welcome guide: portrait, draft review, social setup, domain, kickoff.', build: 'We build your site, copy and profiles from your record.',
  review: 'You (and your carrier) approve before anything goes live.', care: 'Live: monthly posts, results and one improvement a month.',
};


export default async function AgencyHome({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ film?: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const film = (await searchParams).film === '1' && ctx.tenant.isSample;
  const tid = ctx.tenant.tenantId;
  const supabase = await db();
  const [{ data: t }, { data: approvals }, { data: care }, { data: content }, { data: kpis }, live] = await Promise.all([
    supabase.from('tenants').select('stage, plan, care_plan').eq('id', tid).single(),
    supabase.from('approvals').select('id, title, requested_at, is_sample').eq('tenant_id', tid).eq('status', 'pending').eq('approver', 'client').order('requested_at'),
    supabase.from('care_requests').select('id, title, status').eq('tenant_id', tid).neq('status', 'done').order('created_at'),
    supabase.from('content_items').select('id, status').eq('tenant_id', tid).gte('scheduled_for', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    supabase.from('kpi_snapshots').select('period, metrics, is_sample').eq('tenant_id', tid).order('period', { ascending: false }).limit(2),
    liveSetup(slug),
  ]);
  const { data: lead } = await supabase.rpc('my_account_lead', { p_tenant: tid });
  const contact = (lead as { name: string; email: string }[] | null)?.[0];
  const base = `/app/${slug}`;
  const next: { label: string; href: string }[] = [];
  for (const a of approvals ?? []) next.push({ label: `Approve: ${a.title}`, href: `${base}/approvals` });
  // Once an agency is live, setup is finished: never ask a launched client for setup steps.
  const launched = t?.stage === 'care';
  if (!launched) {
    for (const s of live.welcome?.steps ?? []) if (!s.done) next.push({ label: s.label, href: live.welcome!.url });
    if (live.social && live.social.done < live.social.total) next.push({ label: `Finish social setup (${live.social.done} of ${live.social.total})`, href: live.social.clientUrl });
  }
  const latest = kpis?.[0];
  const sample = ctx.tenant.isSample;
  return (
    <AgencyShell ctx={ctx} title={`Welcome back`} film={film}>
      <div className="grid g4">
        <Tile label="Where you are" value={STAGE_LABEL[t?.stage as Stage] ?? '—'} hint={t?.stage === 'care' ? 'Live, with monthly care' : 'Getting you live'} />
        <Tile label="Your plan" value={t?.plan ? PLAN_LABEL[t.plan] : '—'} hint={t?.care_plan ? `Care: ${t.care_plan}` : 'Care starts at launch'} />
        <Tile label="Waiting on you" value={<span className="num">{approvals?.length ?? 0}</span>} hint="Approvals only you can give" />
        <Tile label="Posts this month" value={<span className="num">{content?.length ?? 0}</span>} hint="Drafted, approved or published" sample={sample && !!content?.length} />
      </div>
      {!launched ? (
        <Panel title="Here’s what happens next" sub={contact ? `Your Genovus contact: ${contact.name} · ${contact.email}` : 'Your Genovus team guides every step'}>
          <ol className="lifecycle">
            {STAGES.map((s) => {
              const ix = STAGES.indexOf(s), cur = STAGES.indexOf((t?.stage ?? 'attract') as Stage);
              return <li key={s} className={ix < cur ? 'auto' : ''} style={ix === cur ? { borderColor: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)' } : undefined} aria-current={ix === cur ? 'step' : undefined}><b>{STAGE_LABEL[s]}{ix === cur ? ' · you are here' : ''}</b><span>{STAGE_HELP[s]}</span></li>;
            })}
          </ol>
        </Panel>
      ) : null}
      <div className="grid g2">
        <Panel title="Your next steps" sub={launched ? 'What needs you next' : 'The shortest path to live, in order'}>
          {next.length ? (
            <ol className="steps">
              {next.slice(0, 3).map((n, i) => (
                <li key={i}><span className="dot">{i + 1}</span><span>{n.label}</span><Link className="btn small" href={n.href}>Go</Link></li>
              ))}
            </ol>
          ) : <Empty title="You’re all caught up">We will let you know when something needs you.</Empty>}
        </Panel>
        <Panel title="Setup" sub="Updates live as you and our team finish each step" actions={<Link className="btn small" href={`${base}/setup`}>Details</Link>}>
          {launched ? <p className="soft">Setup is complete and you are live. Changes now go through monthly care.</p> : null}
          {!launched && live.welcome ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <div className="spread"><span>Welcome guide</span><span className="muted num">{live.welcome.done}/{live.welcome.total}</span></div>
              <Bar value={live.welcome.done} total={live.welcome.total} done={live.welcome.done === live.welcome.total} />
            </div>
          ) : null}
          {!launched && live.social ? (
            <div style={{ display: 'grid', gap: 6 }}>
              <div className="spread"><span>Social profiles</span><span className="muted num">{live.social.done}/{live.social.total}</span></div>
              <Bar value={live.social.done} total={live.social.total} done={live.social.done === live.social.total} />
            </div>
          ) : null}
          {!launched && !live.welcome && !live.social ? <p className="soft">Your setup guide appears here once your deposit clears.</p> : null}
        </Panel>
      </div>
      <Panel title="This month’s results" sub={latest ? `Month of ${new Date(latest.period + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}` : undefined} actions={<Link className="btn small" href={`${base}/performance`}>Performance</Link>}>
        {latest ? <MetricChain m={latest.metrics as Metrics} prev={kpis?.[1]?.metrics as Metrics | undefined} sample={latest.is_sample} /> : <Empty title="Results start after launch">Once you are live, every visit, call and callback is tracked to its source here.</Empty>}
      </Panel>
      <Panel title="Monthly care" sub="Ask for a change any time; we reply within your plan’s response time" actions={<Link className="btn small primary" href={`${base}/care`}>Request a change</Link>}>
        {care?.length ? (
          <ul className="list">{care.map((c) => <li key={c.id}><div className="spread"><span>{c.title}</span><Chip kind={c.status}>{c.status.replace('_', ' ')}</Chip></div></li>)}</ul>
        ) : <p className="soft">No open requests.</p>}
      </Panel>
      {approvals?.length ? (
        <p className="muted" style={{ fontSize: 13 }}>Oldest approval waiting since {dateTime(approvals[0].requested_at)}.</p>
      ) : null}
    </AgencyShell>
  );
}
