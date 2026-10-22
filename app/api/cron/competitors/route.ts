// Every minute: continue any competitor sweep that is running (a 25-mile sweep is a few hundred searches, so the
// 10-minute scan cron alone would take hours). Does nothing when no sweep is running; each sweep still stops at its cap.
import { cronAuthorized } from '@/lib/cron';
import { placesConfigured } from '@/lib/places';
import { runCompetitorScans } from '@/lib/competitor-radar';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  if (!placesConfigured()) return Response.json({ skipped: 'google places not configured' });
  try {
    return Response.json({ competitors: await runCompetitorScans(50_000) });
  } catch (e) {
    console.error(`[competitors] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: e instanceof Error ? e.message : 'sweep failed' }, { status: 500 });
  }
}
