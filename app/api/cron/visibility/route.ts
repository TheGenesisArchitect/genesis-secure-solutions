// Every 10 minutes: agencies whose social numbers are over 12 hours old get a fresh pull from their Metricool brand
// (lib/visibility-social.ts). Does nothing when every agency is fresh.
import { cronAuthorized } from '@/lib/cron';
import { runDueSocialPulls } from '@/lib/visibility-social';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  try {
    return Response.json({ visibility: await runDueSocialPulls() });
  } catch (e) {
    console.error(`[visibility] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: e instanceof Error ? e.message : 'pull failed' }, { status: 500 });
  }
}
