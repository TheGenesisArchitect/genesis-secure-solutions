import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel } from '@/components/ui';
import { WhatsNewArchive } from '@/components/WhatsNew';

export const metadata = { title: 'What’s new' };

// Every upgrade to Genovus, newest first: each one with a Quick Helix Tour (Show me) and a Try it.
export default async function AgencyWhatsNew({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  return (
    <AgencyShell ctx={ctx} title="What’s new">
      <Panel title="What’s new in Genovus" sub="Every upgrade, newest first. Show me walks you through it in seconds; Try it opens it ready to use.">
        <WhatsNewArchive surface="agency" />
      </Panel>
    </AgencyShell>
  );
}
