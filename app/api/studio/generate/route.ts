// Start a Studio generation. The database reserves it first (permission, monthly cap, approval threshold, and the
// bible's production order for identity slots) with the caller's own session; then the provider is called
// server-side. Reference images finish in this request; a video take starts here and finishes via polling.
import { db } from '@/lib/supabase/server';
import { generateRef, scheduleTake, shotBudget, generateThumb, generateFrame, generationConfigured, shotAspect, videoFor, IMAGE_MODEL, IMAGE_CENTS } from '@/lib/studio-gen';
import { compileFrame, type ShotContract, type CastMember } from '@/lib/studio-direct';
import season from '@/data/studio-season1.json';
import castData from '@/data/studio-cast.json';
import { findSlot, ENSEMBLE } from '@/lib/studio-cast';
import { castFor } from '@/lib/studio-castrefs';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // four Frame Forge candidates paint one after another

const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);
type Sig = { slot: string; label: string; direction: string };


export async function POST(req: Request) {
  if (!generationConfigured()) return Response.json({ error: 'Generation isn’t connected here (no Gemini key).' }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; series?: string; character?: string; slot?: string; shot?: string; episode?: string; prompt?: string; role?: string; count?: number };
  const supabase = await db();
  const prompt = String(b.prompt ?? '').trim().slice(0, 4000);

  // Identity package: a slot for one character, or an ensemble slot for the series.
  if (b.kind === 'identity') {
    const slotKey = String(b.slot ?? '');
    let seriesId: string | null = null; let characterId: string | null = null; let text = ''; let name = 'Ensemble';
    if (uuid(b.character)) {
      const { data: c } = await supabase.from('studio_characters').select('id, series_id, name, identity_prompt, profile').eq('id', b.character).maybeSingle();
      if (!c) return Response.json({ error: 'Unknown character.' }, { status: 404 });
      const { data: looks } = await supabase.from('studio_looks').select('code, description').eq('character_id', c.id);
      const slot = findSlot(slotKey, (c.profile as { signature_slot?: Sig }).signature_slot, looks ?? []);
      if (!slot || slot.set === 'ensemble') return Response.json({ error: 'Unknown slot.' }, { status: 400 });
      const { data: series } = await supabase.from('studio_series').select('bible').eq('id', c.series_id).single();
      const continuity = (series?.bible as { cast_bible?: { continuity_instruction?: string } } | null)?.cast_bible?.continuity_instruction ?? '';
      text = slot.slot === 'FACE_FRONT' ? c.identity_prompt : `${continuity}\n\nShow this exact person: ${slot.direction}`;
      seriesId = c.series_id; characterId = c.id; name = c.name;
      const { data: id, error } = await supabase.rpc('studio_reserve', { p_kind: 'ref', p_target: seriesId, p_character: name, p_prompt: text, p_model: IMAGE_MODEL(), p_cents: IMAGE_CENTS, p_params: { character_id: characterId, slot: slot.slot, set: slot.set, group: slot.group, view: slot.view }, p_refs: [] });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      const r = await generateRef(id as string);
      return Response.json({ id, status: r.ok ? 'ready' : 'failed', error: r.error }, { status: r.ok ? 200 : 502 });
    }
    if (uuid(b.series)) {
      const slot = ENSEMBLE.find((s) => s.slot === slotKey);
      if (!slot) return Response.json({ error: 'Unknown slot.' }, { status: 400 });
      const { data: series } = await supabase.from('studio_series').select('bible').eq('id', b.series).single();
      const continuity = (series?.bible as { cast_bible?: { continuity_instruction?: string } } | null)?.cast_bible?.continuity_instruction ?? '';
      const { data: id, error } = await supabase.rpc('studio_reserve', { p_kind: 'ref', p_target: b.series, p_character: 'Ensemble', p_prompt: `${continuity}\n\n${slot.direction}`, p_model: IMAGE_MODEL(), p_cents: IMAGE_CENTS, p_params: { slot: slot.slot, set: 'ensemble', group: slot.group, view: slot.view }, p_refs: [] });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      const r = await generateRef(id as string);
      return Response.json({ id, status: r.ok ? 'ready' : 'failed', error: r.error }, { status: r.ok ? 200 : 502 });
    }
    return Response.json({ error: 'Pick a character.' }, { status: 400 });
  }

  // Legacy multi-view sheet (kept for older series).
  if (b.kind === 'ref') {
    if (!uuid(b.series) || !String(b.character ?? '').trim()) return Response.json({ error: 'Pick a character.' }, { status: 400 });
    const { data: id, error } = await supabase.rpc('studio_reserve', { p_kind: 'ref', p_target: b.series, p_character: String(b.character).slice(0, 80), p_prompt: prompt, p_model: IMAGE_MODEL(), p_cents: IMAGE_CENTS, p_params: {}, p_refs: [] });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const r = await generateRef(id as string);
    return Response.json({ id, status: r.ok ? 'ready' : 'failed', error: r.error }, { status: r.ok ? 200 : 502 });
  }

  if (b.kind === 'video') {
    if (!uuid(b.shot)) return Response.json({ error: 'Unknown shot.' }, { status: 400 });
    const { data: shot } = await supabase.from('studio_shots').select('id, episode_id, tier, studio_episodes(series_id)').eq('id', b.shot).maybeSingle();
    if (!shot) return Response.json({ error: 'Unknown shot.' }, { status: 404 });
    const seriesId = (shot.studio_episodes as unknown as { series_id: string } | null)?.series_id ?? '';
    const cast = await castFor(supabase, seriesId, shot.episode_id, prompt);
    if (cast.missing?.length) return Response.json({ error: `Approve a front portrait (or seated image) for ${cast.missing.join(', ')} first, so their face is locked.` }, { status: 400 });
    // Render ladder: hero shots on standard Veo; the chosen Frame Forge frames (if any) are what Veo animates.
    const render = videoFor(shot.tier);
    const { data: frameRows } = await supabase.from('studio_art').select('id, role').eq('shot_id', shot.id).eq('kind', 'frame').eq('chosen', true);
    const frames = (frameRows ?? []) as { id: string; role: string }[];
    const sb = await shotBudget(shot.episode_id);
    if (!sb.used.includes(shot.id) && sb.used.length >= sb.budget) return Response.json({ error: `This episode’s shot budget is ${sb.budget} and all ${sb.budget} are in use. Retake one of them, or raise the budget in the pitch.` }, { status: 400 });
    const { data: id, error } = await supabase.rpc('studio_reserve', { p_kind: 'video', p_target: b.shot, p_character: null, p_prompt: cast.prompt, p_model: render.model, p_cents: render.cents, p_params: { aspectRatio: shotAspect(cast.prompt), resolution: '1080p', tier: shot.tier, start_frame: frames.find((f) => f.role === 'start')?.id, end_frame: frames.find((f) => f.role === 'end')?.id }, p_refs: cast.refs });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const r = await scheduleTake(id as string);
    return Response.json({ id, status: r.ok ? (r.waiting ? 'waiting' : 'running') : 'failed', error: r.error, refs: cast.refs.length }, { status: r.ok ? 200 : 502 });
  }

  // Frame Forge: candidate start or end frames for a shot with a Shot Contract, painted from the compiled frame prompt.
  if (b.kind === 'frame') {
    if (!uuid(b.shot)) return Response.json({ error: 'Unknown shot.' }, { status: 400 });
    const role = b.role === 'end' ? 'end' : 'start';
    const count = Math.min(4, Math.max(1, Math.floor(Number(b.count) || 4)));
    const { data: shot } = await supabase.from('studio_shots').select('id, episode_id, contract, prompt, studio_episodes(series_id)').eq('id', b.shot).maybeSingle();
    if (!shot) return Response.json({ error: 'Unknown shot.' }, { status: 404 });
    const contract = shot.contract as ShotContract | null;
    if (!contract?.timeline?.length) return Response.json({ error: 'This shot has no Shot Contract yet.' }, { status: 400 });
    const genome = (season.series as { genome?: unknown }).genome as Parameters<typeof compileFrame>[1];
    const framePrompt = compileFrame(contract, genome, castData.characters as unknown as CastMember[], shotAspect(shot.prompt), role);
    const seriesId = (shot.studio_episodes as unknown as { series_id: string } | null)?.series_id ?? '';
    const cast = await castFor(supabase, seriesId, shot.episode_id, framePrompt);
    if (cast.missing?.length) return Response.json({ error: `Approve a front portrait (or seated image) for ${cast.missing.join(', ')} first, so their face is locked.` }, { status: 400 });
    const results: { id: string; status: string; error?: string }[] = [];
    for (let i = 0; i < count; i++) {
      const { data: id, error } = await supabase.rpc('studio_reserve_frame', { p_shot: shot.id, p_role: role, p_prompt: cast.prompt, p_model: IMAGE_MODEL(), p_cents: IMAGE_CENTS, p_refs: cast.refs });
      if (error) { results.push({ id: '', status: 'failed', error: error.message }); break; }
      const r = await generateFrame(id as string);
      results.push({ id: id as string, status: r.ok ? 'ready' : 'failed', error: r.error });
      if (!r.ok) break;
    }
    const ready = results.filter((r) => r.status === 'ready').length;
    return Response.json({ ready, results, error: ready ? undefined : results.at(-1)?.error }, { status: ready ? 200 : 502 });
  }

  if (b.kind === 'thumb') {
    if (!uuid(b.episode)) return Response.json({ error: 'Unknown episode.' }, { status: 400 });
    const { data: ep } = await supabase.from('studio_episodes').select('id, series_id').eq('id', b.episode).maybeSingle();
    if (!ep) return Response.json({ error: 'Unknown episode.' }, { status: 404 });
    const cast = await castFor(supabase, ep.series_id, ep.id, prompt);
    const { data: id, error } = await supabase.rpc('studio_reserve', { p_kind: 'thumb', p_target: ep.id, p_character: null, p_prompt: cast.prompt, p_model: IMAGE_MODEL(), p_cents: IMAGE_CENTS, p_params: {}, p_refs: cast.refs });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const r = await generateThumb(id as string);
    return Response.json({ id, status: r.ok ? 'ready' : 'failed', error: r.error, refs: cast.refs.length }, { status: r.ok ? 200 : 502 });
  }
  return Response.json({ error: 'Unknown kind.' }, { status: 400 });
}
