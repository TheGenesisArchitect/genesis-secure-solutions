// Every 10 minutes: agencies whose social numbers are over 12 hours old get a fresh pull from their Metricool brand
// (lib/visibility-social.ts), and agencies with a Search Console property get their once-a-day Google search pull
// (lib/search-console.ts). Does nothing when every agency is fresh.
import { cronAuthorized } from '@/lib/cron';
import { runDueSocialPulls } from '@/lib/visibility-social';
import { runDueSearchPulls } from '@/lib/search-console';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  try {
    const search = await runDueSearchPulls().catch((e) => ({ error: e instanceof Error ? e.message : 'search pull failed' }));
    return Response.json({ visibility: await runDueSocialPulls(), search });
  } catch (e) {
    console.error(`[visibility] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: e instanceof Error ? e.message : 'pull failed' }, { status: 500 });
  }
}
