import { ConsoleShell, Flash } from '@/components/ConsoleShell';
import { Panel, Chip, Empty } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { ionosConfigured, type DnsRecord } from '@/lib/ionos';
import { resendConfigured } from '@/lib/resend-domains';
import { emailPlan, sitePlan, SITE_DOMAINS, type Plan } from '@/lib/dns-plan';
import { registerEmailDomain, publishEmailRecords, verifyEmailDomain, pointSiteDomain } from '@/lib/setup-actions';

export const metadata = { title: 'Domains & email' };
export const dynamic = 'force-dynamic';

function Records({ title, list, kind }: { title: string; list: DnsRecord[]; kind: 'add' | 'remove' | 'ok' }) {
  if (!list.length) return null;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span className="muted" style={{ fontSize: 13 }}>{title}</span>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i} style={{ color: kind === 'remove' ? 'var(--bad)' : kind === 'add' ? 'var(--ink)' : 'var(--muted)' }}>
                <td>{r.type}{r.prio ? ` ${r.prio}` : ''}</td><td style={{ overflowWrap: 'anywhere' }}>{r.name}</td><td style={{ overflowWrap: 'anywhere', maxWidth: 420 }}>{r.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlanView({ plan }: { plan: Plan }) {
  if (plan.note) return <div className="notice">{plan.note}</div>;
  return (
    <>
      <Records title="Will be added" list={plan.add} kind="add" />
      <Records title="Will be removed (they conflict)" list={plan.remove} kind="remove" />
      <Records title="Already correct" list={plan.ok} kind="ok" />
    </>
  );
}

export default async function Setup({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const v = await requireStaff();
  if (v.staff.role !== 'admin') {
    return <ConsoleShell title="Domains & email"><Empty title="Only a platform admin can open this page" /></ConsoleShell>;
  }
  const ready = ionosConfigured() && resendConfigured();
  let email: Awaited<ReturnType<typeof emailPlan>> | null = null;
  let sites: Plan[] = [];
  let error = '';
  if (ready) {
    try {
      [email, sites] = await Promise.all([emailPlan('genovus.io'), Promise.all(SITE_DOMAINS.map((d) => sitePlan(d.domain, d.subs)))]);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not reach IONOS or Resend';
    }
  }
  const verified = email?.resend?.status === 'verified';
  return (
    <ConsoleShell title="Domains & email" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Domains & email' }]}>
      <Flash ok={sp.ok} err={sp.err} />
      <p className="soft">Our domains live at IONOS; email goes out through Resend. Every change here is computed fresh on the server, shown before it happens, and written to the audit log.</p>
      {!ready ? (
        <div className="notice err">
          {!ionosConfigured() ? 'IONOS keys are not available in this environment. ' : ''}
          {!resendConfigured() ? 'The Resend key is not available in this environment. ' : ''}
          Both are set for Production only.
        </div>
      ) : null}
      {error ? <div className="notice err">{error}</div> : null}

      <Panel
        title="Sending email as hello@genovus.io"
        sub="Sign-in codes, invitations, approvals and invoices go out from this address"
        actions={email?.resend ? <Chip kind={verified ? 'done' : 'pending'}>{verified ? 'Verified' : email.resend.status.replace('_', ' ')}</Chip> : null}
      >
        {email && !email.resend ? (
          <form action={registerEmailDomain} className="row">
            <input type="hidden" name="domain" value="genovus.io" />
            <span className="soft">genovus.io is not registered with Resend yet.</span>
            <button className="btn primary small" type="submit">Register genovus.io with Resend</button>
          </form>
        ) : null}
        {email?.resend ? (
          <>
            <PlanView plan={email.plan} />
            <div className="row">
              {email.plan.add.length ? (
                <form action={publishEmailRecords}>
                  <input type="hidden" name="domain" value="genovus.io" />
                  <button className="btn primary small" type="submit">Publish {email.plan.add.length} record{email.plan.add.length > 1 ? 's' : ''} at IONOS and verify</button>
                </form>
              ) : null}
              {!verified ? (
                <form action={verifyEmailDomain}>
                  <input type="hidden" name="domain" value="genovus.io" />
                  <button className="btn small" type="submit">Check verification</button>
                </form>
              ) : null}
            </div>
            <span className="muted" style={{ fontSize: 12 }}>These records live on the send. subdomain and the DKIM name, so your IONOS mailboxes are not affected.</span>
          </>
        ) : null}
      </Panel>

      {sites.map((plan) => (
        <Panel key={plan.domain} title={`${plan.domain} → Genovus`} sub={plan.domain === 'genovus.io' ? 'The home of the platform, plus app. and partners.' : 'Forwards to genovus.io'}
          actions={!plan.note && !plan.add.length && !plan.remove.length ? <Chip kind="done">Pointing at Genovus</Chip> : null}>
          <PlanView plan={plan} />
          {plan.add.length || plan.remove.length ? (
            <form action={pointSiteDomain}>
              <input type="hidden" name="domain" value={plan.domain} />
              <button className="btn primary small" type="submit">Apply these DNS changes</button>
            </form>
          ) : null}
        </Panel>
      ))}
    </ConsoleShell>
  );
}
