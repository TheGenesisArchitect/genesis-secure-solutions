import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel, Chip, dateTime } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { ActionForm } from '@/components/ActionForm';
import { auditAcknowledgeFork } from '@/lib/actions';

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
  const { data: acks } = await supabase.from('audit_exceptions').select('leaf_id, reason, acknowledged_at').order('leaf_id');
  // Is the break a known race fork? The flagged entry is a dead end that shares its parent with a sibling written
  // within a second of it. Only then is acknowledgment offered; anything else stays a break to investigate.
  let race: { id: number; sibling: number; gapMs: number } | null = null;
  if (!intact && typeof broken === 'number' && broken > 0) {
    const { data: b } = await supabase.from('audit_events').select('id, prev_hash, hash, at').eq('id', broken).maybeSingle();
    if (b) {
      const [{ data: sibs }, { count: next }] = await Promise.all([
        supabase.from('audit_events').select('id, at').eq('prev_hash', b.prev_hash).neq('id', b.id),
        supabase.from('audit_events').select('id', { count: 'exact', head: true }).eq('prev_hash', b.hash),
      ]);
      const sib = (sibs ?? [])[0];
      const gapMs = sib ? Math.abs(new Date(sib.at).getTime() - new Date(b.at).getTime()) : Infinity;
      if (sib && (next ?? 0) === 0 && gapMs < 1000) race = { id: b.id, sibling: sib.id, gapMs };
    }
  }
  return (
    <ConsoleShell title="Audit log" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Audit log' }]}>
      <Panel
        title="Chain integrity"
        sub="Every entry carries a SHA-256 hash of itself and the entry before it, and the database refuses edits and deletes. Re-checked each time this page loads."
        actions={<Chip kind={intact ? 'done' : 'bad'}>{intact ? 'Intact' : 'Broken'}</Chip>}
      >
        <p className="soft">
          {error ? `The check could not run: ${error.message}` : intact ? `All ${count ?? 0} entries verify${acks?.length ? ` (${acks.length} acknowledged race fork${acks.length === 1 ? '' : 's'})` : ''}.` : race ? `Entry #${race.id} is a race fork: it was written ${race.gapMs} ms apart from #${race.sibling}, and both point to the same earlier entry. Its record and hash are intact; it's a dead end on the chain, not an edit or a deletion.` : `The chain breaks at entry #${broken}. Investigate before trusting later entries.`}
        </p>
        {race ? (
          <ActionForm action={auditAcknowledgeFork} className="form" style={{ maxWidth: 720 }}>
            <input type="hidden" name="id" value={race.id} />
            <label className="field"><span>Why this is a known race (recorded in the audit log)</span><input className="input" name="reason" defaultValue={`Race fork: #${race.id} and #${race.sibling} written ${race.gapMs} ms apart; ids were drawn before the chain lock (fixed 2026-10-13). Record intact.`} maxLength={500} /></label>
            <button className="btn small primary" type="submit" style={{ justifySelf: 'start' }}>Acknowledge as a known race fork</button>
            <small className="muted">Admins only. The verifier then accepts this one dead end; any other break still fails.</small>
          </ActionForm>
        ) : null}
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
