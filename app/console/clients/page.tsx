import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Chip, STAGE_LABEL, PLAN_LABEL, date, type Stage } from '@/components/ui';
import { db } from '@/lib/supabase/server';

export const metadata = { title: 'Clients' };

export default async function Clients({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  const q = sp.q?.trim().slice(0, 80) ?? '';
  const page = Math.max(1, Number(sp.page) || 1);
  const size = 50;
  const supabase = await db();
  let query = supabase.from('tenants').select('id, slug, name, kind, stage, plan, care_plan, is_sample, created_at', { count: 'exact' }).order('is_sample').order('name').range((page - 1) * size, page * size - 1);
  if (q) query = query.ilike('name', `%${q.replace(/[%_]/g, '')}%`);
  const { data, count } = await query;
  const pages = Math.max(1, Math.ceil((count ?? 0) / size));
  const rows = data ?? [];
  return (
    <ConsoleShell title="Clients" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Clients' }]}>
      <p className="soft">Every tenant, each isolated in the database. Sample agencies power the demo and network views and are never counted as revenue.</p>
      <form className="row" role="search">
        <input className="input" name="q" defaultValue={q} placeholder="Search clients" aria-label="Search clients" style={{ flex: 1, minWidth: 200 }} />
        <button className="btn" type="submit">Search</button>
        <span className="muted" style={{ fontSize: 13 }}>{count ?? 0} client{count === 1 ? '' : 's'}</span>
      </form>
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
      {pages > 1 ? (
        <div className="row">
          {page > 1 ? <Link className="btn small" href={`/console/clients?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>Previous</Link> : null}
          <span className="muted" style={{ fontSize: 13 }}>Page {page} of {pages}</span>
          {page < pages ? <Link className="btn small" href={`/console/clients?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}>Next</Link> : null}
        </div>
      ) : null}
    </ConsoleShell>
  );
}
