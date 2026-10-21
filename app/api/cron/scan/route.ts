// Every 10 minutes: run one slice of the National Network Scanner if a sweep has work left (it stops by itself
// at the monthly budget). On the 1st of the month a finished scan starts a fresh sweep, which is how
// openings and closures are caught. Agency partner radars run first (they are small and capped per agency).
import { cronAuthorized } from '@/lib/cron';
import { placesConfigured } from '@/lib/places';
import { runSlice, startSweep, scanSettings } from '@/lib/scanner';
import { runRadars } from '@/lib/radar';
import { runCompetitorScans } from '@/lib/competitor-radar';
import { adminDb } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  if (!placesConfigured()) return Response.json({ skipped: 'google places not configured' });
  const db = adminDb();
  const { count: pending } = await db.from('scan_cells').select('id', { count: 'exact', head: true }).eq('status', 'pending');
  const { count: total } = await db.from('scan_cells').select('id', { count: 'exact', head: true });
  const today = new Date();
  if (total && !pending && today.getUTCDate() === 1 && !(await scanSettings()).sweepStarted) await startSweep();
  let radars: unknown = [];
  try { radars = await runRadars(15_000); } catch (e) { console.error(`[radar] ${e instanceof Error ? e.message : e}`); }
  let competitors: unknown = [];
  try { competitors = await runCompetitorScans(10_000); } catch (e) { console.error(`[competitors] ${e instanceof Error ? e.message : e}`); }
  try {
    return Response.json({ radars, competitors, network: await runSlice({ deadlineMs: 20_000 }) });
  } catch (e) {
    console.error(`[scan] ${e instanceof Error ? e.message : e}`);
    return Response.json({ error: e instanceof Error ? e.message : 'scan failed' }, { status: 500 });
  }
}
