// UnEdit Studio · Record: a teleprompter over your camera, or your screen with your camera in a bubble, recorded in
// the browser and sent straight into Unedit. A Newsroom package loads its teleprompter text and talking points, and
// recording against it hands the package's sources sheet to the new recording. Staff only.
import { ConsoleShell } from '@/components/ConsoleShell';
import { requireStaff } from '@/lib/session';
import { adminDb } from '@/lib/supabase/admin';
import { genovusTenant } from '@/lib/unedit';
import { UneditNav } from '@/components/studio/UneditNav';
import { Recorder, type Script } from '@/components/studio/Recorder';

export const metadata = { title: 'Record · UnEdit Studio' };
export const dynamic = 'force-dynamic';

export default async function RecordPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  await requireStaff();
  const { p } = await searchParams;
  const tenant = await genovusTenant();
  const db = adminDb();
  const { data: prods } = await db.from('newsroom_productions').select('id, story_id, angle, outputs, created_at, vlog_id').eq('tenant_id', tenant).is('vlog_id', null).order('created_at', { ascending: false }).limit(12);
  const ids = [...new Set((prods ?? []).map((x) => x.story_id as string))];
  const { data: stories } = ids.length ? await db.from('newsroom_stories').select('id, headline').in('id', ids) : { data: [] as { id: string; headline: string }[] };
  const scripts: Script[] = (prods ?? []).map((x) => {
    const o = x.outputs as { teleprompter?: string; script?: { part: string; lines: { say: string }[] }[] };
    return {
      id: x.id as string,
      title: (stories ?? []).find((s) => s.id === x.story_id)?.headline ?? x.angle,
      angle: x.angle as string,
      text: o.teleprompter || (o.script ?? []).flatMap((pt) => pt.lines.map((l) => l.say)).join('\n'),
      points: (o.script ?? []).map((pt) => pt.part).filter(Boolean),
    };
  }).filter((s) => s.text);
  return (
    <ConsoleShell title="UnEdit Studio" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { href: '/console/studio/unedit', label: 'UnEdit Studio' }, { label: 'Record' }]}>
      <UneditNav active="record" />
      <Recorder scripts={scripts} initial={p && scripts.some((s) => s.id === p) ? p : scripts[0]?.id ?? null} />
    </ConsoleShell>
  );
}
