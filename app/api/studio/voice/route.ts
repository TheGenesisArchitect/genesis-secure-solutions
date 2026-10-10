// Voice auditions and dialogue lines. Audition: the bible's five voice-set clips for one character in one
// candidate voice (sample, comic, quiet, laugh, the GENOVUS pronunciation). Line: one shot's line in the
// speaking character's voice (locked, or the audition voice until it is). Reserved first under the budget.
import { db } from '@/lib/supabase/server';
import { voiceClip, VOICES } from '@/lib/studio-voice';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const uuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);
type Voice = { direction?: string; samples?: string[]; tts_voice?: string };

export async function POST(req: Request) {
  if (!(process.env.GEMINI_API_KEY || '').trim()) return Response.json({ error: 'Voices aren’t connected here (no Gemini key).' }, { status: 503 });
  const b = (await req.json().catch(() => ({}))) as { kind?: string; character?: string; voice?: string; shot?: string; line?: number };
  const supabase = await db();

  if (b.kind === 'audition') {
    if (!uuid(b.character) || !VOICES.includes(String(b.voice))) return Response.json({ error: 'Pick a character and a voice.' }, { status: 400 });
    const { data: c } = await supabase.from('studio_characters').select('id, name, voice').eq('id', b.character).maybeSingle();
    if (!c) return Response.json({ error: 'Unknown character.' }, { status: 404 });
    const v = (c.voice ?? {}) as Voice;
    const style = v.direction ? `as an original character: ${v.direction}` : null;
    const s = v.samples ?? [];
    const set: [string, string, string | null][] = [
      ['sample', s[0] ?? 'Hi, it’s good to see you.', style],
      ['comic', s[2] ?? s[1] ?? 'Run that back. The wording was suspicious.', style],
      ['quiet', s[3] ?? 'I just needed a minute.', style ? `${style}, quietly and honestly` : 'quietly and honestly'],
      ['laugh', 'Okay. Okay, that was actually funny.', style ? `${style}, laughing warmly and genuinely as you speak` : 'laughing warmly'],
      ['pronunciation', 'Genovus. Genovus just knows.', style ? `${style}; pronounce Genovus as juh-NOH-vus, natural emphasis on knows` : 'pronounce Genovus as juh-NOH-vus'],
    ];
    const results = [];
    for (const [slot, text, st] of set) {
      const { data: id, error } = await supabase.rpc('studio_reserve_voice', { p_character: c.id, p_shot: null, p_kind: 'audition', p_slot: slot, p_voice: b.voice, p_style: st, p_text: text });
      if (error) return Response.json({ error: error.message }, { status: 400 });
      results.push(await voiceClip(id as string));
    }
    const failed = results.filter((r) => !r.ok);
    return Response.json({ ok: !failed.length, error: failed[0]?.error }, { status: failed.length === results.length ? 502 : 200 });
  }

  if (b.kind === 'line') {
    if (!uuid(b.shot)) return Response.json({ error: 'Unknown shot.' }, { status: 400 });
    const { data: shot } = await supabase.from('studio_shots').select('id, lines, studio_episodes(series_id)').eq('id', b.shot).maybeSingle();
    const lines = (shot?.lines ?? []) as { who: string; text: string }[];
    const line = lines[Number(b.line)];
    if (!shot || !line) return Response.json({ error: 'Unknown line.' }, { status: 404 });
    const { data: c } = await supabase.from('studio_characters').select('id, name, voice').eq('code', line.who).maybeSingle();
    if (!c) return Response.json({ error: 'Unknown character.' }, { status: 404 });
    const v = (c.voice ?? {}) as Voice;
    if (!v.tts_voice) return Response.json({ error: `Audition and lock ${c.name.split(' ')[0]}’s voice first.` }, { status: 400 });
    const { data: id, error } = await supabase.rpc('studio_reserve_voice', { p_character: c.id, p_shot: shot.id, p_kind: 'line', p_slot: `line-${b.line}`, p_voice: v.tts_voice, p_style: v.direction ? `as an original character: ${v.direction}` : null, p_text: line.text });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const r = await voiceClip(id as string);
    return Response.json(r, { status: r.ok ? 200 : 502 });
  }
  return Response.json({ error: 'Unknown kind.' }, { status: 400 });
}
