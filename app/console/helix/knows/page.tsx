// What Helix knows: the memory behind "Helix Knows". Everything the team kept from a conversation or told Helix
// directly, by department. Helix reads the kept ones every time it answers; retired ones stay for the record.
import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel, Empty } from '@/components/ui';
import { HelixTabs } from '@/components/HelixTabs';
import { MemoryItem, TeachHelix } from '@/components/HelixMemory';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { DEPARTMENTS } from '@/lib/helix-enterprise';
import { HOUSE_SLUG } from '@/lib/phone-line';

export const metadata = { title: 'What Helix knows' };
export const dynamic = 'force-dynamic';

export default async function HelixKnows() {
  await requireStaff();
  const supabase = await db();
  const { data: house } = await supabase.from('tenants').select('id').eq('slug', HOUSE_SLUG).maybeSingle();
  const { data } = house ? await supabase.from('helix_memory').select('id, department, kind, text, source, status, created_at, last_used_at').eq('tenant_id', house.id).order('created_at', { ascending: false }).limit(300) : { data: [] };
  const all = data ?? [];
  const kept = all.filter((m) => m.status === 'kept');
  const retired = all.filter((m) => m.status === 'retired');
  return (
    <ConsoleShell title="What Helix knows" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/helix/ask', label: 'Ask Helix' }, { label: 'What Helix knows' }]}>
      <HelixTabs current="knows" />
      <p className="soft" style={{ margin: 0 }}>Helix Knows: the copilot that knows Genovus better over time. When a conversation turns up something worth keeping, Helix asks “Remember this?” and a person keeps it. Nothing is remembered silently.</p>
      <div className="grid g2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
        <div style={{ display: 'grid', gap: 16 }}>
          {kept.length ? DEPARTMENTS.map(([k, label]) => {
            const items = kept.filter((m) => m.department === k);
            return items.length ? <Panel key={k} title={label} sub={`${items.length} kept`}><ul className="memory-list">{items.map((m) => <MemoryItem key={m.id} m={m} />)}</ul></Panel> : null;
          }) : <Panel title="Nothing kept yet"><Empty title="Helix is ready to learn">Ask Helix about the business and keep what it suggests, or teach it something directly.</Empty></Panel>}
          {retired.length ? (
            <Panel title="Retired" sub="No longer used in answers; kept for the record">
              <ul className="memory-list">{retired.map((m) => <MemoryItem key={m.id} m={m} />)}</ul>
            </Panel>
          ) : null}
        </div>
        <Panel title="Teach Helix" sub="Goals, how we like things done, what worked">
          <TeachHelix departments={DEPARTMENTS} />
        </Panel>
      </div>
    </ConsoleShell>
  );
}
