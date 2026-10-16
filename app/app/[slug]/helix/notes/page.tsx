// Helix Notes (Growth): what the office has told Helix, kept and turned into work. To-dos and ideas are the agency's
// own (private to it); a to-do becomes a follow-up in one tap. Questions Helix couldn't answer yet go to the Genovus
// team, and show here until they're answered.
import { ActionForm } from '@/components/ActionForm';
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { ModuleGate } from '@/components/ModuleGate';
import { Panel, Chip, Tile } from '@/components/ui';
import { db } from '@/lib/supabase/server';
import { accessFor } from '@/lib/access';
import { businessToday } from '@/lib/billing';
import { agencyAddHelixNote, agencySetHelixNote, agencyHelixNoteFollowUp } from '@/lib/actions';

export const metadata = { title: 'Helix notes' };
export const dynamic = 'force-dynamic';

type N = { id: string; kind: string; text: string; chapter: string; status: string; source: string; created_at: string; updated_at: string; follow_up_id: string | null };

const KIND: Record<string, string> = { action_item: 'To-do', idea: 'Idea', question: 'Question' };
const when = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

function Note({ n, tomorrow }: { n: N; tomorrow: string }) {
  const team = n.chapter === 'ask-helix';
  const open = !['done', 'accepted', 'dismissed'].includes(n.status);
  return (
    <li className="hn-row" data-done={!open || undefined}>
      <span className="hn-kind"><Chip kind={team ? 'info' : n.kind === 'action_item' ? 'pending' : 'sample'}>{KIND[n.kind] ?? 'Note'}</Chip></span>
      <span className="hn-main">
        {/* Questions carry a note for the team after ' · missing:'; the agency sees just the question. */}
        <b>{n.text.split(' · missing:')[0]}</b>
        <small className="muted">
          {n.source === 'helix' ? 'Told to Helix' : 'Added by the office'} · {when(n.created_at)}
          {team ? (open ? ' · With the Genovus team' : ' · Answered') : n.follow_up_id ? ' · Now a follow-up' : !open ? ` · ${n.status === 'dismissed' ? 'Dismissed' : 'Done'}` : ''}
        </small>
      </span>
      {!team ? (
        <span className="hn-actions">
          {open ? (
            <>
              {n.kind === 'action_item' ? (
                <ActionForm action={agencyHelixNoteFollowUp}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="due" value={tomorrow} /><button className="btn small" type="submit" title="Add it to tomorrow's follow-ups">Make it a follow-up</button></ActionForm>
              ) : null}
              <ActionForm action={agencySetHelixNote}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="status" value="done" /><button className="btn small primary" type="submit" aria-label={`Done: ${n.text}`}>✓ Done</button></ActionForm>
            </>
          ) : (
            <ActionForm action={agencySetHelixNote}><input type="hidden" name="id" value={n.id} /><input type="hidden" name="status" value="new" /><button className="btn small ghost" type="submit">Reopen</button></ActionForm>
          )}
        </span>
      ) : null}
    </li>
  );
}

export default async function HelixNotes({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ film?: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const film = (await searchParams).film === '1' && ctx.tenant.isSample;
  const access = await accessFor(ctx.tenant.tenantId, ctx.tenant.plan);
  if (!access.has('helix-notes')) return <AgencyShell ctx={ctx} title="Helix notes"><ModuleGate ctx={ctx} moduleKey="helix-notes" /></AgencyShell>;
  const tid = ctx.tenant.tenantId;
  const tomorrow = addDays(businessToday(), 1);
  const { data } = await (await db()).from('helix_notes').select('id, kind, text, chapter, status, source, created_at, updated_at, follow_up_id').eq('tenant_id', tid).in('chapter', ['agency', 'ask-helix']).order('created_at', { ascending: false }).limit(200);
  const all = (data ?? []) as N[];
  const isOpen = (n: N) => !['done', 'accepted', 'dismissed'].includes(n.status);
  const mine = all.filter((n) => n.chapter === 'agency' && isOpen(n));
  const team = all.filter((n) => n.chapter === 'ask-helix' && isOpen(n));
  const closed = all.filter((n) => !isOpen(n)).slice(0, 12);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return (
    <AgencyShell ctx={ctx} title="Helix notes" film={film}>
      <div className="grid g3">
        <Tile label="Open notes" value={<span className="num">{mine.length}</span>} hint="To-dos and ideas you gave Helix" />
        <Tile label="With the Genovus team" value={<span className="num">{team.length}</span>} hint="Questions Helix is learning to answer" />
        <Tile label="Turned into work this week" value={<span className="num">{all.filter((n) => !isOpen(n) && n.status !== 'dismissed' && n.updated_at >= weekAgo).length}</span>} hint="Done or now a follow-up" />
      </div>
      <div className="fu-grid">
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title={`Your notes · ${mine.length}`} sub="Say “Helix, make a note…” or add one here. A to-do becomes a follow-up in one tap.">
            {mine.length ? <ul className="hn-list">{mine.map((n) => <Note key={n.id} n={n} tomorrow={tomorrow} />)}</ul> : <p className="muted" style={{ margin: 0, fontSize: 14 }}>No open notes. Tell Helix what to remember and it lands here.</p>}
          </Panel>
          {team.length ? (
            <Panel title={`With the Genovus team · ${team.length}`} sub="Questions Helix couldn't answer yet. The team answers, and Helix learns.">
              <ul className="hn-list">{team.map((n) => <Note key={n.id} n={n} tomorrow={tomorrow} />)}</ul>
            </Panel>
          ) : null}
          {closed.length ? (
            <Panel title="Recently done" sub="What your notes turned into">
              <ul className="hn-list">{closed.map((n) => <Note key={n.id} n={n} tomorrow={tomorrow} />)}</ul>
            </Panel>
          ) : null}
        </div>
        <div className="grid" style={{ alignContent: 'start' }}>
          <Panel title="Add a note" sub="Anything the office should remember or do">
            <ActionForm action={agencyAddHelixNote} className="form" resetOnOk helix="note" helixTitle="New note">
              <input type="hidden" name="tenant" value={tid} />
              <label className="field"><span>Note</span><textarea className="input" name="text" required minLength={2} maxLength={600} rows={3} placeholder="e.g. Call the marina on Lake Oliver about a referral partnership" /></label>
              <label className="field"><span>Kind</span>
                <select className="input" name="kind" defaultValue="action_item">
                  <option value="action_item">To-do</option>
                  <option value="idea">Idea</option>
                  <option value="question">Question for the Genovus team</option>
                </select>
              </label>
              <button className="btn primary" type="submit">Save note</button>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </AgencyShell>
  );
}
