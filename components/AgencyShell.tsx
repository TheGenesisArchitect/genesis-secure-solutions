// The Agency Dashboard frame: one agency's private workspace. Staff can open it to see what the client sees.
import { requireTenant, type Membership, type Viewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { Shell } from './Shell';
import { EcosystemSwitcher } from './EcosystemSwitcher';
import { businessToday } from '@/lib/billing';

export type AgencyCtx = { viewer: Viewer; tenant: Membership; asStaff: boolean; isOwner: boolean };

export async function agencyContext(slug: string): Promise<AgencyCtx> {
  const ctx = await requireTenant(slug);
  return { ...ctx, isOwner: ctx.asStaff || ctx.tenant.role === 'owner' };
}

export async function AgencyShell({ ctx, title, children, actions }: { ctx: AgencyCtx; title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const { tenant, viewer, asStaff, isOwner } = ctx;
  const supabase = await db();
  const [{ count: pending }, { count: open }, { count: due }] = await Promise.all([
    supabase.from('approvals').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).eq('status', 'pending').eq('approver', 'client'),
    supabase.from('care_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).neq('status', 'done'),
    supabase.from('follow_ups').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).eq('status', 'open').lte('due_on', businessToday()),
  ]);
  const base = `/app/${tenant.slug}`;
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
      who={{ name: viewer.staff?.name ?? viewer.email, detail: asStaff ? 'Genovus team, viewing as the agency' : tenant.role === 'owner' ? 'Agency owner' : 'Office staff' }}
      nav={[
        { items: [{ href: base, label: 'Home', exact: true }, { href: `${base}/follow-ups`, label: 'Follow-ups', count: due ?? 0 }] },
        {
          title: 'Your program',
          items: [
            { href: `${base}/setup`, label: 'Setup' },
            { href: `${base}/approvals`, label: 'Approvals', count: pending ?? 0 },
            { href: `${base}/care`, label: 'Monthly care', count: open ?? 0 },
            { href: `${base}/performance`, label: 'Performance' },
          ],
        },
        {
          title: 'Your business',
          items: [
            { href: `${base}/assets`, label: 'Assets & documents' },
            ...(isOwner ? [{ href: `${base}/billing`, label: 'Billing & maintenance' }] : []),
            { href: `${base}/team`, label: 'Team' },
          ],
        },
        ...(asStaff ? [{ title: 'Genovus team', items: [{ href: `/console/clients/${tenant.slug}`, label: 'This client in the console' }] }] : []),
      ]}
    >
      {asStaff ? <div className="notice">You are viewing {tenant.name}’s dashboard as the Genovus team. Client approvals can only be decided by the agency owner.</div> : null}
      {tenant.isSample ? <div className="notice sample"><b>Sample agency.</b> {tenant.name} is fictional. Every number here is illustrative and marked Sample.</div> : null}
      {children}
    </Shell>
  );
}
