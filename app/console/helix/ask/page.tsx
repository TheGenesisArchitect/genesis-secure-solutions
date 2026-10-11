// Ask Helix, full view: the long conversation with Enterprise Helix (Helix Knows), the copilot that knows the
// Genovus business better over time. The drawer on every console page is the short version of this.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel } from '@/components/ui';
import { HelixTabs } from '@/components/HelixTabs';
import { AskHelixEnterprise } from '@/components/EnterpriseHelix';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { canSeeMoney } from '@/lib/helix-enterprise';
import { HOUSE_SLUG } from '@/lib/phone-line';

export const metadata = { title: 'Ask Helix' };
export const dynamic = 'force-dynamic';

export default async function AskHelixPage() {
  const v = await requireStaff();
  const supabase = await db();
  const { data: house } = await supabase.from('tenants').select('id').eq('slug', HOUSE_SLUG).maybeSingle();
  const { count } = house ? await supabase.from('helix_memory').select('id', { count: 'exact', head: true }).eq('tenant_id', house.id).eq('status', 'kept') : { count: 0 };
  const money = canSeeMoney(v.staff.role);
  return (
    <ConsoleShell title="Ask Helix" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Ask Helix' }]}>
      <HelixTabs current="ask" />
      <div className="grid g2" style={{ alignItems: 'start', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
        <Panel title="Helix Knows" sub="The copilot that knows Genovus better over time">
          <AskHelixEnterprise suggest={money
            ? ['How is the business doing this month?', 'Where is margin leaking, and what fixes it?', 'Which department needs attention this week?', 'What would grow MRR fastest?']
            : ['What should the team do first today?', 'Which department needs attention this week?', 'Who called the Genovus line and what did they want?', 'Which client needs us most?']} />
        </Panel>
        <Panel title="What Helix reads" sub="Live, every time you ask">
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
            <li><b>Sales:</b> the prospect funnel, calls due, inquiries by campaign, Genovus line calls and notes</li>
            <li><b>Pipeline:</b> clients by stage, who is stuck, open gates</li>
            <li><b>Clients & delivery:</b> approvals, care requests, trials ending, each agency’s lead health</li>
            <li><b>Studio:</b> spend against the cap, episodes</li>
            <li><b>Spend:</b> Google Places, partner radar runs</li>
            <li><b>Finance:</b> {money ? 'revenue, MRR, profit, margin, CAC, payback, money owed and runway' : 'only for an admin or account lead'}</li>
            <li><b>What Helix knows:</b> {count ?? 0} things the team asked it to remember (<Link href="/console/helix/knows">see them</Link>)</li>
          </ul>
          <p className="muted" style={{ fontSize: 12, margin: '10px 0 0' }}>Helix drafts and suggests; a person sends, posts or decides. It never quotes insurance and keeps each agency’s customers private.</p>
        </Panel>
      </div>
    </ConsoleShell>
  );
}
