// Unedit's series music, Genovus team only: compose two drafts in a series style (Runway Seed Audio, about a minute
// each, side by side), make one the bed every polished episode uses, or turn the bed off.
import { del } from '@vercel/blob';
import { db } from '@/lib/supabase/server';
import { presigned } from '@/lib/unedit-media';
import { BED_PATH, composeDrafts, useDraft } from '@/lib/unedit-music';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  const supabase = await db();
  const [{ data: staff }, { data: auth }] = await Promise.all([supabase.rpc('is_staff'), supabase.auth.getUser()]);
  if (!staff || !auth.user) return Response.json({ ok: false, error: 'Only the Genovus team can change Unedit music.' }, { status: 403 });
  let body: { tool?: string; style?: string; path?: string };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: 'Bad request.' }, { status: 400 }); }
  try {
    if (body.tool === 'compose') {
      const r = await composeDrafts(String(body.style ?? ''), auth.user.id);
      if (!r.saved.length) return Response.json({ ok: false, error: `No draft came back: ${r.failed[0] ?? 'Runway refused it'}.` }, { status: 400 });
      return Response.json({ ok: true, say: `${r.saved.length} ${r.saved.length === 1 ? 'draft' : 'drafts'} ready to play${r.cents ? ` ($${(r.cents / 100).toFixed(2)})` : ''}.` });
    }
    if (body.tool === 'use') {
      await useDraft(String(body.path ?? ''), (p) => presigned(p, 10));
      return Response.json({ ok: true, say: 'That draft is now the music bed for new episodes.' });
    }
    if (body.tool === 'off') {
      await del(BED_PATH).catch(() => undefined);
      return Response.json({ ok: true, say: 'Music bed off: new episodes have effects only.' });
    }
    return Response.json({ ok: false, error: 'Unknown action.' }, { status: 400 });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : 'That didn’t work.' }, { status: 400 });
  }
}
