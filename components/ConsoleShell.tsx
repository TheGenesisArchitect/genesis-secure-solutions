// The Enterprise Dashboard frame: staff only, with live counts on the rail.
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { Shell } from './Shell';
import { EcosystemSwitcher } from './EcosystemSwitcher';

const ROLE: Record<string, string> = { admin: 'Platform admin', account_lead: 'Account lead', operator: 'Content and ads operator', reviewer: 'Reviewer' };

export async function ConsoleShell(props: { title: string; crumbs?: { href?: string; label: string }[]; actions?: React.ReactNode; children: React.ReactNode }) {
  const v = await requireStaff();
  const supabase = await db();
  const [appr, inq, care] = await Promise.all([
    supabase.from('approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('approver', 'team'),
    supabase.from('inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    supabase.from('care_requests').select('id', { count: 'exact', head: true }).in('status', ['new', 'in_progress']).eq('is_sample', false),
  ]);
  return (
    <Shell
      searchClients
      surface="Enterprise"
      home="/console"
      title={props.title}
      crumbs={props.crumbs}
      actions={props.actions}
      who={{ name: v.staff.name, detail: ROLE[v.staff.role] ?? v.staff.role }}
      switcher={<EcosystemSwitcher current="enterprise" />}
      nav={[
        { items: [{ href: '/console', label: 'Overview', exact: true }] },
        {
          title: 'Grow',
          items: [
            { href: '/console/inquiries', label: 'Inquiries', count: inq.count ?? 0 },
            { href: '/console/pipeline', label: 'Pipeline' },
            { href: '/console/clients', label: 'Clients' },
            { href: '/console/campaigns', label: 'Campaigns', icon: 'growth' },
          ],
        },
        {
          title: 'Deliver',
          items: [
            { href: '/console/approvals', label: 'Approval queue', count: appr.count ?? 0 },
            { href: '/console/care', label: 'Care desk', count: care.count ?? 0 },
            { href: '/console/assets', label: 'Asset library' },
          ],
        },
        {
          title: 'Oversee',
          items: [
            { href: '/console/audit', label: 'Audit log' },
            ...(v.staff.role === 'admin' ? [{ href: '/console/setup', label: 'Domains & email' }] : []),
            { href: '/console/meta', label: 'Meta connector', plain: true },
          ],
        },
      ]}
    >
      {props.children}
    </Shell>
  );
}

/** The one-line result banner after a form posts back (?ok= or ?err=). */
export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (err) return <div className="notice err" role="alert">{err}</div>;
  if (ok) return <div className="notice ok" role="status">{ok}</div>;
  return null;
}
