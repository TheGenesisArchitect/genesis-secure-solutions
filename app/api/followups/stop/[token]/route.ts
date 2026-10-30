// Stop consultation follow-ups from the person's own link (migration 0090): the signed link is the authority. A form
// on /followups/stop/<token> posts here, and so do mail apps' one-click unsubscribe (List-Unsubscribe-Post).
import { adminDb } from '@/lib/supabase/admin';
import { followupStopFrom } from '@/lib/consult';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const id = followupStopFrom(token);
  if (!id) return Response.json({ ok: false, error: 'This link isn’t valid.' }, { status: 404 });
  const { error } = await adminDb().rpc('stop_consult_followups', { p_invite: id, p_reason: 'They asked to stop.' });
  if (error) return Response.json({ ok: false, error: 'We couldn’t do that. Please try again.' }, { status: 500 });
  // The page's own form comes back to the page; a mail app's one-click gets a plain OK.
  if ((req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded') && !(await req.clone().text()).includes('List-Unsubscribe'))
    return Response.redirect(new URL(`/followups/stop/${token}?done=1`, req.url), 303);
  return Response.json({ ok: true });
}
