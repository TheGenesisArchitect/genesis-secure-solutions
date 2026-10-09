// Start a Studio generation. The database reserves it first (permission, monthly cap, approval threshold) with
// the caller's own session; then the provider is called server-side. A character sheet finishes in this request;
// a video take starts here and finishes via polling.
import { db } from '@/lib/supabase/server';
import { generateRef, startTake, generationConfigured, IMAGE_MODEL, VIDEO_MODEL, IMAGE_CENTS, VIDEO_CENTS } from '@/lib/studio-gen';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);

export async function POST(req: Request) {
  if (!generationConfigured()) return Response.json({ error: 'Generation isn’t connected here (no Gemini key).' }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; series?: string; character?: string; shot?: string; prompt?: string };
  const supabase = await db();
  const prompt = String(b.prompt ?? '').trim().slice(0, 4000);
  if (b.kind === 'ref') {
    if (!uuid(b.series) || !String(b.character ?? '').trim()) return Response.json({ error: 'Pick a character.' }, { status: 400 });
    const { data: id, error } = await supabase.rpc('studio_reserve', { p_kind: 'ref', p_target: b.series, p_character: String(b.character).slice(0, 80), p_prompt: prompt, p_model: IMAGE_MODEL(), p_cents: IMAGE_CENTS, p_params: {}, p_refs: [] });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const r = await generateRef(id as string);
    return Response.json({ id, status: r.ok ? 'ready' : 'failed', error: r.error }, { status: r.ok ? 200 : 502 });
  }
  if (b.kind === 'video') {
    if (!uuid(b.shot)) return Response.json({ error: 'Unknown shot.' }, { status: 400 });
    // The shot's characters, from the episode's series cast: canonical sheets named in the prompt (max 3).
    const { data: shot } = await supabase.from('studio_shots').select('id, studio_episodes(series_id)').eq('id', b.shot).maybeSingle();
    if (!shot) return Response.json({ error: 'Unknown shot.' }, { status: 404 });
    const seriesId = (shot.studio_episodes as unknown as { series_id: string } | null)?.series_id;
    const { data: cast } = await supabase.from('studio_refs').select('id, character').eq('series_id', seriesId ?? '').eq('canonical', true).eq('status', 'ready');
    const lower = prompt.toLowerCase();
    const refs = (cast ?? []).filter((c) => lower.includes(c.character.split(' ')[0].toLowerCase())).slice(0, 3).map((c) => c.id);
    const { data: id, error } = await supabase.rpc('studio_reserve', { p_kind: 'video', p_target: b.shot, p_character: null, p_prompt: prompt, p_model: VIDEO_MODEL(), p_cents: VIDEO_CENTS, p_params: { aspectRatio: '9:16', resolution: '1080p' }, p_refs: refs });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const r = await startTake(id as string);
    return Response.json({ id, status: r.ok ? 'running' : 'failed', error: r.error, refs: refs.length }, { status: r.ok ? 200 : 502 });
  }
  return Response.json({ error: 'Unknown kind.' }, { status: 400 });
}
