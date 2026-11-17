// Unedit: record one take (or pick a video), and Genovus turns it into captioned clips, the full video and thumbnail
// options on one Approve card. This page is the door, plus every recording so far with where it stands.
import Link from 'next/link';
import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel, Empty } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { UneditUpload } from '@/components/studio/UneditUpload';
import { UneditNav } from '@/components/studio/UneditNav';
import { PostCalendar, type CalPost } from '@/components/studio/PostCalendar';
import { nyAt, nyDay } from '@/lib/unedit-plan';

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
  // The calendar: every post from the start of today (New York) on, waiting or already sent.
  const today = nyAt(nyDay(new Date()), 0, 0).toISOString();
  const [{ data: vlogs }, { data: clips }, { data: cal }] = await Promise.all([
    supabase.from('unedit_vlogs').select('id, title, stage, error, duration_s, cost_cents, created_at, episode').order('created_at', { ascending: false }).limit(30),
    supabase.from('unedit_clips').select('id, vlog_id, n, status'),
    supabase.from('unedit_posts').select('id, vlog_id, clip_id, platform, kind, status, scheduled_at, posted_url, unedit_vlogs(title, episode)').gte('scheduled_at', today).in('status', ['queued', 'sent', 'posted', 'error']).order('scheduled_at').limit(300),
  ]);
  const clipN = new Map((clips ?? []).map((c) => [c.id as string, c.n as number]));
  const calendar: CalPost[] = (cal ?? []).map((p) => {
    const v = p.unedit_vlogs as unknown as { title: string | null; episode: { title?: string } | null } | null;
    return { id: p.id, vlog: p.vlog_id, episode: v?.episode?.title || v?.title || 'Recording', clip: p.clip_id ? clipN.get(p.clip_id) ?? null : null, platform: p.platform, kind: p.kind, status: p.status, at: p.scheduled_at as string, url: p.posted_url };
  });
  const waiting = calendar.filter((p) => p.status === 'queued').length;
  return (
    <ConsoleShell title="UnEdit Studio" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { label: 'UnEdit Studio' }]}>
      <UneditNav active="recordings" />
      <div className="ue-home">
        <UneditUpload />
        <Panel title="Posting calendar" sub={waiting ? `${waiting} post${waiting === 1 ? '' : 's'} waiting for their time. Move or cancel any of them until it goes out (New York time).` : 'Every approved post, by day (New York time).'}>
          <PostCalendar posts={calendar} />
        </Panel>
        <Panel title="Your recordings" sub="Each one becomes a campaign: clips with captions, the full video, three thumbnails, one Approve.">
          {vlogs?.length ? (
            <ul className="ue-list">
              {vlogs.map((v) => {
                const [label, kind] = v.error ? ['Stopped', 'blocked'] : v.stage === 'published' && calendar.some((p) => p.vlog === v.id && p.status === 'queued') ? ['Scheduled', 'scheduled'] : (STAGE[v.stage] ?? [v.stage, '']);
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
