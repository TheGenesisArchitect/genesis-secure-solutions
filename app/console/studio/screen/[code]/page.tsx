// The Screening Room: an episode's auto rough cut, assembled from its picked (or best) takes, screen captures,
// voice-over and cards, played in the browser. Widescreen for the home page, vertical for social.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { buildCut, type CutFormat } from '@/lib/studio-cut';
import { ScreeningRoom } from '@/components/studio/ScreeningRoom';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Screening Room' };

export default async function Screen({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ format?: string }> }) {
  await requireStaff();
  const { code } = await params;
  const format: CutFormat = (await searchParams).format === 'vertical' ? 'vertical' : 'wide';
  const supabase = await db();
  const { data: e } = await supabase.from('studio_episodes').select('id, code, title').eq('code', code).maybeSingle();
  if (!e) notFound();
  const cut = await buildCut(e.id, format);
  const href = `/console/studio/${e.code}`;
  return (
    <ConsoleShell
      title={`Screening Room · ${e.title}`}
      crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { href, label: e.title }, { label: 'Screening Room' }]}
      actions={
        <span className="row" style={{ gap: 6 }}>
          <Link className={'btn small' + (format === 'wide' ? ' primary' : '')} href={`/console/studio/screen/${e.code}`}>16:9 · home page</Link>
          <Link className={'btn small' + (format === 'vertical' ? ' primary' : '')} href={`/console/studio/screen/${e.code}?format=vertical`}>9:16 · social</Link>
        </span>
      }
    >
      <ScreeningRoom key={format} cut={cut} episodeHref={href} />
      <p className="muted" style={{ fontSize: 13 }}>The rough cut assembles itself: picked takes first, then the Creative Court’s best, then drafts, each trimmed to the Court’s usable window or the Shot Contract’s timing. Screen-capture shots play their uploaded recording with Maya’s voice-over clips. Shots not rendered yet show as cards so the timing still reads.</p>
    </ConsoleShell>
  );
}
