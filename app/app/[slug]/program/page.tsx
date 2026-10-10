// Your program: what the agency's program (Launch, Growth or Premium) includes and where it lives, what is coming
// to it, and what the next program adds. Asking about an upgrade goes to the Genovus team as a care request.
import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Chip } from '@/components/ui';
import { createCareRequest } from '@/lib/actions';
import { MODULES, PROGRAM_NAME, RANK, REPLY_TIME, includes, programOf, type ProgramId } from '@/lib/programs';
import { PLANS } from '@/data/offers';
import { accessFor } from '@/lib/access';

export const metadata = { title: 'Your program' };
export const dynamic = 'force-dynamic';

const money = (c: number | null) => (c == null ? '' : `$${(c / 100).toLocaleString('en-US')}`);

export default async function Program({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  const program = access.program;
  const plan = PLANS.find((p) => p.id === program)!;
  const mine = MODULES.filter((m) => access.keys.has(m.key));
  const trialEnds = (k: string) => (!includes(program, MODULES.find((m) => m.key === k)!) ? access.grants.get(k) : undefined);
  const next = (['growth', 'premium'] as ProgramId[]).filter((p) => RANK[p] > RANK[program]);
  const base = `/app/${slug}`;
  return (
    <AgencyShell ctx={ctx} title="Your program">
      <Panel title={`${PROGRAM_NAME[program]} program${access.trial ? ` · Growth trial, ${access.trial.days} days left` : ''}`} sub={plan.summary} actions={<Chip kind="done">Active</Chip>}>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Monthly care: {plan.careName} · we reply to requests within {REPLY_TIME[program]}; site down or a lead form not delivering, within 2 business hours.</p>
        <ul className="prog-list">
          {mine.map((m) => (
            <li key={m.key}>
              <div className="spread" style={{ gap: 8 }}>
                <b>{m.label}</b>
                <span className="row" style={{ gap: 6 }}>{trialEnds(m.key) !== undefined ? <Chip kind="info">{trialEnds(m.key) ? `Trial to ${new Date(trialEnds(m.key)!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : 'Included for you'}</Chip> : null}{m.live ? (m.path !== undefined ? <Link className="btn small" href={`${base}${m.path}`}>Open</Link> : <Chip kind="done">On</Chip>) : <Chip kind="pending">Coming to your plan</Chip>}</span>
              </div>
              <span className="muted" style={{ fontSize: 13 }}>{m.blurb}</span>
            </li>
          ))}
        </ul>
      </Panel>
      {next.map((p) => {
        const offer = PLANS.find((x) => x.id === p)!;
        const adds = MODULES.filter((m) => m.tier === p && !access.keys.has(m.key));
        if (!adds.length) return null;
        return (
          <Panel key={p} title={`What ${PROGRAM_NAME[p]} adds`} sub={`${offer.summary} ${money(offer.setupCents)} setup, then ${money(offer.careCents)} a month (${offer.careName}).`}>
            <ul className="prog-list">
              {adds.map((m) => <li key={m.key}><div className="spread" style={{ gap: 8 }}><b>{m.label}</b>{m.live ? null : <Chip kind="pending">Coming</Chip>}</div><span className="muted" style={{ fontSize: 13 }}>{m.blurb}</span></li>)}
            </ul>
            {ctx.isOwner ? (
              <ActionForm action={createCareRequest} className="row" style={{ gap: 8 }}>
                <input type="hidden" name="tenant" value={ctx.tenant.tenantId} />
                <input type="hidden" name="back" value={`${base}/program`} />
                <input type="hidden" name="kind" value="support" />
                <input type="hidden" name="title" value={`Upgrade question: ${PROGRAM_NAME[p]}`} />
                <input type="hidden" name="detail" value={`${ctx.tenant.name} would like to talk about moving to ${PROGRAM_NAME[p]}.`} />
                <button className="btn small primary" type="submit">Ask about {PROGRAM_NAME[p]}</button>
                <span className="muted" style={{ fontSize: 12 }}>Goes to the Genovus team; your current program keeps running.</span>
              </ActionForm>
            ) : null}
          </Panel>
        );
      })}
    </AgencyShell>
  );
}
