// One Unedit recording: its card (components/studio/UneditCard.tsx). Media is shown through short-lived presigned
// links to private storage, made here on the server for the Genovus team only.
import { sheetText } from '@/lib/unedit-news';
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { presigned } from '@/lib/unedit-media';
import { metricoolLive } from '@/lib/metricool';
import { UneditCard, type CardClip, type CardPost, type CardVlog } from '@/components/studio/UneditCard';
import { UneditNav } from '@/components/studio/UneditNav';
import { deskById } from '@/lib/desk';
import { postingContext, type Clip, type UPost, type Vlog } from '@/lib/unedit';

export const metadata = { title: 'Unedit' };
export const dynamic = 'force-dynamic';

export default async function UneditOne({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await db();
  const { data: v } = await supabase.from('unedit_vlogs').select('*').eq('id', id).maybeSingle();
  if (!v) notFound();
  const vlog = v as Vlog;
  const [{ data: cs }, { data: ps }, { data: parts }] = await Promise.all([
    supabase.from('unedit_clips').select('*').eq('vlog_id', id).order('n'),
    supabase.from('unedit_posts').select('*').eq('vlog_id', id).order('created_at'),
    supabase.from('unedit_episode_parts').select('k, status, error').eq('vlog_id', id),
  ]);
  const clips = (cs ?? []) as Clip[];
  const link = (p: string | null) => (p ? presigned(p, 180).catch(() => null) : Promise.resolve(null));
  // The card plays light review copies (lib/unedit-review.ts) when they match the current master; the master stays
  // one tap away as "Full quality". A copy made for an older render is never shown.
  type Rv = { path: string; of: string } | undefined;
  const epRv = (vlog.episode_plan as { review?: Rv } | null)?.review;
  const epLite = vlog.episode_path && epRv?.of === vlog.episode_path ? epRv.path : null;
  const clipLite = (c: Clip) => { const r = (c.features as { review?: Rv } | null)?.review; return c.blob_path && r?.of === c.blob_path ? r.path : null; };
  const [source, sourceFull, thumbs, clipSrc, clipFull] = await Promise.all([
    link(epLite ?? vlog.episode_path ?? vlog.blob_path),
    epLite ? link(vlog.episode_path) : Promise.resolve(null),
    Promise.all((vlog.thumbs ?? []).map(async (t) => ({ src: (await link(t.blob)) ?? '', text: t.text, look: t.look }))),
    Promise.all(clips.map((c) => link(clipLite(c) ?? c.blob_path))),
    Promise.all(clips.map((c) => (clipLite(c) ? link(c.blob_path) : Promise.resolve(null)))),
  ]);
  const card: CardVlog = {
    id: vlog.id, title: vlog.title ?? 'Recording', stage: vlog.stage, error: vlog.error, provider: vlog.provider, words: vlog.words, duration: vlog.duration_s != null ? Number(vlog.duration_s) : null,
    bytes: Number(vlog.bytes), cost: vlog.cost_cents, source, sourceFull,
    // Episode Pro: what the edit took out, and how far the polished episode has rendered.
    polish: vlog.edit && vlog.episode_plan ? {
      secs: Number(vlog.edit.secs), removed: Number(vlog.edit.removed), ready: Boolean(vlog.episode_path), error: vlog.episode_plan.error ?? null,
      graphics: vlog.episode_plan.graphics?.items.length ?? 0, graphicsError: vlog.episode_plan.graphics?.error ?? null, chapters: Boolean(vlog.episode_plan.graphics?.chapters),
      pkg: vlog.episode_plan.graphics?.pkg ?? 'classic', qa: vlog.episode_plan.graphics?.qa ?? null,
      newsNotes: (vlog.episode_plan.graphics?.notes ?? []).filter((n) => /^(source|quote|timeline|ticker|globe|B-roll) /.test(n)),
      parts: (parts ?? []).length, done: (parts ?? []).filter((x) => x.status === 'done').length,
      // Parts that finished without something (graphics or captions), so nobody approves a gap they can't see.
      gaps: (parts ?? []).filter((x) => x.status === 'done' && x.error).map((x) => `part ${Number(x.k) + 1}: ${String(x.error).split(':')[0]}`),
      cuts: vlog.edit.cuts.reduce<Record<string, number>>((a, c) => ({ ...a, [c.why]: (a[c.why] ?? 0) + 1 }), {}),
    } : null, episode: vlog.episode ?? {}, thumbs, thumbPick: vlog.thumb_pick, live: metricoolLive(), approvedAt: vlog.approved_at,
    sources: sheetText(vlog.sources),
  };
  const cardClips: CardClip[] = clips.map((c, i) => ({ id: c.id, n: c.n, title: c.title, caption: c.caption, secs: c.secs != null ? Number(c.secs) : null, hook: c.hook_start_s != null, status: c.status, note: c.note, error: c.error, src: clipSrc[i], full: clipFull[i], copy: c.copy ?? {}, start: Number(c.start_s), end: Number(c.end_s) }));
  const nOf = new Map(clips.map((c) => [c.id, c.n]));
  const posts: CardPost[] = ((ps ?? []) as UPost[]).map((p) => ({ id: p.id, platform: p.platform, kind: p.kind, title: p.title, clip: p.clip_id ? nOf.get(p.clip_id) ?? null : null, status: p.status, mc_status: p.mc_status, mc_error: p.mc_error, posted_url: p.posted_url, scheduled_at: p.scheduled_at }));
  // In review: what Helix plans the posting from (the story's heat and age, the brand's other scheduled posts).
  const ctx = vlog.stage === 'review' ? await postingContext(vlog).catch(() => null) : null;
  const planning = ctx ? { rec: ctx.rec, busy: ctx.busy, heat: ctx.signal.heat, headline: ctx.signal.headline } : undefined;
  const title = vlog.episode?.title || vlog.title || 'Recording';
  const desk = await deskById(vlog.tenant_id);
  return (
    <ConsoleShell title="UnEdit Studio" crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { href: '/console/studio/unedit', label: 'UnEdit Studio' }, { label: title }]}>
      <UneditNav active="recordings" recording={{ id: vlog.id, view: 'review', title }} desk={desk.house ? null : { slug: desk.slug, name: desk.name }} />
      <UneditCard vlog={card} clips={cardClips} posts={posts} planning={planning} />
    </ConsoleShell>
  );
}
