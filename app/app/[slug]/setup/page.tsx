// Setup: where the agency stands on the way to launch, in one place. For clients onboarded in Genovus (every new
// client): the setup form on Welcome (how much is answered and what the build still needs), the kickoff, the deposit,
// and the launch checklist. Clients from before the database (the file-based welcome guide and social wizard) keep
// those panels too. Read-only: every answer is given on Welcome; nothing here writes.
import Link from 'next/link';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Bar, Status, Empty, GATE_LABEL, date, dateTime } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { liveSetup } from '@/lib/live-setup';
import { welcomeData, etWhen, pastKickoff } from '@/lib/welcome';

export const metadata = { title: 'Setup' };
export const dynamic = 'force-dynamic';

const GATE_HELP: Record<string, string> = {
  photo_rights: 'Every photo on your site is licensed or yours.',
  carrier_approval: 'Your carrier has approved your site and wording.',
  carrier_rules: 'You confirmed your carrier’s marketing rules in your profile.',
  meta_access: 'Genovus has partner access to your Facebook and Instagram (you keep ownership).',
  domain: 'Your web address is connected and secure.',
  privacy_notice: 'Your privacy notice is published.',
  kickoff: 'Your kickoff call is done.',
};
const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const dueLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export default async function Setup({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const supabase = await db();
  const [{ data: t }, { data: gates }, live, w, past] = await Promise.all([
    supabase.from('tenants').select('stage').eq('id', ctx.tenant.tenantId).single(),
    supabase.from('gates').select('kind, status, cleared_at').eq('tenant_id', ctx.tenant.tenantId).order('kind'),
    liveSetup(slug),
    welcomeData(ctx.tenant.tenantId, slug).catch(() => null),
    pastKickoff(ctx.tenant.tenantId).catch(() => null),
  ]);
  const g = gates ?? [];
  const cleared = g.filter((x) => x.status === 'cleared' || x.status === 'waived').length;
  const building = t?.stage !== 'care';
  const kickGate = g.find((x) => x.kind === 'kickoff');
  const kickDone = kickGate?.status === 'cleared' || kickGate?.status === 'waived';
  return (
    <AgencyShell ctx={ctx} title="Setup">
      {t?.stage === 'care' ? <div className="notice ok"><b>Setup is complete and you are live.</b> Changes now go through monthly care; the record below is kept for reference.</div> : null}
      {building && w ? (
        <div className="grid g2">
          <Panel title="Your setup form" sub={`On your Welcome page · ${w.plan.name} plan`}>
            <Bar value={w.progress.filled} total={w.progress.total} done={w.status.done} />
            <p style={{ margin: 0 }}><b>{w.progress.filled} of {w.progress.total}</b> answered</p>
            {w.status.missing.length ? (
              <div style={{ display: 'grid', gap: 4 }}>
                <span className="muted" style={{ fontSize: 13 }}>Still needed to build your site:</span>
                <ul className="setup-missing">{w.status.missing.map((m) => <li key={m.key}>{m.label}</li>)}</ul>
              </div>
            ) : <p className="soft" style={{ margin: 0 }}>Everything we need to build is in. Thank you.</p>}
            <Link className="btn small primary" href={`/app/${slug}/welcome`} style={{ justifySelf: 'start' }}>{w.progress.filled ? 'Continue your setup form' : 'Start your setup form'}</Link>
          </Panel>
          <Panel title="Kickoff and deposit" sub="The two dates that start your build">
            <div className="setup-facts">
              <div>
                <span className="muted">Kickoff call</span>
                {kickDone ? <b>Done{kickGate?.cleared_at ? ` · ${date(kickGate.cleared_at)}` : ''}</b>
                  : w.kickoff ? <b>{etWhen(w.kickoff.starts)} Eastern{w.kickoff.confirmed ? ' · confirmed' : ''}</b>
                  : past ? <b>Held {etWhen(past)} Eastern</b>
                  : <b>Not on the calendar yet</b>}
                {!kickDone && w.kickoff && !w.kickoff.confirmed ? <Link href={`/app/${slug}/welcome`} style={{ fontSize: 13 }}>Confirm it or pick another time</Link> : null}
                {!kickDone && !w.kickoff && past ? <span className="muted" style={{ fontSize: 13 }}>The Genovus team marks it done on your launch checklist. Need another session? Ask Helix or reply to any Genovus email.</span> : null}
                {!kickDone && !w.kickoff && !past ? <span className="muted" style={{ fontSize: 13 }}>The Genovus team sets it with you; it shows here and on Welcome as soon as it’s booked.</span> : null}
              </div>
              <div>
                <span className="muted">Deposit (70% of setup)</span>
                <b>{usd(w.deposit.cents)}{w.deposit.paid ? ' · paid ✓' : w.deposit.due ? ` · due ${dueLabel(w.deposit.due)}` : ' · invoice coming'}</b>
                <span className="muted" style={{ fontSize: 13 }}>{usd(w.balanceCents)} at launch</span>
              </div>
            </div>
          </Panel>
        </div>
      ) : null}
      {building && (live.welcome || live.social) ? (
        <div className="grid g2">
          {live.welcome ? (
            <Panel title="Your welcome guide" sub={live.welcome.updatedAt ? `Last updated ${dateTime(live.welcome.updatedAt)}` : 'The steps from your welcome package'}>
              <Bar value={live.welcome.done} total={live.welcome.total} done={live.welcome.done === live.welcome.total} />
              <ol className="steps">
                {live.welcome.steps.map((s, i) => (
                  <li key={s.key} className={s.done ? 'done' : ''}><span className="dot">{s.done ? '✓' : i + 1}</span><span>{s.label}</span><span className="muted" style={{ fontSize: 12 }}>{s.done ? 'Done' : ''}</span></li>
                ))}
              </ol>
              <a className="btn small primary" href={live.welcome.url} style={{ justifySelf: 'start' }}>Open your welcome guide</a>
            </Panel>
          ) : null}
          {live.social ? (
            <Panel title="Social profiles" sub="Facebook, Instagram and Google, set up together on a call">
              <div className="spread"><span>{live.social.done} of {live.social.total} steps done</span></div>
              <Bar value={live.social.done} total={live.social.total} done={live.social.done === live.social.total} />
              <p className="soft" style={{ fontSize: 14 }}>{live.social.approvedBy ? `Profile copy approved by ${live.social.approvedBy}.` : 'Profile copy is waiting for your approval in the wizard.'}</p>
              <a className="btn small primary" href={live.social.clientUrl} style={{ justifySelf: 'start' }}>Open social setup</a>
            </Panel>
          ) : null}
        </div>
      ) : null}
      {live.error && (live.welcome || live.social || !w) ? <div className="notice err">{live.error}</div> : null}
      <Panel title="Launch checklist" sub={g.length ? `${cleared} of ${g.length} cleared. Nothing goes public until every item is cleared.` : 'The items your site needs before it goes public'}>
        {g.length ? (
          <>
            <Bar value={cleared} total={g.length} done={cleared === g.length} />
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Item</th><th>What it means</th><th>Status</th></tr></thead>
                <tbody>
                  {g.map((x) => (
                    <tr key={x.kind}>
                      <td><b>{GATE_LABEL[x.kind]}</b></td>
                      <td className="soft">{GATE_HELP[x.kind]}</td>
                      <td><Status value={x.status} />{x.cleared_at ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{date(x.cleared_at)}</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : <Empty title={ctx.tenant.isSample ? 'Sample agency: setup finished' : 'Your launch checklist appears here once your build starts'} />}
      </Panel>
    </AgencyShell>
  );
}
