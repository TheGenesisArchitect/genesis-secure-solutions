// Voice jobs (lib/studio-voice-jobs.ts), staff only. POST queues a script's lines to be voiced with the Studio's
// Gemini key; the Studio cron voices them. GET lists recent jobs, or with ?job=&line= streams one voiced line (WAV).
import { get } from '@vercel/blob';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { deskFor } from '@/lib/desk';
import { checkJob, type VoiceJob } from '@/lib/studio-voice-jobs';

export const dynamic = 'force-dynamic';

async function staff() {
  const supabase = await db();
  const [{ data: ok }, { data: auth }] = await Promise.all([supabase.rpc('is_staff'), supabase.auth.getUser()]);
  return ok && auth.user ? auth.user : null;
}

export async function POST(req: Request) {
  const user = await staff();
  if (!user) return Response.json({ error: 'Only the Genovus team can voice scripts.' }, { status: 403 });
  const job = checkJob((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if (typeof job === 'string') return Response.json({ error: job }, { status: 400 });
  const desk = await deskFor(null);
  const { data, error } = await adminDb().from('studio_voice_jobs').insert({ tenant_id: desk.id, created_by: user.email ?? user.id, ...job }).select('id').single();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, id: data.id, note: 'Queued. The Studio voices a few lines a minute.' });
}

export async function GET(req: Request) {
  if (!(await staff())) return Response.json({ error: 'Only the Genovus team can voice scripts.' }, { status: 403 });
  const u = new URL(req.url), id = u.searchParams.get('job'), line = u.searchParams.get('line');
  if (id && line) {
    const { data: j } = await adminDb().from('studio_voice_jobs').select('results').eq('id', id).maybeSingle();
    const r = (j?.results as VoiceJob['results'] | undefined)?.[line];
    if (!r) return Response.json({ error: 'Not voiced yet.' }, { status: 404 });
    const res = await get(r.path, { access: 'private', useCache: false });
    if (!res || res.statusCode !== 200 || !res.stream) return Response.json({ error: 'Audio missing.' }, { status: 404 });
    return new Response(res.stream, { headers: { 'content-type': 'audio/wav', 'content-disposition': `inline; filename="${line}.wav"` } });
  }
  const { data } = await adminDb().from('studio_voice_jobs').select('id, title, voice, status, error, results, created_at, done_at').order('created_at', { ascending: false }).limit(20);
  return Response.json({ jobs: data ?? [] });
}
