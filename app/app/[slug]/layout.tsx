// The agency dashboard's frame that never re-renders on navigation: Ask Helix lives here, so its conversation and
// voice session travel with the agent from page to page. Pages still draw their own shell (AgencyShell).
import { getViewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';
import { HelixThreadProvider } from '@/components/HelixHost';
import { HelixDrawer } from '@/components/HelixDrawer';
import { agencyNav, navPages } from '@/lib/agency-nav';

export default async function AgencyLayout({ children, params }: LayoutProps<'/app/[slug]'>) {
  const { slug } = await params;
  const v = await getViewer();
  // Pages enforce access (requireTenant); the layout only decides whether this viewer gets Helix here.
  let tenant = v?.memberships.find((m) => m.slug === slug) ?? null;
  if (!tenant && v?.staff) {
    const { data } = await (await db()).from('tenants').select('id, plan').eq('slug', slug).maybeSingle();
    if (data) tenant = { tenantId: data.id, slug, name: '', role: 'owner', isSample: false, plan: data.plan };
  }
  const access = tenant ? await accessFor(tenant.tenantId, tenant.plan) : null;
  const helix = access?.has('helix') ?? false;
  // The menu's own page names, so Helix always knows which page the person is on.
  const pages = access ? navPages(agencyNav(`/app/${slug}`, (k) => access.has(k), { isOwner: true, welcome: true, programTitle: '' })) : [];
  return (
    <HelixThreadProvider surface={tenant && helix ? 'agency' : undefined} slug={slug}>
      {children}
      {tenant && helix ? <HelixDrawer slug={slug} tenantId={tenant.tenantId} pages={pages} /> : null}
    </HelixThreadProvider>
  );
}
