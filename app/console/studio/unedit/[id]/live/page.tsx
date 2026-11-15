// Studio Live for one recording: the episode on a monitor, its real multitrack timeline (camera sizes, graphics,
// newsroom facts, B-roll, captions, sound, sources), the crew with what each agent actually did, and what needs a
// person. Everything is read from the recording's plan; the page refreshes itself while Unedit works. Staff only.
import { notFound } from 'next/navigation';
import { ConsoleShell } from '@/components/ConsoleShell';
import { requireStaff } from '@/lib/session';
import { adminDb } from '@/lib/supabase/admin';
import { presigned } from '@/lib/unedit-media';
import { effectSounds, epTime, type EpGraphic } from '@/lib/unedit-episode';
import { musicBed } from '@/lib/unedit-music';
import type { Vlog } from '@/lib/unedit';
import { StudioLive, type LiveClip, type LiveTrack, type LiveCrew } from '@/components/studio/StudioLive';

export const metadata = { title: 'Studio Live' };
export const dynamic = 'force-dynamic';

const GRAPHIC = new Set(['title', 'lower', 'chapter', 'end', 'kinetic', 'emphasis', 'cue']);
const NEWS = new Set(['quote', 'timeline', 'ticker', 'globe']);
const LABEL: Record<string, string> = { title: 'Title', lower: 'Lower-third', chapter: 'Chapter', end: 'End card', kinetic: 'Kinetic phrase', emphasis: 'Emphasis word', cue: 'Cue', quote: 'Quote card', timeline: 'Timeline', ticker: 'Ticker', globe: 'Figure on the globe', source: 'Source chip', broll: 'B-roll' };

export default async function StudioLivePage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = adminDb();
  const { data } = await db.from('unedit_vlogs').select('*').eq('id', id).single();
  if (!data) notFound();
  const v = data as Vlog;
  const [{ data: parts }, { data: clips }, bed] = await Promise.all([
    db.from('unedit_episode_parts').select('status').eq('vlog_id', id),
    db.from('unedit_clips').select('n, title, status').eq('vlog_id', id).order('n'),
    musicBed().catch(() => null),
  ]);
  const ep = v.episode_plan;
  const g = ep?.graphics;
  const secs = Number(v.edit?.secs ?? v.duration_s ?? 0);
  const keep = v.edit?.keep ?? [];
  const src = await presigned(v.episode_path ?? v.blob_path, 120).catch(() => null);
  const items = (g?.items ?? []) as EpGraphic[];
  const clip = (track: string, it: EpGraphic, extra: Partial<LiveClip> = {}): LiveClip => ({ track, kind: it.kind, label: LABEL[it.kind] ?? it.kind, text: it.text, T: it.T, D: it.D, removable: true, raw: it.text, ...extra });
  const brollState = (it: EpGraphic) => (it.broll?.path ? 'ready' : it.broll?.failed ? 'failed' : 'generating');

  const tracks: LiveTrack[] = [
    { name: 'Camera', clips: (v.edit?.segs ?? []).flatMap((s) => { const T = epTime(s.from, keep); return T == null ? [] : [{ track: 'Camera', kind: 'camera', label: s.cam[0].toUpperCase() + s.cam.slice(1), text: `${s.cam} framing`, T, D: s.to - s.from, removable: false, tone: s.cam }]; }) },
    { name: 'B-roll', clips: items.filter((i) => i.kind === 'broll').map((i) => clip('B-roll', i, { text: i.broll?.prompt ?? 'Illustration', state: brollState(i), tone: brollState(i) })) },
    { name: 'Graphics', clips: items.filter((i) => GRAPHIC.has(i.kind)).map((i) => clip('Graphics', i)) },
    { name: 'News', clips: items.filter((i) => NEWS.has(i.kind)).map((i) => clip('News', i, { text: i.kind === 'quote' ? `“${i.text}” — ${i.news?.who ?? ''}` : i.text })) },
    { name: 'Captions', clips: secs && process.env.UNEDIT_EPISODE_CAPTIONS !== 'off' ? [{ track: 'Captions', kind: 'captions', label: 'Word by word', text: 'Word-by-word captions, the spoken word in gold, key words in orange. They step aside while a low or full-frame graphic is up.', T: 0, D: secs, removable: false }] : [] },
    { name: 'Music', clips: bed && secs ? [{ track: 'Music', kind: 'music', label: 'Series score', text: 'The approved series score, ducked under the voice.', T: 0, D: secs, removable: false }] : [] },
    { name: 'Effects', clips: effectSounds(items).map((s) => ({ track: 'Effects', kind: 'sfx', label: s.file.split(/[\\/]/).pop()!.replace('.wav', ''), text: `${s.file.split(/[\\/]/).pop()!.replace('.wav', '')} under a graphic`, T: s.at, D: 0.6, removable: false })) },
    { name: 'Sources', clips: items.filter((i) => i.kind === 'source').map((i) => clip('Sources', i)) },
  ];

  const done = (parts ?? []).filter((p) => p.status === 'done').length;
  const broll = items.filter((i) => i.kind === 'broll');
  const nb = (s: string) => broll.filter((b) => brollState(b) === s).length;
  const working = !v.error && ['uploaded', 'transcribing', 'finding', 'rendering', 'publishing'].includes(v.stage);
  const crew: LiveCrew[] = [
    { name: 'Transcript', state: v.words ? 'done' : 'work', doing: v.words ? `${v.words} words (${v.provider ?? 'transcribed'})` : 'Transcribing' },
    { name: 'Editor', state: v.edit ? 'done' : 'idle', doing: v.edit ? `${v.edit.cuts.length} cuts, ${Math.round(Number(v.edit.removed))} s tightened` : 'Waiting for the transcript' },
    { name: 'Camera', state: v.edit ? 'done' : 'idle', doing: v.edit ? `${v.edit.segs.length} shots: ${['wide', 'medium', 'close'].map((c) => `${v.edit!.segs.filter((s) => s.cam === c).length} ${c}`).join(', ')}` : '—' },
    { name: 'Director', state: g?.replan ? 'work' : g?.items.length ? 'done' : 'idle', doing: g?.replan ? 'Planning the graphics' : g ? `${items.length} graphics placed${g.chapters ? ', YouTube chapters' : ''}` : '—' },
    { name: 'Newsroom facts', state: v.sources?.length ? 'done' : 'idle', doing: v.sources?.length ? `${v.sources.length} sourced items on the sheet` : 'No sources sheet on this recording' },
    { name: 'B-roll (Runway)', state: nb('generating') ? 'work' : broll.length ? 'done' : 'idle', doing: broll.length ? `${nb('ready')} ready, ${nb('generating')} generating, ${nb('failed')} failed` : 'No B-roll planned' },
    { name: 'Captions', state: process.env.UNEDIT_EPISODE_CAPTIONS !== 'off' ? 'done' : 'idle', doing: process.env.UNEDIT_EPISODE_CAPTIONS !== 'off' ? 'Word by word, burned in with each part' : 'Off' },
    { name: 'Sound', state: 'done', doing: `${effectSounds(items).length} effects${bed ? ', series score under the voice' : ', no music bed yet'}` },
    { name: 'Render', state: v.episode_path ? 'done' : (parts ?? []).length ? 'work' : 'idle', doing: v.episode_path ? 'Episode ready' : `${done} of ${(parts ?? []).length} parts, reel ${(g?.reels ?? []).filter((r) => r.path).length} of ${(g?.reels ?? []).length}` },
    { name: 'Quality check', state: g?.qa ? (g.qa.ok ? 'done' : 'wait') : 'idle', doing: g?.qa ? (g.qa.ok ? 'Passed' : `${g.qa.issues.length} to look at`) : 'After the render' },
    { name: 'Clips', state: (clips ?? []).some((c) => c.status === 'rendering' || c.status === 'redo') ? 'work' : (clips ?? []).length ? 'done' : 'idle', doing: `${(clips ?? []).length} clips: ${(clips ?? []).filter((c) => c.status === 'approved').length} approved, ${(clips ?? []).filter((c) => c.status === 'ready').length} waiting for you` },
  ];
  const needs: string[] = [
    ...(v.error ? [`Stopped: ${v.error}`] : []),
    ...(g?.qa && !g.qa.ok ? g.qa.issues.slice(0, 4) : []),
    ...(g?.notes ?? []).filter((n) => /^(source|quote|timeline|ticker|globe) /.test(n)).slice(0, 3),
    ...broll.filter((b) => b.broll?.failed).map((b) => `A B-roll shot failed (${b.broll!.failed}); the speaker stays on screen there.`),
    ...((clips ?? []).some((c) => c.status === 'ready') ? [`${(clips ?? []).filter((c) => c.status === 'ready').length} clips are ready for your approval on the card.`] : []),
  ];
  const title = v.episode?.title || v.title || 'Recording';
  return (
    <ConsoleShell title={`Studio Live · ${title}`} crumbs={[{ href: '/console', label: 'Enterprise' }, { href: '/console/studio', label: 'Studio' }, { href: '/console/studio/unedit', label: 'Unedit' }, { href: `/console/studio/unedit/${id}`, label: title }, { label: 'Studio Live' }]}>
      <StudioLive id={id} title={title} src={src} polished={Boolean(v.episode_path)} secs={secs} stage={v.stage} working={working} review={v.stage === 'review'} pkg={g?.pkg ?? null} tracks={tracks} crew={crew} needs={needs} />
    </ConsoleShell>
  );
}
