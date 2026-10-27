// What each client is waiting on, from what Genovus holds: the stage, the launch checks, the deposit, the intake
// checklist and how long they've been in the stage. The same words on the pipeline board, the client page and in
// Helix's brief. Deterministic; no guessing.
import type { SupabaseClient } from '@supabase/supabase-js';
import { checklistStatus } from './checklist';
// The launch checks' names (as components/ui GATE_LABEL; kept here so servers and scripts can read it without React).
const GATE_LABEL: Record<string, string> = { photo_rights: 'Photo rights', carrier_approval: 'Carrier approval', carrier_rules: 'Carrier rules attestation', meta_access: 'Meta partner access', domain: 'Domain', privacy_notice: 'Privacy notice', kickoff: 'Kickoff call' };

export type Blockers = { tenantId: string; stage: string; days: number; items: string[] };
const DAY = 86_400_000;

export async function blockersFor(db: SupabaseClient, tenantIds?: string[]): Promise<Map<string, Blockers>> {
  let tq = db.from('tenants').select('id, name, stage, stage_since, proposal_sent_at, checklist_done_at').eq('kind', 'agency').eq('is_sample', false).neq('stage', 'care');
  if (tenantIds) tq = tq.in('id', tenantIds);
  const { data: ts } = await tq;
  const ids = (ts ?? []).map((t) => t.id as string);
  if (!ids.length) return new Map();
  const [gates, invs, recs] = await Promise.all([
    db.from('gates').select('tenant_id, kind, status').in('tenant_id', ids),
    db.from('invoices').select('tenant_id, kind, status, created_at').in('tenant_id', ids).eq('kind', 'deposit'),
    db.from('agent_records').select('tenant_id, data').in('tenant_id', ids).eq('is_current', true),
  ]);
  const out = new Map<string, Blockers>();
  for (const t of ts ?? []) {
    const id = t.id as string, stage = t.stage as string;
    const days = Math.floor((Date.now() - Date.parse(t.stage_since as string)) / DAY);
    const G = (gates.data ?? []).filter((g) => g.tenant_id === id);
    const open = (k: string) => G.some((g) => g.kind === k && !['cleared', 'waived'].includes(g.status as string));
    const dep = (invs.data ?? []).filter((i) => i.tenant_id === id);
    const rec = ((recs.data ?? []).find((r) => r.tenant_id === id)?.data ?? {}) as Record<string, unknown>;
    const items: string[] = [];
    if (stage === 'consult' || stage === 'propose') items.push(t.proposal_sent_at ? 'Waiting on the client to open the proposal' : dep.length ? 'Send the proposal and deposit (drafted, waiting on your tap)' : 'Draft the proposal and deposit');
    if (stage === 'deposit') items.push(dep.some((i) => i.status === 'open') ? `Deposit not paid yet (sent ${Math.max(0, days)} day${days === 1 ? '' : 's'} ago)` : 'Deposit invoice not sent');
    if (stage === 'intake') {
      const c = checklistStatus(rec);
      if (!c.done) items.push(`Client checklist: ${c.missing.map((m) => m.label.replace(/^Your /, '').replace(/ \(.*\)$/, '')).join(', ')}`);
      for (const k of ['photo_rights', 'kickoff']) if (open(k)) items.push(`${GATE_LABEL[k]} not cleared`);
    }
    if (stage === 'build') items.push('Site in build: mark it ready for review when the preview is done');
    if (stage === 'review') for (const k of ['carrier_approval', 'carrier_rules', 'domain', 'privacy_notice', 'meta_access']) if (open(k)) items.push(`${GATE_LABEL[k]} waiting`);
    if (days >= 7 && items.length) items.push(`${days} days in ${stage}`);
    out.set(id, { tenantId: id, stage, days, items });
  }
  return out;
}
