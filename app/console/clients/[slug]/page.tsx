import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConsoleShell, Flash } from '@/components/ConsoleShell';
import { Panel, Chip, Status, Empty, Bar, Tile, STAGES, STAGE_LABEL, GATE_LABEL, PLAN_LABEL, money, date, dateTime, daysSince, type Stage } from '@/components/ui';
import { AssetGrid } from '@/components/AssetGrid';
import { db } from '@/lib/supabase/server';
import { liveSetup } from '@/lib/live-setup';
import { moveStage, setGate, decideApproval, setCareStatus, saveRecord } from '@/lib/actions';
import { inviteMember } from '@/lib/invite';
import { issueWelcomeLink, createInvoice, publishInvoice, markInvoicePaid } from '@/lib/actions';
import { findClientBySlug } from '@/lib/clients';

const TABS = [
  ['overview', 'Overview'], ['record', 'Agent record'], ['assets', 'Assets'], ['approvals', 'Approvals'],
  ['care', 'Care'], ['billing', 'Billing'], ['audit', 'Audit trail'],
] as const;
type Tab = (typeof TABS)[number][0];

/** Top-level differences between two record versions, for the record tab. */
function diff(a: Record<string, unknown> | null, b: Record<string, unknown>) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b)])].sort();
  return keys.flatMap((k) => {
    const x = JSON.stringify(a?.[k]);
    const y = JSON.stringify(b[k]);
    return x === y ? [] : [{ k, from: x, to: y }];
  });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { data } = await (await db()).from('tenants').select('name').eq('slug', slug).maybeSingle();
  return { title: data?.name ?? 'Client' };
}

export default async function ClientPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; ok?: string; err?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS.find(([k]) => k === sp.tab)?.[0] ?? 'overview') as Tab;
  const supabase = await db();
  const { data: t } = await supabase.from('tenants').select('*').eq('slug', slug).maybeSingle();
  if (!t) notFound();
  const here = `/console/clients/${slug}${tab === 'overview' ? '' : `?tab=${tab}`}`;
  const [records, gates, approvals, care, invoices, assets, audit, events, members, live] = await Promise.all([
    supabase.from('agent_records').select('version, data, is_current, note, created_at').eq('tenant_id', t.id).order('version', { ascending: false }).limit(10),
    supabase.from('gates').select('*').eq('tenant_id', t.id).order('kind'),
    supabase.from('approvals').select('*').eq('tenant_id', t.id).order('requested_at', { ascending: false }),
    supabase.from('care_requests').select('*').eq('tenant_id', t.id).order('created_at', { ascending: false }),
    supabase.from('invoices').select('*').eq('tenant_id', t.id).order('created_at'),
    supabase.from('assets').select('*').eq('tenant_id', t.id).order('kind').order('title'),
    supabase.from('audit_events').select('id, action, subject, actor_label, at, before, after').eq('tenant_id', t.id).order('id', { ascending: false }).limit(60),
    supabase.from('lifecycle_events').select('from_stage, to_stage, note, at').eq('tenant_id', t.id).order('at', { ascending: false }).limit(12),
    supabase.from('memberships').select('role, user_id, created_at').eq('tenant_id', t.id),
    tab === 'overview' ? liveSetup(slug) : Promise.resolve(null),
  ]);
  const links = await supabase.from('client_links').select('created_at').eq('tenant_id', t.id).is('revoked_at', null).order('created_at', { ascending: false }).limit(1);
  const rec = records.data?.find((r) => r.is_current);
  const data = (rec?.data ?? {}) as Record<string, unknown>;
  const g = gates.data ?? [];
  const cleared = g.filter((x) => x.status === 'cleared' || x.status === 'waived').length;
  const paid = (invoices.data ?? []).filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount_cents, 0);
  const open = (invoices.data ?? []).filter((i) => i.status === 'open').reduce((s, i) => s + i.amount_cents, 0);

  return (
    <ConsoleShell
      title={t.name}
      crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/clients', label: 'Clients' }, { label: t.name }]}
      actions={
        <>
          {t.is_sample ? <Chip kind="sample">Sample client</Chip> : null}
          <Link className="btn small" href={`/app/${slug}`}>View as the agency</Link>
        </>
      }
    >
      <Flash ok={sp.ok} err={sp.err} />
      <nav className="tabs" aria-label="Client sections">
        {TABS.map(([k, label]) => (
          <Link key={k} href={`/console/clients/${slug}${k === 'overview' ? '' : `?tab=${k}`}`} aria-current={k === tab ? 'page' : undefined}>{label}</Link>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <div className="grid g4">
            <Tile label="Stage" value={STAGE_LABEL[t.stage as Stage]} hint={`${daysSince(t.stage_since)} days in stage`} />
            <Tile label="Plan" value={t.plan ? PLAN_LABEL[t.plan] : '—'} hint={t.care_plan ? `Care: ${t.care_plan}` : 'No care plan yet'} />
            <Tile label="Gates cleared" value={<span className="num">{cleared}/{g.length}</span>} hint="Nothing publishes until these clear" />
            <Tile label="Paid to date" value={<span className="num">{money(paid)}</span>} hint={open ? `${money(open)} open` : 'Nothing open'} sample={t.is_sample} />
          </div>
          <div className="grid g2">
            <Panel title="Lifecycle" sub="Moving a stage is logged and drives the client’s next messages">
              <form action={moveStage} className="row">
                <input type="hidden" name="tenant" value={t.id} />
                <input type="hidden" name="back" value={here} />
                <select className="select" name="stage" defaultValue={t.stage} style={{ width: 'auto' }} aria-label="Stage">
                  {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
                <input className="input" name="note" placeholder="Note (optional)" style={{ flex: 1, minWidth: 160 }} maxLength={500} />
                <button className="btn primary small" type="submit">Move</button>
              </form>
              <ul className="list">
                {(events.data ?? []).map((e, i) => (
                  <li key={i}>
                    <span><b>{e.from_stage ? STAGE_LABEL[e.from_stage as Stage] : 'New'}</b> → <b>{STAGE_LABEL[e.to_stage as Stage]}</b>{e.note ? <span className="muted"> · {e.note}</span> : null}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{dateTime(e.at)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title="Live setup" sub="Read live from the client’s welcome guide and social wizard">
              {live?.error ? <div className="notice err">{live.error}</div> : null}
              {live?.welcome ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="spread"><b>Welcome guide</b><span className="muted num">{live.welcome.done}/{live.welcome.total}</span></div>
                  <Bar value={live.welcome.done} total={live.welcome.total} done={live.welcome.done === live.welcome.total} />
                  <ul className="steps">
                    {live.welcome.steps.map((s, i) => (
                      <li key={s.key} className={s.done ? 'done' : ''}><span className="dot">{s.done ? '✓' : i + 1}</span><span>{s.label}</span><span /></li>
                    ))}
                  </ul>
                  {live.welcome.kickoffTimes ? <p className="soft" style={{ fontSize: 14 }}>Kickoff times offered: {live.welcome.kickoffTimes}</p> : null}
                  <a className="btn small ghost" href={live.welcome.url} target="_blank" rel="noreferrer">Open welcome page</a>
                </div>
              ) : null}
              {live?.social ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="spread"><b>Social setup</b><span className="muted num">{live.social.done}/{live.social.total}</span></div>
                  <Bar value={live.social.done} total={live.social.total} done={live.social.done === live.social.total} />
                  <p className="soft" style={{ fontSize: 14 }}>
                    {live.social.approvedBy ? `Profile copy approved by ${live.social.approvedBy}, ${dateTime(live.social.approvedAt)}.` : 'Profile copy not approved yet.'}
                  </p>
                  {Object.keys(live.social.links).length ? (
                    <dl className="kv">{Object.entries(live.social.links).flatMap(([k, v]) => [<dt key={k + 'k'}>{k}</dt>, <dd key={k + 'v'}><a href={v} target="_blank" rel="noreferrer">{v}</a></dd>])}</dl>
                  ) : null}
                  <div className="row">
                    <a className="btn small primary" href={live.social.consoleUrl}>Open setup console</a>
                    <a className="btn small ghost" href={live.social.clientUrl} target="_blank" rel="noreferrer">Client’s view</a>
                  </div>
                </div>
              ) : null}
              {!live?.welcome && !live?.social && !live?.error ? <Empty title="No live setup for this client">Welcome packages start when the deposit clears.</Empty> : null}
            </Panel>
          </div>
          <Panel title="Gates" sub="Evidence is kept with each decision">
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Gate</th><th>Status</th><th>Evidence</th><th>Update</th></tr></thead>
                <tbody>
                  {g.map((x) => (
                    <tr key={x.id}>
                      <td>{GATE_LABEL[x.kind] ?? x.kind}</td>
                      <td><Status value={x.status} />{x.cleared_at ? <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{date(x.cleared_at)}</div> : null}</td>
                      <td className="soft" style={{ fontSize: 13, maxWidth: 340 }}>{x.evidence ?? '—'}</td>
                      <td>
                        <form action={setGate} className="row" style={{ flexWrap: 'nowrap' }}>
                          <input type="hidden" name="tenant" value={t.id} />
                          <input type="hidden" name="kind" value={x.kind} />
                          <input type="hidden" name="back" value={here} />
                          <select className="select" name="status" defaultValue={x.status} style={{ width: 'auto', minWidth: 116 }} aria-label={`${GATE_LABEL[x.kind]} status`}>
                            {['open', 'cleared', 'blocked', 'waived'].map((s) => <option key={s}>{s}</option>)}
                          </select>
                          <input className="input" name="evidence" placeholder="Evidence" style={{ minWidth: 140 }} maxLength={1000} />
                          <button className="btn small" type="submit">Save</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {t.kind === 'agency' && !findClientBySlug(slug) ? (
            <Panel title="Welcome package" sub="A personal welcome page and setup guide, built from this record. No deploy needed.">
              {links.data?.length ? <p className="soft">Link issued {dateTime(links.data[0].created_at)}. Reissuing replaces it; the client keeps their progress.</p> : <p className="soft">No welcome link yet. Issue one when the deposit clears; it is shown to you once.</p>}
              <form action={issueWelcomeLink} className="row">
                <input type="hidden" name="tenant" value={t.id} />
                <input type="hidden" name="back" value={here} />
                <button className="btn small primary" type="submit">{links.data?.length ? 'Reissue welcome link' : 'Issue welcome link'}</button>
              </form>
            </Panel>
          ) : null}
          <Panel title="People" sub="Who can sign in to this agency’s dashboard">
            {members.data?.length ? (
              <p className="soft">{members.data.length} member{members.data.length > 1 ? 's' : ''}: {members.data.map((m) => m.role).join(', ')}.</p>
            ) : (
              <Empty title="No one is invited yet">Invite the agency owner when they are ready to sign in.</Empty>
            )}
            {t.kind === 'agency' ? (
              <form action={inviteMember} className="row">
                <input type="hidden" name="tenant" value={t.id} />
                <input type="hidden" name="back" value={here} />
                <input className="input" type="email" name="email" required placeholder="name@agency.com" style={{ flex: 1, minWidth: 200 }} aria-label="Email to invite" />
                <select className="select" name="role" defaultValue="owner" style={{ width: 'auto' }} aria-label="Access"><option value="owner">Owner</option><option value="staff">Office staff</option></select>
                <button className="btn small primary" type="submit">Send sign-in invitation</button>
              </form>
            ) : null}
          </Panel>
        </>
      )}

      {tab === 'record' && (
        <div className="grid g2">
          <Panel title={`Agent record v${rec?.version ?? 0}`} sub="One record drives the site, copy, kit and welcome package. Saving creates a new version.">
            <form action={saveRecord} className="form">
              <input type="hidden" name="tenant" value={t.id} />
              <input type="hidden" name="back" value={here} />
              <textarea className="textarea" name="data" defaultValue={JSON.stringify(data, null, 2)} style={{ minHeight: 420, font: '500 12.5px/1.5 var(--mono)' }} aria-label="Agent record JSON" />
              <input className="input" name="note" placeholder="What changed and why" maxLength={500} />
              <button className="btn primary" type="submit">Save new version</button>
            </form>
          </Panel>
          <Panel title="Version history">
            <ul className="list">
              {(records.data ?? []).map((r, i, all) => {
                const changes = diff((all[i + 1]?.data as Record<string, unknown>) ?? null, r.data as Record<string, unknown>);
                return (
                  <li key={r.version}>
                    <div className="spread"><b>v{r.version}</b><span className="muted" style={{ fontSize: 13 }}>{dateTime(r.created_at)}</span></div>
                    {r.note ? <span className="soft">{r.note}</span> : null}
                    {all[i + 1] ? (
                      <details>
                        <summary>{changes.length} field{changes.length === 1 ? '' : 's'} changed</summary>
                        <pre className="code">{changes.map((c) => `${c.k}\n  - ${c.from ?? '∅'}\n  + ${c.to ?? '∅'}`).join('\n')}</pre>
                      </details>
                    ) : <span className="muted" style={{ fontSize: 13 }}>First version</span>}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>
      )}

      {tab === 'assets' && (
        <Panel title="Assets" sub="Everything built for this client, with rights status">
          <AssetGrid assets={assets.data ?? []} showAudience />
        </Panel>
      )}

      {tab === 'approvals' && (
        <Panel title="Approvals" sub="Team approvals are decided here; client approvals wait for the agency owner">
          {approvals.data?.length ? (
            <ul className="list">
              {approvals.data.map((a) => (
                <li key={a.id}>
                  <div className="spread">
                    <b>{a.title}</b>
                    <span className="row" style={{ gap: 6 }}>{a.is_sample ? <Chip kind="sample">Sample</Chip> : null}<Chip kind={a.lane}>{a.lane}</Chip><Status value={a.status} /></span>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>Decided by {a.approver === 'team' ? 'the team' : 'the client'} · requested {dateTime(a.requested_at)}{a.decided_at ? ` · decided ${dateTime(a.decided_at)}` : ''}</span>
                  {a.decision_note ? <span className="soft">“{a.decision_note}”</span> : null}
                  {a.status === 'pending' && a.approver === 'team' ? (
                    <form action={decideApproval} className="row">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="back" value={here} />
                      <input className="input" name="note" placeholder="Note (required to request changes)" style={{ flex: 1, minWidth: 180 }} />
                      <button className="btn good small" name="decision" value="approved">Approve</button>
                      <button className="btn small" name="decision" value="changes_requested">Request changes</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <Empty title="No approvals yet" />}
        </Panel>
      )}

      {tab === 'care' && (
        <Panel title="Care requests">
          {care.data?.length ? (
            <ul className="list">
              {care.data.map((c) => (
                <li key={c.id}>
                  <div className="spread"><b>{c.title}</b><span className="row" style={{ gap: 6 }}>{c.is_sample ? <Chip kind="sample">Sample</Chip> : null}<Status value={c.status} /></span></div>
                  {c.detail ? <span className="soft">{c.detail}</span> : null}
                  <form action={setCareStatus} className="row">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="back" value={here} />
                    <select className="select" name="status" defaultValue={c.status} style={{ width: 'auto' }} aria-label="Status">
                      {['new', 'in_progress', 'waiting_client', 'done'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                    <button className="btn small" type="submit">Update</button>
                    <span className="muted" style={{ fontSize: 13 }}>{c.kind} · {dateTime(c.created_at)}</span>
                  </form>
                </li>
              ))}
            </ul>
          ) : <Empty title="No care requests" />}
        </Panel>
      )}

      {tab === 'billing' && (
        <div className="grid g2">
          <Panel title="Invoices" sub="Paid through Mercury. Paste each Mercury invoice’s payment link to send it; the client pays from their Billing page.">
            {t.is_sample ? <div className="notice sample">Sample client: amounts are illustrative.</div> : null}
            {(invoices.data ?? []).length ? (
              <ul className="list">
                {(invoices.data ?? []).map((i) => (
                  <li key={i.id} style={{ gap: 8 }}>
                    <div className="spread">
                      <span><b>{i.number ? `${i.number} · ` : ''}{i.kind}</b> <span className="num">{money(i.amount_cents)}</span></span>
                      <Status value={i.status} />
                    </div>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {i.note ?? ''}{i.due_date ? ` · due ${date(i.due_date + 'T12:00:00')}` : ''}{i.paid_at ? ` · paid ${date(i.paid_at)}${i.paid_via ? ` via ${i.paid_via}` : ''}` : ''}
                    </span>
                    {i.status !== 'paid' && i.status !== 'void' ? (
                      <>
                        <form action={publishInvoice} className="row">
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="back" value={here} />
                          <input className="input" name="pay_url" type="url" required defaultValue={i.pay_url ?? ''} placeholder="https://… Mercury invoice payment link" style={{ flex: 2, minWidth: 220 }} aria-label="Mercury payment link" />
                          <input className="input" name="number" defaultValue={i.number ?? ''} placeholder="Invoice #" style={{ width: 110 }} aria-label="Invoice number" />
                          <input className="input" name="due" type="date" defaultValue={i.due_date ?? ''} style={{ width: 160 }} aria-label="Due date" />
                          <button className="btn small primary" type="submit">{i.status === 'open' ? 'Update link' : 'Send to client'}</button>
                        </form>
                        <form action={markInvoicePaid} className="row">
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="back" value={here} />
                          <input className="input" name="via" defaultValue="Mercury" style={{ width: 140 }} aria-label="Paid via" />
                          <input className="input" name="paid_on" type="date" style={{ width: 160 }} aria-label="Paid on" />
                          <button className="btn small good" type="submit">Mark paid</button>
                        </form>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <Empty title="No invoices yet" />}
          </Panel>
          <Panel title="New invoice" sub="Draft it here, create the matching invoice in Mercury, then paste its payment link to send.">
            <form action={createInvoice} className="form">
              <input type="hidden" name="tenant" value={t.id} />
              <input type="hidden" name="back" value={here} />
              <label className="field"><span>Type</span>
                <select className="select" name="kind" defaultValue="balance">
                  <option value="deposit">Deposit (70%)</option><option value="balance">Balance at launch (30%)</option><option value="care">Monthly care</option><option value="upgrade">Upgrade</option>
                </select>
              </label>
              <label className="field"><span>Amount (USD)</span><input className="input" name="amount" inputMode="decimal" required placeholder="625.00" /></label>
              <label className="field"><span>Note the client sees</span><input className="input" name="note" maxLength={300} placeholder="Balance due at launch" /></label>
              <label className="field"><span>Due date</span><input className="input" name="due" type="date" /></label>
              <button className="btn primary" type="submit" style={{ justifySelf: 'start' }}>Draft invoice</button>
            </form>
          </Panel>
        </div>
      )}

      {tab === 'audit' && (
        <Panel title="Audit trail" sub="Append-only and hash-chained; nobody can edit or delete an entry">
          <ul className="list">
            {(audit.data ?? []).map((e) => (
              <li key={e.id}>
                <div className="spread"><span><b>{e.action}</b> <span className="muted">{e.subject}</span></span><span className="muted num" style={{ fontSize: 12 }}>#{e.id}</span></div>
                <span className="muted" style={{ fontSize: 13 }}>{e.actor_label} · {dateTime(e.at)}</span>
                {e.after ? <details><summary>Details</summary><pre className="code">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre></details> : null}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </ConsoleShell>
  );
}
