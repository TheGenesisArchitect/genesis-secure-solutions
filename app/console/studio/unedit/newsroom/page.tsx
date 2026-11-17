// The Genovus Newsroom: the wire as a live ticker of stories Helix researched, then the story (facts with their
// sources, angles, the parts Helix will build), watch-and-read, and the arsenal with one Produce. Staff only.
import { ConsoleShell } from '@/components/ConsoleShell';
import { requireStaff } from '@/lib/session';
import { adminDb } from '@/lib/supabase/admin';
import Link from 'next/link';
import { allDesks, deskFor } from '@/lib/desk';
import { settings } from '@/lib/newsroom';
import { businessToday } from '@/lib/billing';
import { Newsroom, type NrStory, type NrProduction } from '@/components/studio/Newsroom';
import { latestBrief } from '@/lib/newsroom-morning';
import { UneditNav } from '@/components/studio/UneditNav';

export const metadata = { title: 'Newsroom' };
export const dynamic = 'force-dynamic';

export default async function NewsroomPage({ searchParams }: { searchParams: Promise<{ desk?: string }> }) {
  await requireStaff();
  // The desk on screen (lib/desk.ts): the Genovus desk unless an agency desk is chosen.
  const desk = await deskFor((await searchParams).desk);
  const desks = await allDesks();
  const tenant = desk.id;
  const db = adminDb();
  const s = await settings(tenant);
  const { data: stories } = await db.from('newsroom_stories').select('*').eq('tenant_id', tenant).neq('status', 'dismissed').order('created_at', { ascending: false }).limit(40);
  const ids = (stories ?? []).map((x) => x.id as string);
  const [{ data: claims }, { data: prods }, { data: runs }] = await Promise.all([
    ids.length ? db.from('newsroom_claims').select('*').in('story_id', ids).order('created_at') : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ids.length ? db.from('newsroom_productions').select('*').in('story_id', ids).order('created_at', { ascending: false }) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    db.from('newsroom_runs').select('cost_cents, created_at').eq('tenant_id', tenant).gte('created_at', new Date(`${businessToday()}T00:00:00-05:00`).toISOString()),
  ]);
  const list: NrStory[] = (stories ?? []).map((x) => ({
    id: x.id, beat: x.beat, sub: x.sub, headline: x.headline, source: x.source, url: x.url, published_on: x.published_on, thumb: x.thumb_url, why: x.why, fit: x.fit, status: x.status,
    angles: x.angles ?? [], chosen: x.chosen_angle, build: x.build ?? [], voiced: x.voiced, created_at: x.created_at,
    claims: (claims ?? []).filter((c) => c.story_id === x.id).map((c) => ({ id: c.id as string, text: c.text as string, status: c.status as string, attribution: c.attribution as string | null, denial: c.denial as string | null, source_title: c.source_title as string | null, source_url: c.source_url as string, cited_text: c.cited_text as string | null, verified: Boolean(c.passage_verified), approved: Boolean(c.approved) })),
  }));
  const productions: NrProduction[] = (prods ?? []).map((p) => ({ id: p.id as string, story_id: p.story_id as string, angle: p.angle as string, formats: (p.formats as string[]) ?? [], outputs: p.outputs as NrProduction['outputs'], next_upload: Boolean(p.next_upload), vlog_id: (p.vlog_id as string | null) ?? null, cost: Number(p.cost_cents ?? 0), created_at: p.created_at as string, faceless: (p.faceless as NrProduction['faceless']) ?? null }));
  const spent = (runs ?? []).reduce((a, r) => a + Number(r.cost_cents ?? 0), 0);
  const brief = await latestBrief(tenant).catch(() => null);
  return (
    <ConsoleShell title="UnEdit Studio" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { href: '/console/studio/unedit', label: 'UnEdit Studio' }, { label: 'Newsroom' }]}>
      <UneditNav active="newsroom" />
      {desks.length > 1 ? (
        <nav className="nr-desks" aria-label="Desk">
          <span className="muted">Desk</span>
          {desks.map((d) => <Link key={d.slug} href={d.house ? '/console/studio/unedit/newsroom' : `/console/studio/unedit/newsroom?desk=${d.slug}`} className={d.slug === desk.slug ? 'on' : ''} aria-current={d.slug === desk.slug ? 'page' : undefined}>{d.name}</Link>)}
          {desk.profile ? <span className="muted nr-desk-note">{desk.profile.area.label} · {desk.profile.lines.join(', ')} · posts wait for {desk.profile.host}’s approval</span> : null}
        </nav>
      ) : null}
      <Newsroom desk={desk.house ? undefined : desk.slug} stories={list} productions={productions} beats={s.beats} voice={s.voice} spentToday={spent} dailyCap={s.daily_cap_cents} brief={brief} />
    </ConsoleShell>
  );
}
