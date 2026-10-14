// Finish an episode whose run has landed: claims the run (single-flight), answers at once, and renders the final cut
// and every Short in the background (lib/studio-finish.ts). Called by the Studio cron and the open board with the
// cron secret, or by staff ("Finish now" on the board). Nothing here spends: renders are ffmpeg in this function.
import { after } from 'next/server';
import { db } from '@/lib/supabase/server';
import { adminDb } from '@/lib/supabase/admin';
import { cronAuthorized } from '@/lib/cron';
import { claimFinish, finishEpisode } from '@/lib/studio-finish';

export const dynamic = 'force-dynamic';
export const maxDuration = 800;

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  if (!/^[A-Za-z0-9-]{1,30}$/.test(code)) return Response.json({ ok: false, error: 'bad episode' }, { status: 400 });
  if (!cronAuthorized(req)) {
    const { data: staff } = await (await db()).rpc('is_staff');
    if (!staff) return Response.json({ ok: false, error: 'Only the Genovus team can finish an episode.' }, { status: 403 });
  }
  const admin = adminDb();
  const { data: e } = await admin.from('studio_episodes').select('id').eq('code', code).maybeSingle();
  if (!e) return Response.json({ ok: false, error: 'Episode not found.' }, { status: 404 });
  // "Finish now" from a person clears a failed attempt so it can run again.
  if (!cronAuthorized(req)) await admin.rpc('studio_production_patch', { p_episode: e.id, p_patch: {}, p_remove: ['finish_failed_at'] });
  const claim = await claimFinish(e.id);
  if (!claim) return Response.json({ ok: true, started: false, say: 'Not ready to finish yet (shots still landing, or it is already finishing).' });
  after(async () => { await finishEpisode(e.id, claim); });
  return Response.json({ ok: true, started: true, say: 'Finishing: rendering the final cut and the Shorts now.' }, { status: 202 });
}
