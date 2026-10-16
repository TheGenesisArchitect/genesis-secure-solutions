// The Enterprise Dashboard frame: staff only, with live counts on the rail, and Ask Helix on every page (Helix Knows).
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { Shell, type NavSection } from './Shell';
import { EcosystemSwitcher } from './EcosystemSwitcher';

const ROLE: Record<string, string> = { admin: 'Platform admin', account_lead: 'Account lead', operator: 'Content and ads operator', reviewer: 'Reviewer' };

export async function ConsoleShell(props: { title: string; crumbs?: { href?: string; label: string }[]; actions?: React.ReactNode; children: React.ReactNode }) {
  const v = await requireStaff();
  const supabase = await db();
  // Not awaited: the rail draws now and each badge fills in when its count arrives.
  const n = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0, () => 0);
  const counts = {
    approvals: n(supabase.from('approvals').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('approver', 'team')),
    inquiries: n(supabase.from('inquiries').select('id', { count: 'exact', head: true }).eq('status', 'new')),
    care: n(supabase.from('care_requests').select('id', { count: 'exact', head: true }).in('status', ['new', 'in_progress']).eq('is_sample', false)),
    notes: n(supabase.from('helix_notes').select('id', { count: 'exact', head: true }).in('status', ['new', 'drafted', 'failed']).or('chapter.is.null,chapter.neq.agency')),
  };
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
      nav={consoleNav(v.staff.role, counts)}
    >
      {props.children}
      {/* Ask Helix is mounted once by the console layout (app/console/layout.tsx), so it travels across pages. */}
    </Shell>
  );
}

/** The console rail (counts optional: the loading frame draws it without them). */
export function consoleNav(role: string | null, counts?: { approvals?: Promise<number>; inquiries?: Promise<number>; care?: Promise<number>; notes?: Promise<number> }): NavSection[] {
  return [
        { items: [{ href: '/console', label: 'Overview', exact: true }, { href: '/console/helix/ask', label: 'Ask Helix', icon: 'helix', exact: true }] },
        {
          title: 'Grow',
          items: [
            { href: '/console/inquiries', label: 'Inquiries', count: counts?.inquiries },
            { href: '/console/pipeline', label: 'Pipeline' },
            { href: '/console/clients', label: 'Clients' },
            { href: '/console/campaigns', label: 'Campaigns', icon: 'growth' },
            { href: '/console/prospects', label: 'Prospects', icon: 'target' },
            { href: '/console/carriers', label: 'Carriers & scanner', icon: 'carriers' },
            { href: '/console/growth', label: 'Growth & financials', icon: 'chart' },
            { href: '/console/studio', label: 'Studio', icon: 'studio' },
          ],
        },
        {
          title: 'Deliver',
          items: [
            { href: '/console/approvals', label: 'Approval queue', count: counts?.approvals },
            { href: '/console/care', label: 'Care desk', count: counts?.care },
            { href: '/console/helix', label: 'Helix notes', count: counts?.notes },
            { href: '/console/assets', label: 'Asset library' },
          ],
        },
        {
          title: 'Oversee',
          items: [
            { href: '/console/audit', label: 'Audit log' },
            { href: '/console/whats-new', label: 'What’s new', icon: 'helix' },
            ...(role === 'admin' ? [{ href: '/console/setup', label: 'Domains & email' }] : []),
            { href: '/console/meta', label: 'Meta connector', plain: true },
          ],
        },
  ];
}

/** The one-line result banner after a form posts back (?ok= or ?err=). */
export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (err) return <div className="notice err" role="alert">{err}</div>;
  if (ok) return <div className="notice ok" role="status">{ok}</div>;
  return null;
}
