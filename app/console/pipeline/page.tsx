import Link from 'next/link';
import { ConsoleShell, Flash } from '@/components/ConsoleShell';
import { Chip, STAGES, STAGE_LABEL, PLAN_LABEL, daysSince, type Stage } from '@/components/ui';
import { db } from '@/lib/supabase/server';

export const metadata = { title: 'Pipeline' };

/** What a person should do next for a client, from its open gates and approvals. */
function nextAction(stage: Stage, openGates: number, pending: number): string {
  if (pending) return `${pending} approval${pending > 1 ? 's' : ''} waiting`;
  switch (stage) {
    case 'attract': return 'Book the consult';
    case 'consult': return 'Recommend a plan';
    case 'propose': return 'Get the proposal signed';
    case 'deposit': return 'Collect the deposit';
    case 'intake': return openGates ? `${openGates} gate${openGates > 1 ? 's' : ''} to clear` : 'Start the build';
    case 'build': return 'Team review of the draft';
    case 'review': return 'Client and carrier sign-off';
    case 'care': return 'Monthly care';
  }
}

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ samples?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const samples = sp.samples === '1';
  const supabase = await db();
  let tq = supabase.from('tenants').select('id, slug, name, stage, stage_since, plan, is_sample').eq('kind', 'agency').order('stage_since');
  if (!samples) tq = tq.eq('is_sample', false);
  const [tenants, gates, approvals] = await Promise.all([
    tq,
    supabase.from('gates').select('tenant_id, status'),
    supabase.from('approvals').select('tenant_id').eq('status', 'pending'),
  ]);
  const ts = tenants.data ?? [];
  return (
    <ConsoleShell
      title="Pipeline"
      crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Pipeline' }]}
      actions={<Link className="btn small" href={samples ? '/console/pipeline' : '/console/pipeline?samples=1'}>{samples ? 'Hide samples' : 'Include samples'}</Link>}
    >
      <Flash ok={sp.ok} err={sp.err} />
      <p className="soft">Stages 1 to 4 sell the work; 5 to 8 deliver it from one record. Move a client from its page, and the change is logged.</p>
      <div className="board" role="list">
        {STAGES.map((s) => {
          const inStage = ts.filter((t) => t.stage === s);
          return (
            <section className="lane" key={s} role="listitem" aria-label={STAGE_LABEL[s]}>
              <header>
                <span>{STAGE_LABEL[s]}</span>
                <span className="num">{inStage.length}</span>
              </header>
              {inStage.map((t) => {
                const open = (gates.data ?? []).filter((g) => g.tenant_id === t.id && (g.status === 'open' || g.status === 'blocked')).length;
                const pending = (approvals.data ?? []).filter((a) => a.tenant_id === t.id).length;
                const d = daysSince(t.stage_since);
                return (
                  <Link className="card" key={t.id} href={`/console/clients/${t.slug}`}>
                    <div className="spread" style={{ flexWrap: 'nowrap' }}>
                      <b>{t.name}</b>
                      {t.is_sample ? <Chip kind="sample">Sample</Chip> : null}
                    </div>
                    <small>{t.plan ? PLAN_LABEL[t.plan] : 'Plan not set'} · {d} day{d === 1 ? '' : 's'} in stage</small>
                    <small style={{ color: pending ? 'var(--warn)' : 'var(--soft)' }}>{nextAction(s, open, pending)}</small>
                  </Link>
                );
              })}
            </section>
          );
        })}
      </div>
    </ConsoleShell>
  );
}
