// Every minute: sync Studio content from the repo when it changed (so a release carries new episodes and shots to
// this environment by itself), then finish any running Studio takes, so nothing is lost if the page that started
// them was closed, and start queued takes as the Veo rate limits allow.
import { adminDb } from '@/lib/supabase/admin';
import { cronAuthorized } from '@/lib/cron';
import { pollTake, drainVeoQueue, generationConfigured } from '@/lib/studio-gen';
import { syncStudioIfChanged } from '@/lib/studio-sync';
import { pollRunwayJobs } from '@/lib/studio-runway';
import { advanceAllProductions } from '@/lib/studio-production';
import { kickFinish } from '@/lib/studio-finish';
import { syncPosted } from '@/lib/studio-distribute';
import season from '@/data/studio-season1.json';
import castData from '@/data/studio-cast.json';
import libraryCatalog from '@/data/screen-library.json';
import libraryAssets from '@/data/screen-library-assets.json';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: Request) {
  if (!cronAuthorized(req)) return new Response('Unauthorized', { status: 401 });
  const db = adminDb();
  let sync: Awaited<ReturnType<typeof syncStudioIfChanged>> | { error: string };
  try { sync = await syncStudioIfChanged(db, season, castData.characters as never, castData.bible, { catalog: libraryCatalog as never, assets: libraryAssets as never }); if (sync.synced) console.log(`[studio-sync] ${sync.hash}: ${sync.summary}`); } catch (e) { sync = { error: e instanceof Error ? e.message : 'sync failed' }; console.error(`[studio-sync] ${'error' in sync ? sync.error : ''}`); }
  // Runway jobs (StudioNext line reads, keyframes, takes, score) finish here even when the board is closed.
  let runway: Record<string, number> | { error: string } = {};
  try { runway = await pollRunwayJobs(); } catch (e) { runway = { error: e instanceof Error ? e.message : 'runway poll failed' }; }
  // Production runs take their next steps, and landed runs finish themselves (final cut + Shorts). While a run is
  // going this keeps stepping every ~10 s for most of the minute, so an episode isn't paced by the minute's tick.
  let production: unknown = {};
  try {
    const t0 = Date.now();
    for (let pass = 0; ; pass++) {
      if (pass) await pollRunwayJobs().catch(() => ({}));
      production = await advanceAllProductions();
      const { data: live } = await db.from('studio_episodes').select('id').eq('production->>on', 'true');
      for (const e of live ?? []) await kickFinish(new URL(req.url).origin, e.id as string).catch(() => false);
      // Keep stepping only while shots are actually in production (an open, finished run doesn't hold the loop).
      const busy = Object.values(production as Record<string, Record<string, number>>).some((o) => ['queued', 'reading', 'drawing', 'rendering'].some((k) => o[k]));
      if (!live?.length || !busy || Date.now() - t0 > 70_000) break;
      await new Promise((r) => setTimeout(r, 10_000));
    }
    for (const [code, o] of Object.entries(production as Record<string, Record<string, number>>)) if (Object.keys(o).length) console.info(`[production] ${code}: ${JSON.stringify(o)}`);
    const { data: stuck } = await db.from('studio_shots').select('id, n, produce, studio_episodes!inner(code)').eq('produce->>stage', 'blocked');
    for (const s of stuck ?? []) { const { data: errs } = await db.from('studio_takes').select('error, created_at, params').eq('shot_id', (s as unknown as { id: string }).id).eq('status', 'failed').order('created_at', { ascending: false }).limit(2); for (const t of errs ?? []) console.info(`[production] take error shot ${s.n}: ${t.error} · ${JSON.stringify(t.params).slice(0, 200)}`); }
    for (const s of stuck ?? []) console.info(`[production] blocked ${(s.studio_episodes as unknown as { code: string }).code} shot ${s.n}: ${(s.produce as { note?: string; last_error?: string })?.note ?? (s.produce as { last_error?: string })?.last_error ?? ''}`);
  } catch (e) { production = { error: e instanceof Error ? e.message : 'production failed' }; }
  // Posts sent through Metricool: mark the published ones posted with their live link, record failures.
  const posted = await syncPosted().catch((e) => ({ error: e instanceof Error ? e.message : 'metricool sync failed' }));
  if (!generationConfigured()) return Response.json({ sync, runway, production, posted, skipped: 'no Gemini key' });
  // Running takes (and fresh queued ones); takes waiting for quota are retried below, so they never crowd this list.
  const { data: running } = await db.from('studio_takes').select('id').not('model', 'like', 'runway:%').or('status.eq.running,and(status.eq.queued,params->>waiting_since.is.null)').order('created_at').limit(10);
  const results: Record<string, number> = {};
  for (const t of running ?? []) {
    const r = await pollTake(t.id);
    results[r.status] = (results[r.status] ?? 0) + 1;
  }
  // Start queued takes as the Veo rate limits allow (and quota backstop retries when due).
  const queue = await drainVeoQueue();
  return Response.json({ sync, runway, production, posted, checked: running?.length ?? 0, results, queue });
}
