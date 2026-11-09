// Every minute: the Lead Engine's own work (docs/LEAD_ENGINE_SPEC.md §4): first-call timers that came due (the team
// is alerted, migration 0096), then checks and scores for new or changed leads (lib/lead-checks.ts).
// Nothing here reaches a lead; outward steps stay in the approval lanes. LEAD_ENGINE_OFF=1 stops it.
import { cronAuthorized } from '@/lib/cron';
import { runLeadChecks } from '@/lib/lead-checks';
import { adminDb } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  if (process.env.LEAD_ENGINE_OFF === '1') return Response.json({ skipped: 'LEAD_ENGINE_OFF' });
  try {
    const { data: timers, error } = await adminDb().rpc('run_lead_timers');
    if (error) console.error(`[leads] timers: ${error.message}`);
    return Response.json({ timers: timers ?? 0, checks: await runLeadChecks(50) });
  } catch (e) {
    console.error(`[leads] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: e instanceof Error ? e.message : 'lead run failed' }, { status: 500 });
  }
}
