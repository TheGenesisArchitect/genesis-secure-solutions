// One Unedit recording: its card (components/studio/UneditCard.tsx). Media is shown through short-lived presigned
// links to private storage, made here on the server for the Genovus team only.
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { requireStaff } from '@/lib/session';
import { db } from '@/lib/supabase/server';
import { presigned } from '@/lib/unedit-media';
import { metricoolLive } from '@/lib/metricool';
import { UneditCard, type CardClip, type CardPost, type CardVlog } from '@/components/studio/UneditCard';
import type { Clip, UPost, Vlog } from '@/lib/unedit';

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
    supabase.from('unedit_episode_parts').select('status').eq('vlog_id', id),
  ]);
  const clips = (cs ?? []) as Clip[];
  const link = (p: string | null) => (p ? presigned(p, 180).catch(() => null) : Promise.resolve(null));
  const [source, thumbs, clipSrc] = await Promise.all([
    link(vlog.episode_path ?? vlog.blob_path),
    Promise.all((vlog.thumbs ?? []).map(async (t) => ({ src: (await link(t.blob)) ?? '', text: t.text, look: t.look }))),
    Promise.all(clips.map((c) => link(c.blob_path))),
  ]);
  const card: CardVlog = {
    id: vlog.id, title: vlog.title ?? 'Recording', stage: vlog.stage, error: vlog.error, provider: vlog.provider, words: vlog.words, duration: vlog.duration_s != null ? Number(vlog.duration_s) : null,
    bytes: Number(vlog.bytes), cost: vlog.cost_cents, source,
    // Episode Pro: what the edit took out, and how far the polished episode has rendered.
    polish: vlog.edit && vlog.episode_plan ? {
      secs: Number(vlog.edit.secs), removed: Number(vlog.edit.removed), ready: Boolean(vlog.episode_path), error: vlog.episode_plan.error ?? null,
      parts: (parts ?? []).length, done: (parts ?? []).filter((x) => x.status === 'done').length,
      cuts: vlog.edit.cuts.reduce<Record<string, number>>((a, c) => ({ ...a, [c.why]: (a[c.why] ?? 0) + 1 }), {}),
    } : null, episode: vlog.episode ?? {}, thumbs, thumbPick: vlog.thumb_pick, live: metricoolLive(), approvedAt: vlog.approved_at,
  };
  const cardClips: CardClip[] = clips.map((c, i) => ({ id: c.id, n: c.n, title: c.title, caption: c.caption, secs: c.secs != null ? Number(c.secs) : null, hook: c.hook_start_s != null, status: c.status, note: c.note, error: c.error, src: clipSrc[i], copy: c.copy ?? {}, start: Number(c.start_s), end: Number(c.end_s) }));
  const nOf = new Map(clips.map((c) => [c.id, c.n]));
  const posts: CardPost[] = ((ps ?? []) as UPost[]).map((p) => ({ id: p.id, platform: p.platform, kind: p.kind, title: p.title, clip: p.clip_id ? nOf.get(p.clip_id) ?? null : null, status: p.status, mc_status: p.mc_status, mc_error: p.mc_error, posted_url: p.posted_url }));
  const title = vlog.episode?.title || vlog.title || 'Recording';
  return (
    <ConsoleShell title={title} crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { href: '/console/studio/unedit', label: 'Unedit' }, { label: title }]}>
      <UneditCard vlog={card} clips={cardClips} posts={posts} />
    </ConsoleShell>
  );
}
