// Helix notes: the ideas, action items, questions and risks Helix captures during vision tours, worked here.
// The build agent drafts a plan for a note (automatically for team tours, on request otherwise); a person
// decides what happens: start it, finish it, or dismiss it. Every change is sealed in the audit log.
import { ConsoleShell } from '@/components/ConsoleShell';
import { ActionForm } from '@/components/ActionForm';
import { Panel, Chip, Empty, Tile } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { setHelixNote, handOffHelixNote } from '@/lib/actions';

export const metadata = { title: 'Helix notes' };
export const dynamic = 'force-dynamic';

type Work = { title?: string; summary?: string; area?: string; steps?: string[]; acceptance?: string[]; risks?: string[]; effort?: string; error?: string };
type Note = { id: string; kind: string; text: string; chapter: string | null; status: string; work: Work | null; created_at: string; updated_at: string; source: string; helix_tour_sessions: { is_staff: boolean } | null };

const KIND: Record<string, { label: string; chip: string }> = {
  idea: { label: 'Idea', chip: 'info' }, action_item: { label: 'Action item', chip: 'done' }, question: { label: 'Question', chip: 'pending' }, risk: { label: 'Risk', chip: 'bad' },
};
const GROUPS: { title: string; sub: string; statuses: string[] }[] = [
  { title: 'Ready to work', sub: 'The agent drafted a plan, or the note is waiting for one', statuses: ['drafted', 'new', 'failed'] },
  { title: 'With the agent', sub: 'Drafting a plan now', statuses: ['drafting', 'handed_off'] },
  { title: 'In progress', sub: 'Someone on the team is on it', statuses: ['in_progress', 'accepted'] },
  { title: 'Done', sub: 'Finished or dismissed', statuses: ['done', 'dismissed'] },
];
const CHAPTER: Record<string, string> = { map: 'National map', market: 'Market brief', mission: 'Mission Control', content: 'Content Desk', studio: 'Studio', calendar: 'Calendar', calls: 'Call Desk', funnel: 'Funnel & BI', flywheel: 'Flywheel', helix: 'Helix Live' };
const when = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

function Status({ id, to, label, kind = 'ghost' }: { id: string; to: string; label: string; kind?: string }) {
  return (
    <ActionForm action={setHelixNote}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="status" value={to} />
      <button className={`btn small ${kind}`} type="submit">{label}</button>
    </ActionForm>
  );
}

function NoteCard({ n }: { n: Note }) {
  const k = KIND[n.kind] ?? KIND.idea;
  const w = n.work;
  return (
    <article className="tile" style={{ gap: 10 }}>
      <div className="spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 6 }}><Chip kind={k.chip as 'info'}>{k.label}</Chip>{n.chapter ? <span className="muted" style={{ fontSize: 12 }}>{CHAPTER[n.chapter] ?? n.chapter}</span> : null}</span>
        <span className="muted" style={{ fontSize: 12 }}>{n.helix_tour_sessions?.is_staff ? 'Team tour' : 'Shared link'} · {when(n.created_at)}</span>
      </div>
      <p style={{ margin: 0, fontSize: 15, color: 'var(--ink)' }}>{n.text}</p>
      {n.status === 'drafting' || n.status === 'handed_off' ? <span className="muted" style={{ fontSize: 13 }}>The build agent is drafting a plan… refresh in a few seconds.</span> : null}
      {n.status === 'failed' ? <span style={{ fontSize: 13, color: 'var(--bad)' }}>The agent couldn’t draft this one{w?.error ? `: ${w.error}` : ''}.</span> : null}
      {w?.title && !w.error ? (
        <details open={n.status === 'drafted'} style={{ borderTop: '1px dashed var(--line-2)', paddingTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Agent plan: {w.title} <span className="muted" style={{ fontWeight: 500 }}>· {w.area} · effort {w.effort}</span></summary>
          {w.summary ? <p className="soft" style={{ margin: '6px 0' }}>{w.summary}</p> : null}
          {w.steps?.length ? <><b style={{ fontSize: 13 }}>Steps</b><ol style={{ margin: '4px 0 8px', paddingLeft: 18, display: 'grid', gap: 3 }}>{w.steps.map((s) => <li key={s}>{s}</li>)}</ol></> : null}
          {w.acceptance?.length ? <><b style={{ fontSize: 13 }}>Done when</b><ul style={{ margin: '4px 0 8px', paddingLeft: 18, display: 'grid', gap: 3 }}>{w.acceptance.map((s) => <li key={s}>{s}</li>)}</ul></> : null}
          {w.risks?.length ? <><b style={{ fontSize: 13 }}>Risks and open questions</b><ul style={{ margin: '4px 0 0', paddingLeft: 18, display: 'grid', gap: 3 }}>{w.risks.map((s) => <li key={s}>{s}</li>)}</ul></> : null}
        </details>
      ) : null}
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {['new', 'failed'].includes(n.status) ? (
          <ActionForm action={handOffHelixNote}><input type="hidden" name="id" value={n.id} /><button className="btn small primary" type="submit">{n.status === 'failed' ? 'Try the agent again' : 'Hand off to the build agent'}</button></ActionForm>
        ) : null}
        {['new', 'drafted', 'failed'].includes(n.status) ? <Status id={n.id} to="in_progress" label="Start work" kind={n.status === 'drafted' ? 'primary' : 'ghost'} /> : null}
        {['in_progress', 'accepted'].includes(n.status) ? <Status id={n.id} to="done" label="Mark done" kind="primary" /> : null}
        {!['done', 'dismissed'].includes(n.status) ? <Status id={n.id} to="dismissed" label="Dismiss" /> : <Status id={n.id} to="new" label="Reopen" />}
      </div>
    </article>
  );
}

export default async function HelixNotes() {
  await requireStaff();
  const supabase = await db();
  const { data } = await supabase.from('helix_notes').select('id, kind, text, chapter, status, work, created_at, updated_at, source, helix_tour_sessions(is_staff)').order('created_at', { ascending: false }).limit(300);
  const notes = (data ?? []) as unknown as Note[];
  const count = (s: string[]) => notes.filter((n) => s.includes(n.status)).length;
  return (
    <ConsoleShell title="Helix notes" crumbs={[{ href: '/console', label: 'Enterprise' }, { label: 'Helix notes' }]}>
      <p className="soft">Ideas, action items, questions and risks Helix captured during tours of the vision. Notes from team tours go to the build agent automatically; it drafts a plan, and a person decides what happens next.</p>
      <div className="grid g4">
        <Tile label="Ready to work" value={<span className="num">{count(GROUPS[0].statuses)}</span>} hint="Drafted or waiting" />
        <Tile label="With the agent" value={<span className="num">{count(GROUPS[1].statuses)}</span>} hint="Drafting now" />
        <Tile label="In progress" value={<span className="num">{count(GROUPS[2].statuses)}</span>} hint="Being worked" />
        <Tile label="Done" value={<span className="num">{count(['done'])}</span>} hint={`${count(['dismissed'])} dismissed`} />
      </div>
      {notes.length ? GROUPS.map((g) => {
        const list = notes.filter((n) => g.statuses.includes(n.status));
        return list.length ? (
          <Panel key={g.title} title={`${g.title} · ${list.length}`} sub={g.sub}>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,340px),1fr))', alignItems: 'start' }}>
              {list.map((n) => <NoteCard key={n.id} n={n} />)}
            </div>
          </Panel>
        ) : null;
      }) : <Panel><Empty title="No notes yet">Take the tour at /vision and tell Helix what stands out; notes land here.</Empty></Panel>}
    </ConsoleShell>
  );
}
