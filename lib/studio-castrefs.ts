// Cast references for a generation: which characters a prompt names and their approved reference images.
// Shared by the generate route (as the signed-in staff member) and the autopilot (as the server).
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The cast named in a prompt (by @CODE tag such as @MAYA01, or by first name), from the active character records:
 * one reference each (the approved seated image, else the approved front portrait; Veo takes three in all), and a
 * continuity preamble with each person's visual anchors and, when the episode has one, their wardrobe look.
 */
export async function castFor(supabase: SupabaseClient, seriesId: string, episodeId: string | null, prompt: string) {
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
