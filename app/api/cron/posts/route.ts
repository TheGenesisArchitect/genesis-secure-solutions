// Every minute: owner-approved agency posts go to their agency's Metricool brand, and published ones are marked with
// their live link (lib/post-distribute.ts). Does nothing when nothing is approved and waiting.
import { cronAuthorized } from '@/lib/cron';
import { sendApprovedPosts, syncAgencyPosts } from '@/lib/post-distribute';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  try {
    const sent = await sendApprovedPosts(new URL(req.url).origin);
    const synced = await syncAgencyPosts();
    return Response.json({ sent, synced });
  } catch (e) {
    console.error(`[posts] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: e instanceof Error ? e.message : 'posting failed' }, { status: 500 });
  }
}
