// Every minute: sync Studio content from the repo when it changed (so a release carries new episodes and shots to
// this environment by itself), then finish any running Studio takes, so nothing is lost if the page that started
// them was closed, and start queued takes as the Veo rate limits allow.
import { adminDb } from '@/lib/supabase/admin';
import { cronAuthorized } from '@/lib/cron';
import { pollTake, drainVeoQueue, generationConfigured } from '@/lib/studio-gen';
import { syncStudioIfChanged } from '@/lib/studio-sync';
import season from '@/data/studio-season1.json';
import castData from '@/data/studio-cast.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const db = adminDb();
  let sync: Awaited<ReturnType<typeof syncStudioIfChanged>> | { error: string };
  try { sync = await syncStudioIfChanged(db, season, castData.characters as never); if (sync.synced) console.log(`[studio-sync] ${sync.hash}: ${sync.summary}`); } catch (e) { sync = { error: e instanceof Error ? e.message : 'sync failed' }; console.error(`[studio-sync] ${'error' in sync ? sync.error : ''}`); }
  if (!generationConfigured()) return Response.json({ sync, skipped: 'no Gemini key' });
  // Running takes (and fresh queued ones); takes waiting for quota are retried below, so they never crowd this list.
  const { data: running } = await db.from('studio_takes').select('id').or('status.eq.running,and(status.eq.queued,params->>waiting_since.is.null)').order('created_at').limit(10);
  const results: Record<string, number> = {};
  for (const t of running ?? []) {
    const r = await pollTake(t.id);
    results[r.status] = (results[r.status] ?? 0) + 1;
  }
  // Start queued takes as the Veo rate limits allow (and quota backstop retries when due).
  const queue = await drainVeoQueue();
  return Response.json({ sync, checked: running?.length ?? 0, results, queue });
}
