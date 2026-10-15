// The console's frame that never re-renders on navigation: Ask Helix lives here, so its conversation and voice
// session travel with the team from page to page. Pages still draw their own shell (ConsoleShell, staff only).
import { getViewer } from '@/lib/session';
import { HelixThreadProvider } from '@/components/HelixHost';
import { EnterpriseHelixDrawer } from '@/components/EnterpriseHelix';

export default async function ConsoleLayout({ children }: LayoutProps<'/console'>) {
  const v = await getViewer();
  return (
    <HelixThreadProvider surface={v?.staff ? 'enterprise' : undefined}>
      {children}
      {v?.staff ? <EnterpriseHelixDrawer /> : null}
    </HelixThreadProvider>
  );
}
