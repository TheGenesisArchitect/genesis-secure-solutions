// UnEdit Studio · Music: the series score under every polished episode. Compose drafts, listen, pick one.
import { ConsoleShell } from '@/components/ConsoleShell';
import { Panel } from '@/components/ui';
import { requireStaff } from '@/lib/session';
import { presigned } from '@/lib/unedit-media';
import { BED_PATH, listDrafts, SCORE_STYLES } from '@/lib/unedit-music';
import { UneditMusic } from '@/components/studio/UneditMusic';
import { UneditNav } from '@/components/studio/UneditNav';

export const metadata = { title: 'Music · UnEdit Studio' };
export const dynamic = 'force-dynamic';

export default async function UneditMusicPage() {
  await requireStaff();
  const music = await listDrafts().catch(() => ({ bed: false, drafts: [] }));
  const link = (p: string) => presigned(p, 120).catch(() => '');
  const [bedSrc, draftSrc] = await Promise.all([music.bed ? link(BED_PATH) : Promise.resolve(null), Promise.all(music.drafts.map((d) => link(d.path)))]);
  return (
    <ConsoleShell title="UnEdit Studio" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { href: '/console/studio/unedit', label: 'UnEdit Studio' }, { label: 'Music' }]}>
      <UneditNav active="music" />
      <Panel title="Series music" sub="An original score under every polished episode. Compose drafts, listen, and pick one.">
        <UneditMusic bed={bedSrc} drafts={music.drafts.map((d, i) => ({ ...d, src: draftSrc[i] }))} styles={Object.entries(SCORE_STYLES).map(([id, s]) => ({ id, label: s.label }))} />
      </Panel>
    </ConsoleShell>
  );
}
