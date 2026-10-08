import { ActionForm } from '@/components/ActionForm';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Flash } from '@/components/ConsoleShell';
import { Panel, Chip, date } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { inviteMember } from '@/lib/invite';

export const metadata = { title: 'Team' };

export default async function Team({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await agencyContext(slug);
  const supabase = await db();
  const { data } = await supabase.from('memberships').select('user_id, role, created_at').eq('tenant_id', ctx.tenant.tenantId).order('created_at');
  const here = `/app/${slug}/team`;
  return (
    <AgencyShell ctx={ctx} title="Team">
      <Flash ok={sp.ok} err={sp.err} />
      <div className="grid g2">
        <Panel title="Who can sign in" sub="Office staff answer leads and log outcomes. Only the owner approves posts, publishing and payments.">
          {data?.length ? (
            <ul className="list">
              {data.map((m) => (
                <li key={m.user_id}>
                  <div className="spread">
                    <span>{m.user_id === ctx.viewer.userId ? 'You' : 'Team member'}</span>
                    <Chip kind={m.role === 'owner' ? 'required' : undefined}>{m.role === 'owner' ? 'Owner' : 'Office staff'}</Chip>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>Since {date(m.created_at)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="soft">No one has been invited yet.</p>}
        </Panel>
        {ctx.isOwner ? (
          <Panel title="Invite someone" sub="They get an email with a sign-in link. No passwords.">
            <ActionForm action={inviteMember} className="form">
              <input type="hidden" name="tenant" value={ctx.tenant.tenantId} />
              <input type="hidden" name="back" value={here} />
              <label className="field"><span>Email</span><input className="input" type="email" name="email" required maxLength={200} /></label>
              <label className="field"><span>Access</span>
                <select className="select" name="role" defaultValue="staff">
                  <option value="staff">Office staff</option>
                  {ctx.asStaff ? <option value="owner">Owner (Genovus team only)</option> : null}
                </select>
              </label>
              <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Send invitation</button>
            </ActionForm>
          </Panel>
        ) : null}
      </div>
    </AgencyShell>
  );
}
