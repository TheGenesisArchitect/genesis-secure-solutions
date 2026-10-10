// Start a Studio generation. The database reserves it first (permission, monthly cap, approval threshold, and the
// bible's production order for identity slots) with the caller's own session; then the provider is called
// server-side. Reference images finish in this request; a video take starts here and finishes via polling.
import { db } from '@/lib/supabase/server';
import { generateRef, scheduleTake, shotBudget, generateThumb, generationConfigured, shotAspect, IMAGE_MODEL, VIDEO_MODEL, IMAGE_CENTS, VIDEO_CENTS } from '@/lib/studio-gen';
import { findSlot, ENSEMBLE } from '@/lib/studio-cast';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);
type Supa = Awaited<ReturnType<typeof db>>;
type Sig = { slot: string; label: string; direction: string };

/**
 * The cast named in a prompt (by @CODE tag such as @MAYA01, or by first name), from the active character records:
 * one reference each (the approved seated image, else the approved front portrait; Veo takes three in all), and a
 * continuity preamble with each person's visual anchors and, when the episode has one, their wardrobe look.
 */
async function castFor(supabase: Supa, seriesId: string, episodeId: string | null, prompt: string) {
  const { data: chars } = await supabase.from('studio_characters').select('id, code, name, visual_anchors').eq('series_id', seriesId).eq('status', 'active').order('sort');
  const lower = prompt.toLowerCase();
  const named = (chars ?? []).filter((c) => lower.includes(`@${c.code.toLowerCase()}`) || new RegExp(`\\b${c.name.split(' ')[0].toLowerCase()}\\b`).test(lower)).slice(0, 3);
  if (!named.length) return { refs: [] as string[], prompt };
  const [{ data: refs }, { data: looks }] = await Promise.all([
    supabase.from('studio_refs').select('id, character_id, slot').in('character_id', named.map((c) => c.id)).in('slot', ['SEATED', 'FACE_FRONT']).eq('approved', true).eq('status', 'ready'),
    episodeId ? supabase.from('studio_looks').select('character_id, description').eq('episode_id', episodeId) : Promise.resolve({ data: [] as { character_id: string; description: string }[] }),
  ]);
  const pick = (cid: string) => (refs ?? []).find((r) => r.character_id === cid && r.slot === 'SEATED') ?? (refs ?? []).find((r) => r.character_id === cid && r.slot === 'FACE_FRONT');
  const lines = named.map((c) => {
    const look = (looks ?? []).find((l) => l.character_id === c.id);
    return `${c.name}: ${c.visual_anchors ?? ''}${look ? ` Wearing: ${look.description}` : ''}`;
  });
  const clean = prompt.replace(/@[A-Z]{2,8}\d{2}/gi, (m) => named.find((c) => `@${c.code}`.toLowerCase() === m.toLowerCase())?.name ?? m);
  const full = lower.startsWith('cast (keep identical') ? clean : `Cast (keep identical to the reference images; they are different people): ${lines.join(' ')}\n\n${clean}`;
  return { refs: named.map((c) => pick(c.id)?.id).filter((x): x is string => Boolean(x)), prompt: full, missing: named.filter((c) => !pick(c.id)).map((c) => c.name) };
}

export async function POST(req: Request) {
  if (!generationConfigured()) return Response.json({ error: 'Generation isn’t connected here (no Gemini key).' }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; series?: string; character?: string; slot?: string; shot?: string; episode?: string; prompt?: string };
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
    const { data: shot } = await supabase.from('studio_shots').select('id, episode_id, studio_episodes(series_id)').eq('id', b.shot).maybeSingle();
    if (!shot) return Response.json({ error: 'Unknown shot.' }, { status: 404 });
    const seriesId = (shot.studio_episodes as unknown as { series_id: string } | null)?.series_id ?? '';
    const cast = await castFor(supabase, seriesId, shot.episode_id, prompt);
    if (cast.missing?.length) return Response.json({ error: `Approve a front portrait (or seated image) for ${cast.missing.join(', ')} first, so their face is locked.` }, { status: 400 });
    const sb = await shotBudget(shot.episode_id);
    if (!sb.used.includes(shot.id) && sb.used.length >= sb.budget) return Response.json({ error: `This episode’s shot budget is ${sb.budget} and all ${sb.budget} are in use. Retake one of them, or raise the budget in the pitch.` }, { status: 400 });
    const { data: id, error } = await supabase.rpc('studio_reserve', { p_kind: 'video', p_target: b.shot, p_character: null, p_prompt: cast.prompt, p_model: VIDEO_MODEL(), p_cents: VIDEO_CENTS, p_params: { aspectRatio: shotAspect(cast.prompt), resolution: '1080p' }, p_refs: cast.refs });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const r = await scheduleTake(id as string);
    return Response.json({ id, status: r.ok ? (r.waiting ? 'waiting' : 'running') : 'failed', error: r.error, refs: cast.refs.length }, { status: r.ok ? 200 : 502 });
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
