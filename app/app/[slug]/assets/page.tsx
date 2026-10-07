import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { AssetGrid, type AssetRow } from '@/components/AssetGrid';
import { Panel } from '@/components/ui';
import { db } from '@/lib/supabase/server';

export const metadata = { title: 'Assets & documents' };

export default async function AgencyAssets({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const supabase = await db();
  // Row-level security already hides internal assets from agency members; staff see what the client sees here.
  const { data } = await supabase.from('assets').select('*').eq('tenant_id', ctx.tenant.tenantId).neq('audience', 'internal').order('kind').order('title');
  return (
    <AgencyShell ctx={ctx} title="Assets & documents">
      <Panel title="Everything we built for you" sub="Your film, profile kit, covers, website and agreements. You own them; take them anywhere.">
        <AssetGrid assets={(data ?? []) as AssetRow[]} />
      </Panel>
    </AgencyShell>
  );
}
