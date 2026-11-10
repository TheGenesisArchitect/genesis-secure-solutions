// Upgrades: every note from the Genovus team about what changed on this agency's systems, newest first, each in five
// parts (lib/upgrade-notes.ts), with its next steps to answer and, once sent, its check-back with real numbers.
import { AgencyShell, agencyContext } from '@/components/AgencyShell';
import { Panel, Empty } from '@/components/ui';
import { UpgradeNoteView } from '@/components/UpgradeNoteView';
import { MarkNotesRead } from '@/components/MarkNotesRead';
import { db } from '@/lib/supabase/server';
import { NOTE_COLS, type Note } from '@/lib/upgrade-notes';

export const metadata = { title: 'Upgrades' };
export const dynamic = 'force-dynamic';

export default async function Upgrades({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await agencyContext(slug);
  const supabase = await db();
  const { data } = await supabase.from('upgrade_notes').select(NOTE_COLS).eq('tenant_id', ctx.tenant.tenantId).eq('status', 'sent').order('sent_at', { ascending: false }).limit(50);
  const notes = (data ?? []) as unknown as Note[];
  const { data: ans } = notes.length ? await supabase.from('upgrade_note_steps').select('note_id, step_key, status').in('note_id', notes.map((n) => n.id)) : { data: [] };
  const answers = (id: string) => Object.fromEntries((ans ?? []).filter((a) => a.note_id === id).map((a) => [a.step_key as string, a.status as string]));
  return (
    <AgencyShell ctx={ctx} title="Upgrades">
      <p className="soft" style={{ margin: 0, maxWidth: '62ch' }}>What the Genovus team changed on your website, profiles and dashboard, what now runs in the background, and what to expect. Ask Helix about any of it.</p>
      {notes.length ? (
        <div className="unote-list">
          {notes.map((n) => <Panel key={n.id}><UpgradeNoteView n={n} answers={answers(n.id)} answer={!ctx.asStaff} showCheckBack /></Panel>)}
        </div>
      ) : <Empty title="No upgrades yet">When we improve your systems, a short note lands here and in your email: what changed, what to expect and anything we need from you.</Empty>}
      {!ctx.asStaff && notes.length ? <MarkNotesRead ids={notes.map((n) => n.id)} /> : null}
    </AgencyShell>
  );
}
