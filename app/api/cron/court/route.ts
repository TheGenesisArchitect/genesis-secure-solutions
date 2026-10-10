// Every minute: the SWIS™ Creative Court scores finished takes that have not been reviewed yet, so the ranking is
// waiting when a person opens the episode. One take per run (a careful review takes up to a few minutes).
import { cronAuthorized } from '@/lib/cron';
import { generationConfigured } from '@/lib/studio-gen';
import { courtPending } from '@/lib/studio-court';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  if (!generationConfigured()) return Response.json({ skipped: 'no Gemini key' });
  const r = await courtPending(1);
  if (r.scored || r.failed) console.log(`[court] scored ${r.scored}, failed ${r.failed}`);
  return Response.json(r);
}
