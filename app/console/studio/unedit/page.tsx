// Unedit: record one take (or pick a video), and Genovus turns it into captioned clips, the full video and thumbnail
// options on one Approve card. This page is the door, plus every recording so far with where it stands.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel, Empty } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { UneditUpload } from '@/components/studio/UneditUpload';

export const metadata = { title: 'Unedit' };
export const dynamic = 'force-dynamic';

const STAGE: Record<string, [string, string]> = {
  uploaded: ['Starting', 'info'], transcribing: ['Transcribing', 'info'], finding: ['Finding moments', 'info'], rendering: ['Cutting clips', 'info'],
  review: ['Ready for review', 'pending'], publishing: ['Sending', 'info'], published: ['Sent', 'done'], failed: ['Stopped', 'blocked'],
};
const when = (s: string) => new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const mmss = (t: number | null) => (t ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : '');

export default async function Unedit() {
  await requireStaff();
  const supabase = await db();
  const [{ data: vlogs }, { data: clips }] = await Promise.all([
    supabase.from('unedit_vlogs').select('id, title, stage, error, duration_s, cost_cents, created_at, episode').order('created_at', { ascending: false }).limit(30),
    supabase.from('unedit_clips').select('vlog_id, status'),
  ]);
  return (
    <ConsoleShell title="Unedit" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { label: 'Unedit' }]}>
      <div className="ue-home">
        <UneditUpload />
        <Panel title="Your recordings" sub="Each one becomes a campaign: clips with captions, the full video, three thumbnails, one Approve.">
          {vlogs?.length ? (
            <ul className="ue-list">
              {vlogs.map((v) => {
                const [label, kind] = v.error ? ['Stopped', 'blocked'] : (STAGE[v.stage] ?? [v.stage, '']);
                const n = (clips ?? []).filter((c) => c.vlog_id === v.id && c.status !== 'dropped').length;
                return (
                  <li key={v.id}>
                    <Link href={`/console/studio/unedit/${v.id}`}>
                      <b>{(v.episode as { title?: string })?.title || v.title || 'Recording'}</b>
                      <span className="muted">{when(v.created_at)}{v.duration_s ? ` · ${mmss(Number(v.duration_s))}` : ''}{n ? ` · ${n} clip${n === 1 ? '' : 's'}` : ''}</span>
                    </Link>
                    <span className={`chip ${kind}`}>{label}</span>
                  </li>
                );
              })}
            </ul>
          ) : <Empty title="No recordings yet">Press the button and talk. 6 to 15 minutes works best.</Empty>}
        </Panel>
      </div>
    </ConsoleShell>
  );
}
