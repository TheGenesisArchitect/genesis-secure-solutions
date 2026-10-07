import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel, Chip, dateTime } from '@/components/ui';
import { db } from '@/lib/supabase/server';

export const metadata = { title: 'Audit log' };

export default async function Audit() {
  const supabase = await db();
  const [{ data: broken, error }, { data: rows }, { count }, { data: tenants }] = await Promise.all([
    supabase.rpc('verify_audit_chain'),
    supabase.from('audit_events').select('id, tenant_id, action, subject, actor_label, at, hash').order('id', { ascending: false }).limit(150),
    supabase.from('audit_events').select('id', { count: 'exact', head: true }),
    supabase.from('tenants').select('id, name'),
  ]);
  const names = new Map((tenants ?? []).map((t) => [t.id, t.name]));
  const intact = !error && broken === null;
  return (
    <ConsoleShell title="Audit log" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Audit log' }]}>
      <Panel
        title="Chain integrity"
        sub="Every entry carries a SHA-256 hash of itself and the entry before it, and the database refuses edits and deletes. Re-checked each time this page loads."
        actions={<Chip kind={intact ? 'done' : 'bad'}>{intact ? 'Intact' : 'Broken'}</Chip>}
      >
        <p className="soft">
          {error ? `The check could not run: ${error.message}` : intact ? `All ${count ?? 0} entries verify.` : `The chain breaks at entry #${broken}. Investigate before trusting later entries.`}
        </p>
      </Panel>
      <Panel title="Latest entries">
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Client</th><th>Hash</th></tr></thead>
            <tbody>
              {(rows ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="num">{e.id}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{dateTime(e.at)}</td>
                  <td>{e.actor_label}</td>
                  <td><b>{e.action}</b> <span className="muted">{e.subject}</span></td>
                  <td>{e.tenant_id ? names.get(e.tenant_id) : <span className="muted">Platform</span>}</td>
                  <td><code className="muted" style={{ font: '500 12px var(--mono)' }}>{e.hash.slice(0, 12)}…</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </ConsoleShell>
  );
}
