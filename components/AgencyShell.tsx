// The Agency Dashboard frame: one agency's private workspace. Staff can open it to see what the client sees.
import { requireTenant, type Membership, type Viewer } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { Shell } from './Shell';
import { EcosystemSwitcher } from './EcosystemSwitcher';
import { businessToday } from '@/lib/billing';
import { AgencyTabBar } from './AgencyTabBar';
import { PROGRAM_NAME } from '@/lib/programs';
import { accessFor } from '@/lib/access';
import { agencyNav } from '@/lib/agency-nav';

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
  // Not awaited: the rail draws now and each badge fills in when its count arrives.
  const n = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);
  const pending = n(supabase.from('approvals').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).eq('status', 'pending').eq('approver', 'client'));
  const open = n(supabase.from('care_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).neq('status', 'done'));
  const due = n(supabase.from('follow_ups').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).eq('status', 'open').lte('due_on', businessToday()));
  const fresh = n(supabase.from('leads').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant.tenantId).eq('status', 'new'));
  // One shell: what shows is what this agency can open (its program plus any grant or trial from Genovus). The same
  // list feeds Ctrl+K and Helix's "go to" (lib/agency-nav.ts).
  const trialNote = access.trial ? ` · trial ${access.trial.days} day${access.trial.days === 1 ? '' : 's'} left` : '';
  // New clients (not yet live) get the Welcome page first in the menu.
  const { data: st } = await supabase.from('tenants').select('stage').eq('id', tenant.tenantId).maybeSingle();
  const welcome = !tenant.isSample && !!st?.stage && st.stage !== 'care';
  const nav = agencyNav(base, (k) => access.has(k), { isOwner, welcome, programTitle: `Your program · ${PROGRAM_NAME[program]}${trialNote}`, staffSlug: asStaff ? tenant.slug : undefined, counts: { fresh, due, pending, open } });
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
      nav={nav}
    >
      {asStaff && !film ? <div className="notice">You are viewing {tenant.name}’s dashboard as the Genovus team. Client approvals can only be decided by the agency owner.</div> : null}
      {tenant.isSample && !film ? <div className="notice sample"><b>Sample agency.</b> {tenant.name} is fictional. Every number here is illustrative and marked Sample.</div> : null}
      {/* Filming the demo agency: the per-item Sample chips go too; the film itself carries the fictional-agency caption. */}
      {film ? <style>{'.chip.sample,.helix-fab,.helix-pill,.helix-drawer,.helix-nudge,.helix-undo,.whats-new,.lead-alerts{display:none}'}</style> : null}
      {children}
      {/* Ask Helix is mounted once by the agency layout (app/app/[slug]/layout.tsx), so it travels across pages. */}
      <AgencyTabBar base={base} film={film} />
    </Shell>
  );
}
