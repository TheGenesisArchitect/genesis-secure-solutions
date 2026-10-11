import Link from 'next/link';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Tile, Chip, Bar, Empty, STAGES, STAGE_LABEL, PLAN_LABEL, dateTime, type Stage } from '@/components/ui';
import { MetricChain, type Metrics } from '@/components/MetricChain';
import { db } from '@/lib/supabase/server';
import { liveSetup } from '@/lib/live-setup';
import { PROGRAM_NAME, programOf } from '@/lib/programs';
import { accessFor } from '@/lib/access';
import { businessToday } from '@/lib/billing';
import { LINES, momentsNow } from '@/lib/lines';
import { MorningBrief } from '@/components/MorningBrief';

export const metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

const SOURCE: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google', direct: 'Direct', website: 'website', 'google-profile': 'Google profile', partner: 'partner' };

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
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [{ data: t }, { data: approvals }, { data: care }, { data: content }, { data: kpis }, live, { data: fresh }, { data: monthLeads }] = await Promise.all([
    supabase.from('tenants').select('stage, plan, care_plan').eq('id', tid).single(),
    supabase.from('approvals').select('id, title, requested_at, is_sample').eq('tenant_id', tid).eq('status', 'pending').eq('approver', 'client').order('requested_at'),
    supabase.from('care_requests').select('id, title, status').eq('tenant_id', tid).neq('status', 'done').order('created_at'),
    supabase.from('content_items').select('id, status').eq('tenant_id', tid).gte('scheduled_for', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    supabase.from('kpi_snapshots').select('period, metrics, is_sample').eq('tenant_id', tid).order('period', { ascending: false }).limit(2),
    liveSetup(slug),
    supabase.from('leads').select('id, name, topic, source, channel, created_at').eq('tenant_id', tid).eq('status', 'new').order('created_at', { ascending: false }).limit(5),
    supabase.from('leads').select('source, status, created_at, first_contact_at').eq('tenant_id', tid).gte('created_at', monthStart).limit(2000),
  ]);
  const program = programOf(t?.plan ?? ctx.tenant.plan);
  const ml = monthLeads ?? [];
  const bySource = Object.entries(ml.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.source]: (acc[l.source] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const replies = ml.filter((l) => l.first_contact_at).map((l) => (new Date(l.first_contact_at!).getTime() - new Date(l.created_at).getTime()) / 60_000).sort((a, b) => a - b);
  const median = replies.length ? replies[Math.floor(replies.length / 2)] : null;
  const { data: lead } = await supabase.rpc('my_account_lead', { p_tenant: tid });
  const contact = (lead as { name: string; email: string }[] | null)?.[0];
  const base = `/app/${slug}`;
  const next: { label: string; href: string }[] = [];
  // New leads come first: a callback is worth most in its first hour.
  for (const l of fresh ?? []) next.push({ label: l.channel === 'call' ? `Call back ${l.name.replace(/^Caller /, '')} (called your ${SOURCE[l.source] ?? l.source} line)` : `Call ${l.name}${l.topic ? ` about ${l.topic.toLowerCase()}` : ''} (${SOURCE[l.source] ?? l.source})`, href: `${base}/leads?status=new` });
  for (const a of approvals ?? []) next.push({ label: `Approve: ${a.title}`, href: `${base}/approvals` });
  // Once an agency is live, setup is finished: never ask a launched client for setup steps.
  const launched = t?.stage === 'care';
  if (!launched) {
    for (const s of live.welcome?.steps ?? []) if (!s.done) next.push({ label: s.label, href: live.welcome!.url });
    if (live.social && live.social.done < live.social.total) next.push({ label: `Finish social setup (${live.social.done} of ${live.social.total})`, href: live.social.clientUrl });
  }
  const latest = kpis?.[0];
  const sample = ctx.tenant.isSample;
  // Growth: Helix's morning brief opens the day, with one line on the market (the season for the agency's lines).
  const access = await accessFor(tid, ctx.tenant.plan);
  const showBrief = access.has('helix') && !film && !sample;
  const [{ data: brief }, { data: prof }] = showBrief
    ? await Promise.all([supabase.from('helix_briefs').select('body').eq('tenant_id', tid).eq('day', businessToday()).maybeSingle(), supabase.from('agency_profiles').select('lines').eq('tenant_id', tid).maybeSingle()])
    : [{ data: null }, { data: null }];
  const moment = momentsNow(prof?.lines)[0];
  const pulse = moment ? `Market: ${LINES[moment.line].label} ${moment.label.toLowerCase()} ${moment.starting ? 'starts next month' : 'is on now'}` : null;
  return (
    <AgencyShell ctx={ctx} title={`Welcome back`} film={film}>
      {showBrief ? <MorningBrief slug={slug} tenantId={tid} initial={(brief?.body as never) ?? null} pulse={pulse} /> : null}
      <div className="grid g4">
        <Tile label="Where you are" value={STAGE_LABEL[t?.stage as Stage] ?? '—'} hint={t?.stage === 'care' ? 'Live, with monthly care' : 'Getting you live'} />
        <Tile label="Your program" value={t?.plan ? PROGRAM_NAME[program] : PLAN_LABEL[t?.plan ?? ''] ?? '—'} hint={<Link href={`${base}/program`}>{t?.care_plan ? `Care: ${t.care_plan} · see what’s included` : 'See what’s included'}</Link>} />
        <Tile label="New leads" value={<span className="num">{(fresh?.length ?? 0) >= 5 ? '5+' : fresh?.length ?? 0}</span>} hint={fresh?.length ? 'Waiting for a first call' : `${ml.length} this month`} />
        <Tile label="Waiting on you" value={<span className="num">{approvals?.length ?? 0}</span>} hint={`Approvals only you can give${program !== 'launch' ? ` · ${content?.length ?? 0} posts this month` : ''}`} />
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
        {latest ? <MetricChain m={latest.metrics as Metrics} prev={kpis?.[1]?.metrics as Metrics | undefined} sample={latest.is_sample} /> : ml.length ? (
          <div className="grid g4">
            <Tile label="Leads this month" value={<span className="num">{ml.length}</span>} hint="From your website" />
            <Tile label="Top source" value={bySource[0] ? SOURCE[bySource[0][0]] ?? bySource[0][0] : '—'} hint={bySource[0] ? `${bySource[0][1]} of ${ml.length} leads` : ''} />
            <Tile label="Time to first call" value={median == null ? '—' : median < 60 ? `${Math.round(median)} min` : `${(median / 60).toFixed(1)} h`} hint="Median this month" />
            <Tile label="Won" value={<span className="num">{ml.filter((l) => l.status === 'won').length}</span>} hint="Marked won by your office" />
          </div>
        ) : <Empty title={launched ? 'No leads yet this month' : 'Results start after launch'}>Every callback from your website is tracked to its source here, the moment it arrives.</Empty>}
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
