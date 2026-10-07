import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Chip, STAGE_LABEL, PLAN_LABEL, date, type Stage } from '@/components/ui';
import { db } from '@/lib/supabase/server';

export const metadata = { title: 'Clients' };

export default async function Clients() {
  const supabase = await db();
  const { data } = await supabase.from('tenants').select('id, slug, name, kind, stage, plan, care_plan, is_sample, created_at').order('is_sample').order('name');
  const rows = data ?? [];
  return (
    <ConsoleShell title="Clients" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Clients' }]}>
      <p className="soft">Every tenant, each isolated in the database. Sample agencies power the demo and network views and are never counted as revenue.</p>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Client</th><th>Stage</th><th>Plan</th><th>Care</th><th>Since</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <Link href={`/console/clients/${t.slug}`}>{t.name}</Link>{' '}
                  {t.is_sample ? <Chip kind="sample">Sample</Chip> : null} {t.kind === 'internal' ? <Chip>Internal</Chip> : null}
                </td>
                <td>{STAGE_LABEL[t.stage as Stage]}</td>
                <td>{t.plan ? PLAN_LABEL[t.plan] : '—'}</td>
                <td>{t.care_plan ?? '—'}</td>
                <td>{date(t.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ConsoleShell>
  );
}
