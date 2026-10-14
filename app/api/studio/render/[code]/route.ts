// Render an episode from its canonical timeline (lib/studio-timeline.ts → lib/studio-render.ts). A final render needs
// a clean timeline (no missing media, stale or missing reads, unresolved screens, or unverified lip-sync on speaking
// shots) and becomes the episode's final cut (QA and approval follow). A draft cut renders with problems open and is
// kept apart. A Short renders a selection of the shots (9:16 by default) and is kept with the draft cuts. Staff only;
// runs in this function with a bundled ffmpeg.
import { db } from '@/lib/supabase/server';
import { buildTimeline, validateTimeline } from '@/lib/studio-timeline';
import { renderTimeline, renderEngineReady, type RenderFormat } from '@/lib/studio-render';
import { shortsOf } from '@/lib/studio-board';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const supabase = await db();
  const { data: staff } = await supabase.rpc('is_staff');
  if (!staff) return Response.json({ ok: false, error: 'Only the Genovus team can render.' }, { status: 403 });
  const { data: e } = await supabase.from('studio_episodes').select('id, code, title').eq('code', code).maybeSingle();
  if (!e) return Response.json({ ok: false, error: 'Episode not found.' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { kind?: string; format?: string; short?: string };
  const kind: 'final' | 'draft' | 'short' = body.kind === 'final' ? 'final' : body.kind === 'short' ? 'short' : 'draft';
  const short = kind === 'short' ? shortsOf(e.code).find((s) => s.code === body.short) : undefined;
  if (kind === 'short' && !short) return Response.json({ ok: false, error: 'That Short isn’t defined for this episode.' }, { status: 400 });
  const format: RenderFormat = kind === 'final' ? 'wide' : body.format === 'vertical' || (kind === 'short' && body.format !== 'wide') ? 'vertical' : 'wide';
  const cut = await buildTimeline(e.id, format, short?.shots);
  const problems = validateTimeline(cut, kind === 'final' ? 'final' : 'draft');
  if (kind === 'final' && problems.length) return Response.json({ ok: false, error: `${problems.length} thing${problems.length === 1 ? '' : 's'} to finish before the final render.`, problems });
  const blocking = problems.filter((p) => p.kind === 'missing_picture' || p.kind === 'screen_unresolved');
  if (blocking.length === cut.items.length) return Response.json({ ok: false, error: 'Nothing to render yet.', problems });
  const started = Date.now();
  try {
    const r = await renderTimeline(e.id, cut, kind, format, short?.code ?? '');
    const note = problems.length ? problems.map((p) => `${p.label}: ${p.detail}`).join(' · ') : null;
    const { error } = kind === 'final'
      ? await supabase.rpc('studio_set_final', { p_episode: e.id, p_blob: r.blob, p_sha256: r.sha256 })
      : await supabase.rpc('studio_add_render', { p_episode: e.id, p_kind: kind, p_format: format, p_short: short?.code ?? '', p_title: short?.title ?? 'Draft cut', p_blob: r.blob, p_secs: r.secs, p_note: note ?? '' });
    if (error) return Response.json({ ok: false, error: error.message });
    return Response.json({ ok: true, kind, secs: r.secs, bytes: r.bytes, renderSecs: Math.round((Date.now() - started) / 1000), problems,
      say: kind === 'final' ? `Final cut rendered (${Math.round(r.secs)} s). It's ready for review.` : short ? `Short “${short.title}” rendered (${Math.round(r.secs)} s, ${format === 'vertical' ? '9:16' : '16:9'}).` : `Draft cut rendered (${Math.round(r.secs)} s)${problems.length ? ` with ${problems.length} thing${problems.length === 1 ? '' : 's'} still to finish` : ''}.` });
  } catch (err) {
    console.error(`[studio-render] ${code}: ${err instanceof Error ? err.message : err}`);
    return Response.json({ ok: false, error: `The render failed: ${err instanceof Error ? err.message.slice(0, 300) : 'unknown error'}` });
  }
}

/** Is the render engine present on this deployment? Reports only true/false and ffmpeg's version line. */
export async function GET() {
  return Response.json(await renderEngineReady());
}
