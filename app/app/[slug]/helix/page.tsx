// Ask Helix (Growth): the agency's assistant, answering from its own live data, by text (voice next).
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { AskHelixAgency } from '@/components/AskHelixAgency';
import { accessFor } from '@/lib/access';

export const metadata = { title: 'Ask Helix' };
export const dynamic = 'force-dynamic';

export default async function Helix({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  return (
    <AgencyShell ctx={ctx} title="Ask Helix">
      {access.has('helix') ? <AskHelixAgency slug={slug} tenantId={ctx.tenant.tenantId} /> : <ModuleGate ctx={ctx} moduleKey="helix" />}
    </AgencyShell>
  );
}
