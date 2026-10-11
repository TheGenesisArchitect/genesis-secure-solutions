// The Agency Dashboard frame: one agency's private workspace. Staff can open it to see what the client sees.
import { requireTenant, type Membership, type Viewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { Shell } from './Shell';
import { EcosystemSwitcher } from './EcosystemSwitcher';
import { businessToday } from '@/lib/billing';
import { AgencyTabBar } from './AgencyTabBar';
import { PROGRAM_NAME } from '@/lib/programs';
import { accessFor } from '@/lib/access';
import { HelixDrawer } from './HelixDrawer';

export type AgencyCtx = { viewer: Viewer; tenant: Membership; asStaff: boolean; isOwner: boolean };

export async function agencyContext(slug: string): Promise<AgencyCtx> {
  const ctx = await requireTenant(slug);
  return { ...ctx, isOwner: ctx.asStaff || ctx.tenant.role === 'owner' };
}

/** `film`: a clean frame for filming the app with the demo agency (no team or sample banners). */
export async function AgencyShell({ ctx, title, children, actions, film }: { ctx: AgencyCtx; title: string; children: React.ReactNode; actions?: React.ReactNode; film?: boolean }) {
  const { tenant, viewer, asStaff, isOwner } = ctx;
  const supabase = await db();
  const access = await accessFor(tenant.tenantId, tenant.plan);
  const program = access.program;
  const base = `/app/${tenant.slug}`;
  const [{ count: pending }, { count: open }, { count: due }, { count: fresh }] = await Promise.all([
    supabase.from('approvals').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).eq('status', 'pending').eq('approver', 'client'),
    supabase.from('care_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).neq('status', 'done'),
    supabase.from('follow_ups').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).eq('status', 'open').lte('due_on', businessToday()),
    supabase.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).eq('status', 'new'),
  ]);
  // One shell: what shows is what this agency can open (its program plus any grant or trial from Genovus).
  const has = (k: string) => access.has(k);
  const work = [
    { href: base, label: 'Home', exact: true },
    { href: `${base}/leads`, label: 'Leads', icon: 'inbox', count: fresh ?? 0 },
    ...(has('pipeline') ? [{ href: `${base}/pipeline`, label: 'Pipeline', icon: 'pipeline' }] : []),
    ...(has('partners') ? [{ href: `${base}/partners`, label: 'Partners', icon: 'team' }] : []),
    ...(has('calendar') ? [{ href: `${base}/calendar`, label: 'Calendar', icon: 'target' }] : []),
    { href: `${base}/today`, label: 'Today', icon: 'home' },
    { href: `${base}/follow-ups`, label: 'Follow-ups', count: due ?? 0 },
  ];
  const programItems = [
    ...(has('helix') ? [{ href: `${base}/helix`, label: 'Ask Helix', icon: 'helix' }] : []),
    ...(has('market') ? [{ href: `${base}/market`, label: 'Market', icon: 'globe' }] : []),
    { href: `${base}/setup`, label: 'Setup' },
    { href: `${base}/approvals`, label: 'Approvals', count: pending ?? 0 },
    { href: `${base}/care`, label: has('content') ? 'Care & content' : 'Monthly care', count: open ?? 0 },
    { href: `${base}/performance`, label: has('kpis') ? 'Performance & KPIs' : 'Performance' },
  ];
  const trialNote = access.trial ? ` · trial ${access.trial.days} day${access.trial.days === 1 ? '' : 's'} left` : '';
  return (
    <Shell
      searchClients
      surface="Agency"
      home={base}
      title={title}
      crumbs={[{ href: base, label: tenant.name }]}
      actions={actions}
      switcher={<EcosystemSwitcher current="agency" slug={tenant.slug} />}
      back={viewer.staff ? { href: `/console/clients/${tenant.slug}`, label: 'Enterprise' } : undefined}
      who={{ name: film ? tenant.name : viewer.staff?.name ?? viewer.email, detail: asStaff ? 'Genovus team, viewing as the agency' : tenant.role === 'owner' ? 'Agency owner' : 'Office staff' }}
      nav={[
        { items: work },
        { title: `Your program · ${PROGRAM_NAME[program]}${trialNote}`, items: programItems },
        {
          title: 'Your business',
          items: [
            { href: `${base}/assets`, label: 'Assets & documents' },
            ...(isOwner ? [{ href: `${base}/billing`, label: 'Billing & maintenance' }] : []),
            { href: `${base}/team`, label: 'Team' },
            { href: `${base}/program`, label: 'Your program', icon: 'overview' },
          ],
        },
        ...(asStaff ? [{ title: 'Genovus team', items: [{ href: `/console/clients/${tenant.slug}`, label: 'This client in the console' }] }] : []),
      ]}
    >
      {asStaff && !film ? <div className="notice">You are viewing {tenant.name}’s dashboard as the Genovus team. Client approvals can only be decided by the agency owner.</div> : null}
      {tenant.isSample && !film ? <div className="notice sample"><b>Sample agency.</b> {tenant.name} is fictional. Every number here is illustrative and marked Sample.</div> : null}
      {/* Filming the demo agency: the per-item Sample chips go too; the film itself carries the fictional-agency caption. */}
      {film ? <style>{'.chip.sample{display:none}'}</style> : null}
      {children}
      {has('helix') && !film ? <HelixDrawer slug={tenant.slug} tenantId={tenant.tenantId} /> : null}
      <AgencyTabBar base={base} film={film} />
    </Shell>
  );
}
