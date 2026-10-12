// StudioNext on Runway: start a job from the production board (POST) or check the running ones (GET ?shot=).
// Every job is reserved with the caller's own session first (staff only, the monthly cap, the admin threshold),
// then started server-side. Nothing here runs on its own: each call is a person pressing a button on the board.
import { db } from '@/lib/supabase/server';
import { runwayConfigured } from '@/lib/runway';
import { designVoice, pollRunwayJobs, startKeyframes, startLines, startRunwayTake, startScore, castSheetBytes } from '@/lib/studio-runway';
import { put } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { kind?: string; shot?: string; character?: string; episode?: string; cue?: string };
  const supabase = await db();
  const { data: staff } = await supabase.rpc('is_staff');
  if (!staff) return Response.json({ error: 'Only the Genovus team can generate.' }, { status: 403 });

  // The official V2 cast sheet becomes a character's casting reference (free; a person approves it next).
  if (b.kind === 'casting') {
    if (!uuid(b.character)) return Response.json({ error: 'Pick a cast member.' }, { status: 400 });
    const { data: c } = await supabase.from('studio_characters').select('id, code, name').eq('id', b.character).maybeSingle();
    if (!c) return Response.json({ error: 'Unknown cast member.' }, { status: 404 });
    const bytes = await castSheetBytes(c.code, new URL(req.url).origin);
    if (!bytes) return Response.json({ error: `No official cast sheet on file for ${c.name}.` }, { status: 404 });
    const file = await put(`studio/casting/${c.id}/official-v2.jpg`, bytes, { access: 'private', contentType: 'image/jpeg', addRandomSuffix: true });
    const { error } = await supabase.rpc('studio_add_casting', { p_character: c.id, p_blob: file.pathname });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, note: `${c.name}’s official cast sheet is on file. Approve it to lock the identity.` });
  }

  if (!runwayConfigured()) return Response.json({ error: 'Runway isn’t connected here (Genovus_Runway_API_Key).' }, { status: 503 });
  const reserve = async (p: { kind: string; shot: string | null; character: string | null; text: string; model: string; cents: number; params?: Record<string, unknown>; refs?: string[] }) => {
    const { data, error } = await supabase.rpc('studio_reserve_runway', { p_kind: p.kind, p_shot: p.shot, p_character: p.character, p_text: p.text, p_model: p.model, p_cents: Math.max(1, Math.round(p.cents)), p_params: p.params ?? {}, p_refs: p.refs ?? [] });
    if (error) throw new Error(error.message);
    return data as string;
  };
  try {
    const r = b.kind === 'lines' && uuid(b.shot) ? await startLines(reserve, b.shot)
      : b.kind === 'keyframes' && uuid(b.shot) ? await startKeyframes(reserve, b.shot)
      : b.kind === 'take' && uuid(b.shot) ? await startRunwayTake(reserve, b.shot)
      : b.kind === 'design' && uuid(b.character) ? await designVoice(reserve, b.character)
      : b.kind === 'score' && uuid(b.episode) ? await startScore(reserve, b.episode, String(b.cue ?? '').slice(0, 2000))
      : { ok: false as const, error: 'Unknown request.' };
    return r.ok ? Response.json(r) : Response.json({ error: r.error }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Could not start it.' }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const supabase = await db();
  const { data: staff } = await supabase.rpc('is_staff');
  if (!staff) return Response.json({ error: 'not allowed' }, { status: 403 });
  const shot = new URL(req.url).searchParams.get('shot');
  return Response.json(await pollRunwayJobs(uuid(shot) ? shot : undefined));
}
