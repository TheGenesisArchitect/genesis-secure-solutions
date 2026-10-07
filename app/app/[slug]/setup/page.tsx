import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Bar, Status, Empty, GATE_LABEL, date, dateTime } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { liveSetup } from '@/lib/live-setup';

export const metadata = { title: 'Setup' };

const GATE_HELP: Record<string, string> = {
  photo_rights: 'Every photo on your site is licensed or yours.',
  carrier_approval: 'Your carrier has approved your site and wording.',
  carrier_rules: 'You confirmed your carrier’s marketing rules in your profile.',
  meta_access: 'Genovus has partner access to your Facebook and Instagram (you keep ownership).',
  domain: 'Your web address is connected and secure.',
  privacy_notice: 'Your privacy notice is published.',
  kickoff: 'Your kickoff call is done.',
};

export default async function Setup({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const supabase = await db();
  const [{ data: gates }, live] = await Promise.all([
    supabase.from('gates').select('kind, status, cleared_at').eq('tenant_id', ctx.tenant.tenantId).order('kind'),
    liveSetup(slug),
  ]);
  const g = gates ?? [];
  const cleared = g.filter((x) => x.status === 'cleared' || x.status === 'waived').length;
  return (
    <AgencyShell ctx={ctx} title="Setup">
      {live.error ? <div className="notice err">{live.error}</div> : null}
      <div className="grid g2">
        <Panel title="Your welcome guide" sub={live.welcome?.updatedAt ? `Last updated ${dateTime(live.welcome.updatedAt)}` : 'The steps from your welcome package'}>
          {live.welcome ? (
            <>
              <Bar value={live.welcome.done} total={live.welcome.total} done={live.welcome.done === live.welcome.total} />
              <ol className="steps">
                {live.welcome.steps.map((s, i) => (
                  <li key={s.key} className={s.done ? 'done' : ''}><span className="dot">{s.done ? '✓' : i + 1}</span><span>{s.label}</span><span className="muted" style={{ fontSize: 12 }}>{s.done ? 'Done' : ''}</span></li>
                ))}
              </ol>
              <a className="btn small primary" href={live.welcome.url} style={{ justifySelf: 'start' }}>Open your welcome guide</a>
            </>
          ) : <Empty title={ctx.tenant.isSample ? 'Sample agency: setup finished' : 'Your welcome guide appears here when your deposit clears'} />}
        </Panel>
        <Panel title="Social profiles" sub="Facebook, Instagram and Google, set up together on a call">
          {live.social ? (
            <>
              <div className="spread"><span>{live.social.done} of {live.social.total} steps done</span></div>
              <Bar value={live.social.done} total={live.social.total} done={live.social.done === live.social.total} />
              <p className="soft" style={{ fontSize: 14 }}>{live.social.approvedBy ? `Profile copy approved by ${live.social.approvedBy}.` : 'Profile copy is waiting for your approval in the wizard.'}</p>
              <a className="btn small primary" href={live.social.clientUrl} style={{ justifySelf: 'start' }}>Open social setup</a>
            </>
          ) : <Empty title="Not part of your setup yet" />}
        </Panel>
      </div>
      <Panel title="Launch checklist" sub={`${cleared} of ${g.length} cleared. Nothing goes public until every item is cleared.`}>
        <Bar value={cleared} total={g.length} done={cleared === g.length && g.length > 0} />
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
      </Panel>
    </AgencyShell>
  );
}
