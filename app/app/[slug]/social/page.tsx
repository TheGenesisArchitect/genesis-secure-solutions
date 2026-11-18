// Social setup: the agency's Facebook, Instagram, Google and optional channels, one wizard each (lib/social-wizard.ts).
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Bar } from '@/components/ui';
import { SocialWizard } from '@/components/SocialWizard';
import { wizardData } from '@/lib/social-wizard';

export const metadata = { title: 'Social setup' };
export const dynamic = 'force-dynamic';

export default async function SocialSetup({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ c?: string }> }) {
  const { slug } = await params;
  const { c } = await searchParams;
  const ctx = await agencyContext(slug);
  const data = await wizardData(ctx.tenant.tenantId);
  return (
    <AgencyShell ctx={ctx} title="Social setup">
      <Panel title="Your social profiles" sub="Already have a profile? Paste the link and give us access. Don’t have one? We build it with you, step by step. You never share a password.">
        <Bar value={data.done} total={data.total} done={data.total > 0 && data.done === data.total} />
        <p style={{ margin: 0 }}><b>{data.done} of {data.total}</b> set up</p>
      </Panel>
      <SocialWizard slug={slug} data={data} staff={ctx.asStaff} open={typeof c === 'string' ? c : undefined} />
    </AgencyShell>
  );
}
