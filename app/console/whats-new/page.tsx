import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel } from '@/components/ui';
import { WhatsNewArchive } from '@/components/WhatsNew';

export const metadata = { title: 'What’s new' };

// Every upgrade to Genovus Enterprise, newest first: each one with a Quick Helix Tour (Show me) and a Try it.
export default function ConsoleWhatsNew() {
  return (
    <ConsoleShell title="What’s new">
      <Panel title="What’s new in Genovus" sub="Every upgrade, newest first. Show me walks you through it in seconds; Try it opens it ready to use.">
        <WhatsNewArchive surface="enterprise" />
      </Panel>
    </ConsoleShell>
  );
}
